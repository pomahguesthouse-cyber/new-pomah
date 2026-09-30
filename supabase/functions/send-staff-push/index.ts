import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Sends FCM HTTP v1 notifications to admin and manager devices.
 * Called by the database trigger via pg_net. Secrets, env first, database second:
 * - PUSH_WEBHOOK_SECRET, else staff_push_config.webhook_secret (id = 1)
 * - FCM_SERVICE_ACCOUNT_JSON, else staff_push_config.fcm_service_account (id = 1)
 * The database is read with the service-role client only. Secrets and the
 * private key are never committed or logged.
 * Deploy with JWT verification off; this function checks the shared secret.
 */

// deno-lint-ignore no-explicit-any
type ServiceClient = ReturnType<typeof createClient<any>>;

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type PushBody = {
  kind?: string;
  title?: string;
  body?: string;
  url?: string;
  thread_id?: string;
  booking_id?: string;
  message_id?: string;
  recipient_user_ids?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Null means the payload has no recipient filter (query every admin/manager token).
 * A present filter is intersected with that set, including an empty list.
 */
function recipientFilter(body: PushBody): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(body, "recipient_user_ids")) return null;
  const value = body.recipient_user_ids;
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
  return [...new Set(ids)];
}

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const claim = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: FCM_SCOPE,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json();
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`Google token exchange failed (${response.status})`);
  }
  return payload.access_token;
}

function normalizeServiceAccount(value: unknown): ServiceAccount {
  const parsed = (typeof value === "string" ? JSON.parse(value) : value) as
    | Partial<ServiceAccount>
    | null;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.project_id !== "string" ||
    !parsed.project_id ||
    typeof parsed.client_email !== "string" ||
    !parsed.client_email ||
    typeof parsed.private_key !== "string" ||
    !parsed.private_key
  ) {
    throw new Error("FCM service account is missing project_id, client_email, or private_key");
  }
  return {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

type PushConfigRow = { webhook_secret: string | null; fcm_service_account: unknown };

/** staff_push_config row 1 (service role only). Null when missing or unreadable. */
async function readPushConfig(supabase: ServiceClient): Promise<PushConfigRow | null> {
  const { data, error } = await supabase
    .from("staff_push_config")
    .select("webhook_secret, fcm_service_account")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.error("[send-staff-push] config read failed");
    return null;
  }
  return (data as PushConfigRow | null) ?? null;
}

/** Env var first, staff_push_config.fcm_service_account as fallback. */
function loadServiceAccount(config: PushConfigRow | null): ServiceAccount {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";
  if (raw.trim()) return normalizeServiceAccount(raw);
  const stored = config?.fcm_service_account;
  if (stored === null || stored === undefined) {
    throw new Error("FCM service account is not configured (env or staff_push_config)");
  }
  return normalizeServiceAccount(stored);
}

/** Constant-time string compare (compares SHA-256 digests byte by byte). */
async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function dataValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 900) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Env first; the database is only read when the env secret is not set.
  let config: PushConfigRow | null = null;
  let expected = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  if (!expected) {
    config = await readPushConfig(supabase);
    expected = config?.webhook_secret ?? "";
  }
  const provided = req.headers.get("x-push-secret") ?? "";
  if (!expected || !(await secretsMatch(provided, expected))) {
    return json(401, { error: "unauthorized" });
  }

  let body: PushBody;
  try {
    body = (await req.json()) as PushBody;
  } catch {
    return json(400, { error: "invalid json" });
  }

  const title = (body.title || "Pomah Admin").slice(0, 120);
  const text = (body.body || "").slice(0, 240);
  const url = dataValue(body.url);
  if (url && !url.startsWith("/admin")) return json(400, { error: "invalid url" });

  try {
    if (!Deno.env.get("FCM_SERVICE_ACCOUNT_JSON")?.trim() && !config) {
      config = await readPushConfig(supabase);
    }
    const account = loadServiceAccount(config);
    const accessToken = await googleAccessToken(account);
    const requested = recipientFilter(body);
    const { data: tokens, error } = await supabase.rpc("list_staff_push_tokens", {
      p_user_ids: requested,
    });
    if (error) throw error;

    const stale: string[] = [];
    let sent = 0;
    let failed = 0;
    const endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;

    for (const row of tokens ?? []) {
      const token = row.token as string;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: text },
            data: {
              kind: dataValue(body.kind),
              url,
              title,
              body: text,
              thread_id: dataValue(body.thread_id),
              booking_id: dataValue(body.booking_id),
              message_id: dataValue(body.message_id),
            },
            android: {
              priority: "HIGH",
              notification: { channel_id: "pomah-staff" },
            },
          },
        }),
      });
      if (response.ok) {
        sent += 1;
        continue;
      }
      failed += 1;
      const details = await response.text();
      if (
        response.status === 404 ||
        details.includes("UNREGISTERED") ||
        details.includes("NOT_FOUND")
      ) {
        stale.push(token);
      } else {
        console.error("[send-staff-push] fcm error", response.status);
      }
    }

    if (stale.length > 0) {
      await supabase.from("device_tokens").delete().in("token", stale);
    }

    return json(200, { sent, failed, removed: stale.length });
  } catch (error) {
    console.error("[send-staff-push]", error instanceof Error ? error.message : "failed");
    return json(500, { error: "push send failed" });
  }
});
