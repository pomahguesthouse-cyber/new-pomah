/**
 * Payment Proof Analyzer Service.
 *
 * Menggunakan LLM multimodal (Vision) untuk:
 *   1. OCR gambar bukti transfer → ekstrak data terstruktur
 *   2. Mencocokkan nominal transfer dengan booking pending tamu
 *   3. Menyimpan hasil OCR ke metadata pesan
 *
 * Dipanggil secara fire-and-forget dari webhook saat tamu mengirim gambar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, any, any>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OcrData {
  bank_pengirim:    string | null;
  bank_tujuan:      string | null;
  nominal:          number | null;
  tanggal:          string | null;
  nama_pengirim:    string | null;
  nomor_referensi:  string | null;
  raw_text:         string;
}

export interface MatchResult {
  status:         "matched" | "unmatched" | "ambiguous" | "no_pending_booking";
  booking_code:   string | null;
  booking_amount: number | null;
  amount_diff:    number | null;
}

export interface PaymentProofResult {
  ok:      boolean;
  ocr:     OcrData;
  match:   MatchResult;
  error?:  string;
}

// ─── LLM Config resolver ─────────────────────────────────────────────────────

interface LlmConfig {
  apiKey:  string;
  baseUrl: string;
  model:   string;
}

/**
 * Resolve LLM configuration from the properties table,
 * mirroring the logic in wa-autoreply.service.ts.
 */
async function resolveLlmConfig(db: Db): Promise<LlmConfig | null> {
  const { data: prop } = await db
    .from("properties")
    .select("ai_api_key, ai_base_url, ai_model")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!prop) return null;

  const p = prop as Record<string, any>;
  const explicitKey = p.ai_api_key?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const apiKey      = explicitKey || lovableKey;
  if (!apiKey) return null;

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");

  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

  return { apiKey, baseUrl, model };
}

// ─── Vision OCR prompt ────────────────────────────────────────────────────────

const OCR_SYSTEM_PROMPT = `Anda adalah asisten OCR untuk memverifikasi bukti transfer bank Indonesia.

Analisis gambar bukti transfer dan ekstrak data berikut dalam format JSON:

{
  "bank_pengirim": "nama bank pengirim (misal: BCA, BNI, Mandiri, BRI, dll) atau null",
  "bank_tujuan": "nama bank tujuan/penerima atau null",
  "nominal": angka nominal transfer (tanpa titik/koma pemisah ribuan, misal: 450000) atau null,
  "tanggal": "tanggal transfer dalam format YYYY-MM-DD" atau null,
  "nama_pengirim": "nama pemilik rekening pengirim" atau null,
  "nomor_referensi": "nomor referensi/resi transfer" atau null,
  "raw_text": "semua teks yang terbaca dari gambar, gabung dalam satu string"
}

ATURAN:
- Kembalikan HANYA JSON valid tanpa markdown code block, tanpa penjelasan.
- Jika gambar bukan bukti transfer (misal: foto biasa, meme, dokumen lain), tetap kembalikan JSON dengan semua field null dan raw_text berisi deskripsi singkat gambar.
- Nominal harus berupa angka integer (tanpa desimal) dalam Rupiah.
- Jangan menambahkan field apapun selain yang diminta.`;

// ─── Vision LLM call ──────────────────────────────────────────────────────────

async function callVisionLlm(
  config:   LlmConfig,
  imageUrl: string,
): Promise<OcrData> {
  const emptyOcr: OcrData = {
    bank_pengirim:   null,
    bank_tujuan:     null,
    nominal:         null,
    tanggal:         null,
    nama_pengirim:   null,
    nomor_referensi: null,
    raw_text:        "",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: 1000,
        messages: [
          { role: "system", content: OCR_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
              {
                type: "text",
                text: "Ekstrak data dari bukti transfer ini.",
              },
            ],
          },
        ],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error("[PaymentProof] Vision LLM HTTP error:", res.status, errText);
      return { ...emptyOcr, raw_text: `LLM error ${res.status}` };
    }

    const json = (await res.json()) as any;
    const content: string = json.choices?.[0]?.message?.content ?? "";

    // Strip markdown code fences if present
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    return {
      bank_pengirim:   parsed.bank_pengirim   ?? null,
      bank_tujuan:     parsed.bank_tujuan     ?? null,
      nominal:         typeof parsed.nominal === "number" ? parsed.nominal : null,
      tanggal:         parsed.tanggal         ?? null,
      nama_pengirim:   parsed.nama_pengirim   ?? null,
      nomor_referensi: parsed.nomor_referensi ?? null,
      raw_text:        parsed.raw_text        ?? "",
    };
  } catch (e: any) {
    console.error("[PaymentProof] Vision OCR error:", e);
    return { ...emptyOcr, raw_text: `OCR error: ${e.message ?? e}` };
  }
}

// ─── Booking matcher ──────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1000; // ± Rp 1.000

async function findMatchingBooking(
  db:       Db,
  phone:    string,
  nominal:  number | null,
): Promise<MatchResult> {
  const noBooking: MatchResult = {
    status: "no_pending_booking",
    booking_code: null,
    booking_amount: null,
    amount_diff: null,
  };

  if (!phone) return noBooking;

  // Find guest by phone
  const { data: guest } = await db
    .from("guests")
    .select("id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!guest?.id) return noBooking;

  // Find pending/confirmed bookings for this guest
  const { data: bookings } = await db
    .from("bookings")
    .select("id, reference_code, total_amount, status")
    .eq("guest_id", (guest as any).id)
    .in("status", ["pending", "confirmed"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (!bookings || bookings.length === 0) return noBooking;

  // If OCR didn't extract nominal, return the most recent booking as ambiguous
  if (nominal === null) {
    const latest = bookings[0] as any;
    return {
      status: "ambiguous",
      booking_code: latest.reference_code ?? null,
      booking_amount: Number(latest.total_amount) || null,
      amount_diff: null,
    };
  }

  // Try to match by amount
  const matches = bookings.filter((b: any) => {
    const amt = Number(b.total_amount);
    return Math.abs(amt - nominal) <= AMOUNT_TOLERANCE;
  });

  if (matches.length === 1) {
    const m = matches[0] as any;
    return {
      status: "matched",
      booking_code: m.reference_code ?? null,
      booking_amount: Number(m.total_amount) || null,
      amount_diff: nominal - Number(m.total_amount),
    };
  }

  if (matches.length > 1) {
    const m = matches[0] as any;
    return {
      status: "ambiguous",
      booking_code: m.reference_code ?? null,
      booking_amount: Number(m.total_amount) || null,
      amount_diff: nominal - Number(m.total_amount),
    };
  }

  // No amount match — return most recent booking as unmatched
  const latest = bookings[0] as any;
  return {
    status: "unmatched",
    booking_code: latest.reference_code ?? null,
    booking_amount: Number(latest.total_amount) || null,
    amount_diff: nominal - Number(latest.total_amount),
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyze a payment proof image:
 *  1. Vision OCR to extract transfer data
 *  2. Match against pending bookings
 *  3. Save OCR results to message metadata
 *
 * Returns the full result for the notification service.
 */
export async function analyzePaymentProof(
  db:        Db,
  imageUrl:  string,
  phone:     string,
  messageId: string,
): Promise<PaymentProofResult> {
  const tag = "[PaymentProof]";

  // 1. Resolve LLM config
  const llmConfig = await resolveLlmConfig(db);
  if (!llmConfig) {
    console.warn(`${tag} Tidak ada konfigurasi LLM — skip OCR`);
    return {
      ok: false,
      ocr: {
        bank_pengirim: null, bank_tujuan: null, nominal: null,
        tanggal: null, nama_pengirim: null, nomor_referensi: null,
        raw_text: "",
      },
      match: {
        status: "no_pending_booking",
        booking_code: null, booking_amount: null, amount_diff: null,
      },
      error: "LLM not configured",
    };
  }

  console.info(`${tag} Mulai OCR untuk pesan ${messageId}`);

  // 2. Vision OCR
  const ocr = await callVisionLlm(llmConfig, imageUrl);
  console.info(`${tag} OCR selesai — nominal: ${ocr.nominal}, bank: ${ocr.bank_pengirim}`);

  // 3. Match against bookings
  const match = await findMatchingBooking(db, phone, ocr.nominal);
  console.info(`${tag} Match: ${match.status} — booking: ${match.booking_code}`);

  // 4. Save OCR result to message metadata
  try {
    // Read existing metadata, merge OCR data, then update
    const { data: existing } = await (db as any)
      .from("whatsapp_messages")
      .select("metadata")
      .eq("id", messageId)
      .maybeSingle();

    const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};
    await (db as any)
      .from("whatsapp_messages")
      .update({
        metadata: {
          ...existingMeta,
          ocr_result: ocr,
          ocr_match: match,
          ocr_analyzed_at: new Date().toISOString(),
        },
      })
      .eq("id", messageId);
  } catch (e) {
    console.warn(`${tag} Gagal simpan OCR metadata:`, e);
  }

  return { ok: true, ocr, match };
}

/**
 * Format nominal as Indonesian Rupiah string.
 */
export function formatRupiahOcr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return "Rp " + value.toLocaleString("id-ID");
}
