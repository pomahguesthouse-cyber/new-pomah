/**
 * WhatsApp messaging service (Evolution API gateway).
 *
 * Single responsibility: send a message via the self-hosted Evolution API
 * instance. All callers receive a typed result — never raw fetch responses.
 *
 * Env yang dipakai:
 *   EVOLUTION_BASE_URL  mis. "https://wa.pomahguesthouse.com"
 *   EVOLUTION_INSTANCE  mis. "pomah"
 *   EVOLUTION_API_KEY   apikey instance (fallback: token dari properties)
 *
 *   Teks  -> POST {base}/message/sendText/{instance}   { number, text }
 *   Media -> POST {base}/message/sendMedia/{instance}  { number, media, ... }
 */

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL ?? "").replace(/\/+$/, "");
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE ?? "";
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY ?? "";

export interface SendResult {
  ok: boolean;
  error: string | null;
  status?: number;
  raw?: unknown;
}

export interface SendWhatsAppMessageInput {
  token: string;
  phone: string;
  message: string;
  fileUrl?: string;
  filename?: string;
}

const SEND_TIMEOUT_MS = 12_000;
// Kirim media butuh unduh + upload di gateway, jadi diberi jendela lebih lega.
const MEDIA_SEND_TIMEOUT_MS = 45_000;

/**
 * Gateway WhatsApp umumnya mau MSISDN digits (628xxx). Karena WhatsApp bisa
 * memunculkan identitas LID-only, kita pertahankan/kembalikan chat id @lid
 * ketika nilainya jelas bukan nomor publik Indonesia. Dengan begitu queue
 * tetap mencoba membalas alih-alih diam saat alias LID->phone belum diketahui.
 */
function normalizeWaTarget(phone: string): string {
  const raw = String(phone ?? "").trim().replace(/\s+/g, "");
  if (!raw) return "";

  if (/@lid(?:\b|$)/i.test(raw)) {
    return raw.toLowerCase();
  }

  let p = raw.replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "");
  p = p.replace(/@c\.us$/i, "").replace(/[^\d]/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (/^8\d{7,14}$/.test(p)) p = "62" + p;

  if (/^62\d{8,14}$/.test(p)) return p;
  if (/^\d{10,18}$/.test(p)) return `${p}@lid`;
  return p;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && !!v.trim())));
}

/**
 * Send a WhatsApp message via Evolution API.
 *
 * @param token   Fallback apikey bila EVOLUTION_API_KEY belum diset
 * @param phone   Recipient phone in international format, e.g. "628123456789"
 * @param message Text to send (plain text; WhatsApp formatting supported)
 * @param fileUrl Optional public URL of a file/image to attach
 * @param filename Optional filename shown to the recipient
 */
export async function sendWhatsAppMessage(
  token: string,
  phone: string,
  message: string,
  fileUrl?: string,
  filename?: string,
): Promise<SendResult> {
  return sendEvolutionMessage({ token, phone, message, fileUrl, filename });
}

function evolutionApiKey(fallbackToken: string): string {
  return EVOLUTION_API_KEY || fallbackToken;
}

function evolutionEndpoint(path: string): string {
  return `${EVOLUTION_BASE_URL}/${path}/${encodeURIComponent(EVOLUTION_INSTANCE)}`;
}

function evolutionNumberCandidates(phone: string): string[] {
  const raw = String(phone ?? "").trim().replace(/\s+/g, "");
  const normalized = normalizeWaTarget(raw);
  const digits = raw
    .replace(/@(?:lid|c\.us|s\.whatsapp\.net)$/i, "")
    .replace(/[^\d]/g, "");

  if (/^62\d{8,14}$/.test(normalized)) return unique([normalized]);
  if (/@lid$/i.test(raw) || (digits && !/^62\d{8,14}$/.test(digits))) {
    return unique([raw.toLowerCase(), normalized, digits]);
  }
  return unique([normalized, raw]);
}

async function sendEvolutionMessage(input: SendWhatsAppMessageInput): Promise<SendResult> {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_INSTANCE) {
    const msg = "Evolution API not configured: set EVOLUTION_BASE_URL and EVOLUTION_INSTANCE";
    console.error("[WhatsApp]", msg);
    return { ok: false, error: msg };
  }

  const apiKey = evolutionApiKey(input.token);
  if (!apiKey) {
    return { ok: false, error: "Evolution API key kosong (set EVOLUTION_API_KEY atau token properti)" };
  }

  // Upload media (unduh dari URL lalu kirim) jauh lebih lama dari teks biasa.
  // Timeout 12s bikin fetch di-abort padahal Evolution sudah mengirim fotonya —
  // itulah sumber "false negative" yang memicu pesan kendala teknis.
  const hasMediaInput = !!input.fileUrl;
  const timeoutMs = hasMediaInput ? MEDIA_SEND_TIMEOUT_MS : SEND_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const candidates = evolutionNumberCandidates(input.phone);

  try {
    let lastResult: SendResult | null = null;

    for (const number of candidates) {
      const hasMedia = !!input.fileUrl;
      // Deteksi tipe media supaya WhatsApp merender preview (image/video) alih-alih
      // mengirim sebagai dokumen mentah — brosur foto kamar wajib "image".
      const guessMediatype = (): "image" | "video" | "audio" | "document" => {
        const src = `${input.fileUrl ?? ""} ${input.filename ?? ""}`.toLowerCase();
        if (/\.(jpe?g|png|webp|gif|heic|heif|bmp)(\?|$)/.test(src)) return "image";
        if (/\.(mp4|mov|3gp|mkv|webm)(\?|$)/.test(src)) return "video";
        if (/\.(mp3|ogg|opus|wav|m4a|aac)(\?|$)/.test(src)) return "audio";
        return "document";
      };
      const mediatype = hasMedia ? guessMediatype() : "document";
      const url = evolutionEndpoint(hasMedia ? "message/sendMedia" : "message/sendText");
      const payload = hasMedia
        ? {
            number,
            mediatype,
            mimetype:
              mediatype === "image"
                ? "image/jpeg"
                : mediatype === "video"
                  ? "video/mp4"
                  : undefined,
            media: input.fileUrl,
            fileName: input.filename ?? "file",
            caption: input.message ?? "",
          }
        : {
            number,
            text: input.message,
          };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          apikey: apiKey,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await res.text().catch(() => "");
      let responseJson: any = null;
      try {
        responseJson = responseText ? JSON.parse(responseText) : null;
      } catch {
        // Keep text body below.
      }
      const raw = responseJson ?? responseText;

      if (!res.ok) {
        const body = responseText || "(no body)";
        console.error(
          `[WhatsApp] Evolution send error (${number}):`,
          res.status,
          body.slice(0, 500),
        );
        lastResult = { ok: false, status: res.status, error: `HTTP ${res.status}: ${body}`, raw };
        continue;
      }

      // Evolution API sukses -> HTTP 2xx + body { key: { id }, status: "PENDING" }.
      // Format legacy `status: true` tetap diterima untuk kompatibilitas.
      const hasEvolutionKey = !!responseJson?.key?.id;
      const hasLegacyOk = responseJson?.status === true;
      const bodyLooksEmpty = !responseJson;
      const success = hasEvolutionKey || hasLegacyOk || bodyLooksEmpty;

      if (!success) {
        console.error(
          `[WhatsApp] Evolution send unexpected body (${number}):`,
          res.status,
          JSON.stringify(responseJson).slice(0, 500),
        );
        lastResult = { ok: false, status: res.status, error: "Respons Evolution tanpa key.id", raw };
        continue;
      }

      return { ok: true, status: res.status, error: null, raw };
    }

    return lastResult ?? { ok: false, error: "Tidak ada target Evolution valid" };
  } catch (e) {
    const isAbort = (e as { name?: string })?.name === "AbortError";
    const msg = isAbort
      ? `Evolution API timeout setelah ${timeoutMs}ms`
      : e instanceof Error ? e.message : String(e);

    console.error("[WhatsApp] Evolution fetch exception:", msg);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Presence helpers (best-effort, non-throwing) ─────────────────────────────
// Digunakan untuk memberi "rasa manusiawi": tandai chat dibaca dan tampilkan
// indikator sedang mengetik saat bot memproses balasan. Kegagalan tidak boleh
// menghentikan alur autoreply — cukup console.warn.

const PRESENCE_TIMEOUT_MS = 5_000;

async function sendEvolutionPresence(
  token: string,
  phone: string,
  presence: "available" | "composing" | "paused",
): Promise<void> {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_INSTANCE) {
    console.warn("[WhatsApp] presence skipped: Evolution API belum terkonfigurasi");
    return;
  }
  const apiKey = evolutionApiKey(token);
  if (!apiKey) {
    console.warn("[WhatsApp] presence skipped: apikey kosong");
    return;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRESENCE_TIMEOUT_MS);
  try {
    const number = normalizeWaTarget(phone);
    const res = await fetch(evolutionEndpoint("chat/sendPresence"), {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({ number, presence, delay: 1_200 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[WhatsApp] sendPresence(${presence}) HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[WhatsApp] sendPresence(${presence}) gagal:`, msg);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Tandai kehadiran online (mendekati "dibaca"), best-effort. */
export async function markWaSeen(token: string, phone: string): Promise<void> {
  await sendEvolutionPresence(token, phone, "available");
}

/** Nyalakan/matikan indikator "sedang mengetik" (best-effort). */
export async function setWaTyping(token: string, phone: string, value: boolean): Promise<void> {
  await sendEvolutionPresence(token, phone, value ? "composing" : "paused");
}

// ─── Media inbound (bukti transfer) ───────────────────────────────────────────
// URL media WhatsApp (mmg.whatsapp.net/...) TERENKRIPSI, jadi Vision LLM tidak
// bisa membacanya langsung. Evolution API menyediakan endpoint untuk mendekripsi
// media dan mengembalikan base64 — hasilnya kita bungkus jadi data URI.

const MEDIA_FETCH_TIMEOUT_MS = 20_000;

/**
 * Ambil media inbound sebagai data URI (`data:image/jpeg;base64,...`).
 * `rawMessage` adalah objek `data` mentah dari webhook Evolution (berisi `key`
 * dan `message`). Mengembalikan null bila gagal — pemanggil harus fail-soft.
 */
export async function fetchWaMediaDataUri(
  token: string,
  rawMessage: Record<string, unknown>,
): Promise<string | null> {
  if (!EVOLUTION_BASE_URL || !EVOLUTION_INSTANCE) {
    console.warn("[WhatsApp] getBase64 skipped: Evolution API belum terkonfigurasi");
    return null;
  }
  const apiKey = evolutionApiKey(token);
  if (!apiKey) {
    console.warn("[WhatsApp] getBase64 skipped: apikey kosong");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MEDIA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(evolutionEndpoint("chat/getBase64FromMediaMessage"), {
      method: "POST",
      headers: {
        apikey: apiKey,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify({ message: rawMessage, convertToMp4: false }),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(`[WhatsApp] getBase64 HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }

    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }

    const base64: string | undefined = parsed?.base64 ?? parsed?.data?.base64;
    if (!base64) {
      console.warn("[WhatsApp] getBase64: respons tanpa field base64");
      return null;
    }
    if (base64.startsWith("data:")) return base64;

    const mime: string = parsed?.mimetype ?? parsed?.mimeType ?? "image/jpeg";
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[WhatsApp] getBase64 gagal:", msg);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
