import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/**
 * Sends FCM HTTP v1 notifications to staff devices.
 * Called by the database trigger via pg_net. Requires:
 * - FCM_SERVICE_ACCOUNT_JSON (Firebase service account, never committed)
 * - PUSH_WEBHOOK_SECRET (must match staff_push_config.webhook_secret)
 * Deploy with JWT verification off; this function checks the shared secret.
 */

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
};

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

function loadServiceAccount(): ServiceAccount {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";
  if (!raw.trim()) throw new Error("FCM_SERVICE_ACCOUNT_JSON is not set");
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM service account is missing project_id, client_email, or private_key");
  }
  return {
    project_id: parsed.project_id,
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

function dataValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 900) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, { ok: true });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const expected = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "";
  const provided = req.headers.get("x-push-secret") ?? "";
  if (!expected || provided !== expected) return json(401, { error: "unauthorized" });

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
    const account = loadServiceAccount();
    const accessToken = await googleAccessToken(account);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: tokens, error } = await supabase
      .from("device_tokens")
      .select("token")
      .eq("platform", "android");
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
            android: { priority: "HIGH" },
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
