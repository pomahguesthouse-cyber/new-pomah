/**
 * Kanal WhatsApp Business resmi (Meta) lewat connector gateway Lovable.
 *
 * Nomor resmi dipakai untuk melayani tamu; nomor Evolution tetap aktif untuk
 * fungsi internal. Thread yang pesan terakhirnya masuk lewat Meta ditandai
 * `whatsapp_threads.provider = 'meta'`, dan balasan otomatis ikut kanal itu.
 */
import { phoneVariants } from "@/lib/phone";
import { runDeferred } from "@/lib/cf-context";
import { isUnsupportedMetaImage, prepareMetaImageForSend } from "@/services/meta-media";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export interface MetaSendResult {
  ok: boolean;
  error: string | null;
  status?: number;
  raw?: unknown;
  messageId?: string | null;
}

function gatewayHeaders(): Record<string, string> | null {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const waKey = process.env.WHATSAPP_API_KEY;
  if (!lovableKey || !waKey) return null;
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": waKey,
  };
}

export function isMetaConfigured(): boolean {
  return gatewayHeaders() !== null;
}

/** Ubah nomor ke format digit E.164 tanpa "+" (Indonesia). */
export function toMetaRecipient(phone: string): string {
  let p = String(phone ?? "")
    .replace(/@.*$/, "")
    .replace(/\D/g, "");
  if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;
  return p;
}

type AdminClient = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

async function getAdmin(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

/** Cek apakah nomor ini sedang dilayani lewat kanal Meta. */
export async function resolveThreadProvider(phone: string): Promise<"meta" | "evolution"> {
  if (!isMetaConfigured()) return "evolution";
  const variants = phoneVariants(String(phone ?? "").replace(/@.*$/, ""));
  if (variants.length === 0) return "evolution";
  try {
    const admin = await getAdmin();
    const { data } = await admin
      .from("whatsapp_threads")
      .select("provider")
      .or(
        `phone.in.(${variants.map((v) => `"${v}"`).join(",")}),canonical_phone.in.(${variants.map((v) => `"${v}"`).join(",")})`,
      )
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as { provider?: string } | null)?.provider === "meta" ? "meta" : "evolution";
  } catch {
    return "evolution";
  }
}

function guessMediaType(url: string, filename?: string): "image" | "video" | "audio" | "document" {
  const src = `${url} ${filename ?? ""}`.toLowerCase();
  if (/\.(jpe?g|png|webp)(\?|$)/.test(src)) return "image";
  if (/\.(mp4|3gp)(\?|$)/.test(src)) return "video";
  if (/\.(mp3|ogg|opus|m4a|aac|amr)(\?|$)/.test(src)) return "audio";
  return "document";
}

/** Kirim teks/media lewat Meta dan catat id pesan untuk pelacakan status. */
export async function sendMetaMessage(
  phone: string,
  message: string,
  fileUrl?: string,
  filename?: string,
): Promise<MetaSendResult> {
  const headers = gatewayHeaders();
  if (!headers) return { ok: false, error: "WhatsApp Business belum terhubung" };
  const to = toMetaRecipient(phone);
  if (!/^\d{8,15}$/.test(to)) return { ok: false, error: `Nomor tidak valid: ${phone}` };

  let payload: Record<string, unknown>;
  const outboundBody = message;
  if (fileUrl) {
    let link = fileUrl;
    let name = filename;
    if (isUnsupportedMetaImage(fileUrl, filename)) {
      const { createMetaImageDeps } = await import("./meta-image-runtime");
      const prepared = await prepareMetaImageForSend(fileUrl, filename, createMetaImageDeps());
      if (!prepared) {
        return {
          ok: false,
          error: "Format gambar tidak didukung WhatsApp (perlu JPEG/PNG, WebP ditolak)",
        };
      }
      link = prepared.url;
      name = prepared.filename;
    }
    if (/\.webp(\?|#|$)/i.test(link)) {
      return { ok: false, error: "WebP tidak didukung WhatsApp Cloud API (131053)" };
    }
    const type = guessMediaType(link, name);
    const media: Record<string, unknown> = { link };
    if (type !== "audio" && message) media.caption = message;
    if (type === "document") media.filename = name ?? "file";
    payload = { messaging_product: "whatsapp", to, type, [type]: media };
  } else {
    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message, preview_url: true },
    };
  }

  const admin = await getAdmin();
  try {
    const res = await fetch(`${GATEWAY_URL}/messages`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      console.error(`[WhatsAppMeta] send failed [${res.status}]: ${text.slice(0, 500)}`);
      const errText = `HTTP ${res.status}: ${text}`;
      noteMetaChannelHealth(false, errText);
      await admin.from("whatsapp_meta_outbound").insert({
        recipient: to,
        body: outboundBody,
        status: "failed",
        error: { http_status: res.status, body: json },
      });
      return { ok: false, status: res.status, error: errText, raw: json };
    }
    const messageId =
      (json as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ?? null;
    noteMetaChannelHealth(true, null);
    const { error: insErr } = await admin
      .from("whatsapp_meta_outbound")
      .insert({
        provider_message_id: messageId,
        recipient: to,
        body: outboundBody,
        status: "accepted",
      });
    if (insErr) console.error("[WhatsAppMeta] outbound record failed:", insErr.message);
    // Status yang sempat datang lebih dulu akan diproses ulang oleh drain inbox.
    if (messageId) {
      await admin
        .from("whatsapp_webhook_events")
        .update({ next_attempt_at: new Date().toISOString() })
        .is("processed_at", null)
        .eq("event", "whatsapp.status");
    }
    return { ok: true, status: res.status, error: null, raw: json, messageId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    noteMetaChannelHealth(false, msg);
    await admin
      .from("whatsapp_meta_outbound")
      .insert({ recipient: to, body: outboundBody, status: "failed", error: { exception: msg } });
    return { ok: false, error: msg };
  }
}

/** Catat kesehatan kanal Meta tanpa menahan jalur kirim (termasuk quick-ack). */
function noteMetaChannelHealth(ok: boolean, error: string | null): void {
  runDeferred("WhatsAppMeta.channelStatus", async () => {
    const admin = await getAdmin();
    const now = new Date().toISOString();
    const patch = ok
      ? { channel: "whatsapp_meta", status: "online", last_ok_at: now, last_error_message: null }
      : {
          channel: "whatsapp_meta",
          status: "degraded",
          last_error_at: now,
          last_error_message: (error ?? "send failed").slice(0, 300),
        };
    const { error: upErr } = await admin
      .from("channel_status")
      .upsert(patch, { onConflict: "channel" });
    if (upErr) console.warn("[WhatsAppMeta] channel_status:", upErr.message);
  });
}

/** Unduh media masuk (mis. bukti transfer) sebagai data URI, dengan batas ukuran. */
export async function fetchMetaMediaDataUri(mediaId: string): Promise<string | null> {
  const headers = gatewayHeaders();
  if (!headers || !mediaId) return null;
  const metaRes = await fetch(`${GATEWAY_URL}/media/${encodeURIComponent(mediaId)}`, { headers });
  if (!metaRes.ok) {
    console.warn(
      `[WhatsAppMeta] media lookup [${metaRes.status}]: ${(await metaRes.text()).slice(0, 200)}`,
    );
    return null;
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url) return null;
  if (typeof meta.file_size === "number" && meta.file_size > MAX_MEDIA_BYTES) return null;

  const dl = await fetch(`${GATEWAY_URL}/media_download`, {
    headers: { ...headers, "X-WhatsApp-Media-URL": meta.url },
  });
  if (!dl.ok || !dl.body) return null;
  const reader = dl.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MEDIA_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  const mime = meta.mime_type ?? dl.headers.get("content-type") ?? "image/jpeg";
  return `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
}
