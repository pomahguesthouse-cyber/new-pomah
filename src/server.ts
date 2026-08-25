import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { runWithCfContext } from "./lib/cf-context";

type ExecutionContextLike = { waitUntil?: (promise: Promise<unknown>) => void };

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// Klien (browser) yang membatalkan request di tengah SSR — misal user refresh
// atau pindah halaman — memunculkan "Error: aborted"/ECONNRESET. Ini bukan bug
// aplikasi, jadi jangan dilaporkan sebagai runtime error.
function isClientAbortError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const fields = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (fields.code === "ECONNRESET" || fields.code === "ECONNABORTED") return true;
    if (typeof fields.message === "string" && /\baborted\b/i.test(fields.message)) return true;
    current = fields.cause;
  }
  return false;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const captured = consumeLastCapturedError();
  if (isClientAbortError(captured)) {
    // Koneksi sudah tertutup; balas tanpa mencatat error.
    return new Response(null, { status: 499 });
  }
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}


export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // ── Redirect 301 permanen ────────────────────────────────────────
    // URL-URL berikut pernah terindeks mesin pencari namun tidak valid.
    // Redirect 301 memindahkan link-equity ke URL yang benar dan
    // memberi sinyal kepada Googlebot untuk menghapus URL lama dari indeks.
    const PERMANENT_REDIRECTS: Record<string, string> = {
      "/rooms/deluxe-ocean-view": "/rooms",
      // Tambahkan slug kamar tidak valid lainnya di sini jika ada:
      // "/rooms/contoh-slug-salah": "/rooms",
    };
    const pathname = new URL(request.url).pathname;
    const redirectTarget = PERMANENT_REDIRECTS[pathname];
    if (redirectTarget) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: redirectTarget,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Redirect-Reason": "seo-cleanup",
        },
      });
    }
    // ────────────────────────────────────────────────────────────────

    try {
      const handler = await getServerEntry();
      const waitUntil = (ctx as ExecutionContextLike | undefined)?.waitUntil?.bind(ctx);
      const response = await runWithCfContext({ waitUntil }, () =>
        handler.fetch(request, env, ctx),
      );
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  // ── Cloudflare Cron Trigger (lihat triggers.crons di wrangler.jsonc) ──────
  // Penggerak antrian WA yang tinggal serumah dengan Worker: tiap menit
  // men-dispatch POST internal ke route drain yang sama dengan pg_cron,
  // sehingga recovery + zombie-alarm + drain berjalan lewat SATU jalur kode.
  // Berbeda dari pg_net (fire-and-forget, putus ~5s), di sini `waitUntil`
  // tersedia sehingga pemrosesan AI tidak terpotong saat respons dikirim.
  async scheduled(_controller: unknown, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const waitUntil = (ctx as ExecutionContextLike | undefined)?.waitUntil?.bind(ctx);
      const envOrigin = (env as Record<string, unknown> | undefined)?.["PUBLIC_ORIGIN"];
      const origin =
        typeof envOrigin === "string" && envOrigin ? envOrigin : "https://pomahguesthouse.com";
      const request = new Request(`${origin}/api/cron/process-wa-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      await runWithCfContext({ waitUntil }, () => handler.fetch(request, env, ctx));
    } catch (error) {
      console.error("[scheduled] WA queue drain failed:", error);
    }
  },
};

