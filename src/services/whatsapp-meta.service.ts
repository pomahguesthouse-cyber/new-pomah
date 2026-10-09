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
import { bytesToDataUri, classifyMetaMediaLookupFailure } from "@/services/wa-inbound-media";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";
/** Batas unduh media masuk. Selaras dengan bucket `wa-inbound` (~16 MB). */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

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

export function guessMediaType(url: string, filename?: string): "image" | "video" | "audio" | "document" {
  const src = `${url} ${filename ?? ""}`.toLowerCase();
  if (/\.(jpe?g|png|webp)(\?|$)/.test(src)) return "image";
  if (/\.(mp4|3gp)(\?|$)/.test(src)) return "video";
  if (/\.(mp3|ogg|opus|m4a|aac|amr)(\?|$)/.test(src)) return "audio";
  return "document";
}

/** Parameter body template: tanpa baris baru, tidak kosong, batas Cloud API. */
export function sanitizeTemplateParam(value: string): string {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim()
    .slice(0, 1024);
  return cleaned || "-";
}

/** Payload template Utility. `bodyParams` urut sesuai variabel {{1}}… di template. */
export function buildMetaTemplatePayload(
  to: string,
  name: string,
  languageCode: string,
  bodyParams: string[],
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: { code: languageCode || "id" },
      components: [
        {
          type: "body",
          parameters: bodyParams.map((text) => ({
            type: "text",
            text: sanitizeTemplateParam(text),
          })),
        },
      ],
    },
  };
}

/** POST ke gateway Meta dan catat baris whatsapp_meta_outbound (sukses maupun gagal). */
async function deliverMetaPayload(
  to: string,
  payload: Record<string, unknown>,
  outboundBody: string,
): Promise<MetaSendResult> {
  const headers = gatewayHeaders();
  if (!headers) return { ok: false, error: "WhatsApp Business belum terhubung" };

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
    const { error: insErr } = await admin.from("whatsapp_meta_outbound").insert({
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

/** Kirim teks/media lewat Meta dan catat id pesan untuk pelacakan status. */
export async function sendMetaMessage(
  phone: string,
  message: string,
  fileUrl?: string,
  filename?: string,
  mediaType?: "image" | "video" | "audio" | "document",
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
    const type = mediaType ?? guessMediaType(link, name);
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

  return deliverMetaPayload(to, payload, outboundBody);
}

/**
 * Kirim template Utility yang sudah disetujui Meta.
 * Dipakai saat pesan bebas ditolak karena jendela 24 jam (131047 / 131026 / 470).
 */
export async function sendMetaTemplateMessage(
  phone: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
  logBody?: string,
): Promise<MetaSendResult> {
  const headers = gatewayHeaders();
  if (!headers) return { ok: false, error: "WhatsApp Business belum terhubung" };
  const to = toMetaRecipient(phone);
  if (!/^\d{8,15}$/.test(to)) return { ok: false, error: `Nomor tidak valid: ${phone}` };
  const name = templateName.trim();
  if (!name) return { ok: false, error: "Nama template WhatsApp kosong" };
  const lang = languageCode.trim() || "id";
  const payload = buildMetaTemplatePayload(to, name, lang, bodyParams);
  const paramSummary = bodyParams.map((param) => sanitizeTemplateParam(param)).join(" | ");
  const outboundBody = logBody?.trim()
    ? `[template:${name}] ${logBody.trim()}`
    : `[template:${name}] ${paramSummary}`;
  return deliverMetaPayload(to, payload, outboundBody);
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

export interface MetaMediaBytes {
  ok: true;
  bytes: Uint8Array;
  mime: string;
  size: number;
}

export type MetaMediaBytesResult =
  | MetaMediaBytes
  | { ok: false; reason: string };

/**
 * Unduh byte media masuk sekali (bukti transfer, dokumen, audio, video, stiker).
 * `reason` singkat: `expired` bila Meta sudah menghapus media, selain itu kode kegagalan.
 */
export async function fetchMetaMediaBytes(
  mediaId: string,
  maxBytes = MAX_MEDIA_BYTES,
): Promise<MetaMediaBytesResult> {
  if (!mediaId) return { ok: false, reason: "empty_media_id" };
  const headers = gatewayHeaders();
  if (!headers) return { ok: false, reason: "not_configured" };

  const metaRes = await fetch(`${GATEWAY_URL}/media/${encodeURIComponent(mediaId)}`, { headers });
  if (!metaRes.ok) {
    const body = (await metaRes.text()).slice(0, 200);
    const reason = classifyMetaMediaLookupFailure(metaRes.status, body);
    console.warn(`[WhatsAppMeta] media lookup [${metaRes.status}] ${reason}: ${body}`);
    return { ok: false, reason };
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url) return { ok: false, reason: "no_url" };
  if (typeof meta.file_size === "number" && meta.file_size > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const dl = await fetch(`${GATEWAY_URL}/media_download`, {
    headers: { ...headers, "X-WhatsApp-Media-URL": meta.url },
  });
  if (!dl.ok || !dl.body) {
    const reason = classifyMetaMediaLookupFailure(dl.status, "");
    return { ok: false, reason: dl.ok ? "empty_body" : reason === "expired" ? reason : `download_${dl.status}` };
  }
  const reader = dl.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  if (total === 0) return { ok: false, reason: "empty_body" };
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  const mime = meta.mime_type ?? dl.headers.get("content-type") ?? "image/jpeg";
  return { ok: true, bytes: buf, mime, size: total };
}

/** Unduh media masuk sebagai data URI. Memakai byte yang sama dengan `fetchMetaMediaBytes`. */
export async function fetchMetaMediaDataUri(mediaId: string): Promise<string | null> {
  const fetched = await fetchMetaMediaBytes(mediaId);
  if (!fetched.ok) return null;
  return bytesToDataUri(fetched.bytes, fetched.mime);
}
