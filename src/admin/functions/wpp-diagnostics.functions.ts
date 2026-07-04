/**
 * WPPConnect diagnostics — ping tiga endpoint utama gateway VPS
 * (check-connection, send-seen, typing) untuk memverifikasi:
 *   - env WPP_BASE_URL / WPP_SESSION Cloudflare
 *   - reverse proxy VPS (SSL, port 443 → 21465)
 *   - Bearer token (properties.wpp_token) masih valid
 *
 * Semua panggilan best-effort; kita kembalikan status + body ringkas
 * agar UI bisa menampilkan alasan kegagalan tanpa membocorkan token.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PROBE_TIMEOUT_MS = 8_000;

type ProbeResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  bodyPreview: string;
  error: string | null;
};

type EnvCheck = {
  hasBaseUrl: boolean;
  hasSession: boolean;
  hasWebhookToken: boolean;
  baseUrl: string | null;
  session: string | null;
};

function envSnapshot(): EnvCheck {
  const baseUrl = (process.env.WPP_BASE_URL ?? "").replace(/\/+$/, "");
  const session = process.env.WPP_SESSION ?? "";
  const webhook = process.env.WPP_WEBHOOK_TOKEN ?? process.env.FONNTE_WEBHOOK_TOKEN ?? "";
  return {
    hasBaseUrl: !!baseUrl,
    hasSession: !!session,
    hasWebhookToken: !!webhook,
    baseUrl: baseUrl || null,
    session: session || null,
  };
}

function bearer(token: string): string {
  const t = String(token ?? "").trim();
  return /^bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

async function probe(
  url: string,
  init: RequestInit,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - started,
      bodyPreview: text.slice(0, 400),
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - started,
      bodyPreview: "",
      error: isAbort ? `Timeout ${PROBE_TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const runWppDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        // Nomor opsional untuk uji send-seen/typing. Jika kosong, kedua probe
        // presence dilewati agar tidak mengirim event ke nomor sembarangan.
        testPhone: z.string().trim().max(20).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const env = envSnapshot();

    // Ambil token WPPConnect dari properties.
    const { data: prop } = await context.supabase
      .from("properties")
      .select("wpp_token")
      .limit(1)
      .maybeSingle();
    const rawToken = (prop as { wpp_token?: string | null } | null)?.wpp_token ?? null;
    const hasToken = !!rawToken?.trim();

    const results: {
      connection: ProbeResult | null;
      sendSeen: ProbeResult | null;
      typing: ProbeResult | null;
    } = { connection: null, sendSeen: null, typing: null };

    if (env.hasBaseUrl && env.hasSession) {
      const base = `${env.baseUrl}/api/${encodeURIComponent(env.session!)}`;

      if (hasToken) {
        results.connection = await probe(`${base}/check-connection-session`, {
          method: "GET",
          headers: {
            Authorization: bearer(rawToken!),
            Accept: "application/json",
          },
        });

        // Presence probes hanya jalan jika user memberi nomor uji.
        const phone = (data.testPhone ?? "").replace(/[^\d]/g, "");
        if (phone) {
          const commonInit: RequestInit = {
            method: "POST",
            headers: {
              Authorization: bearer(rawToken!),
              "Content-Type": "application/json; charset=utf-8",
              Accept: "application/json",
            },
          };
          results.sendSeen = await probe(`${base}/send-seen`, {
            ...commonInit,
            body: JSON.stringify({ phone, isGroup: false }),
          });
          results.typing = await probe(`${base}/typing`, {
            ...commonInit,
            body: JSON.stringify({ phone, isGroup: false, value: false }),
          });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      env,
      token: {
        present: hasToken,
        length: rawToken?.trim().length ?? 0,
      },
      probes: results,
    };
  });
