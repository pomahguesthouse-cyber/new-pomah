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
import {
  chatCompletion,
  extractJsonObject,
  resolvePropertyAiConfig,
  type AiClientConfig,
} from "@/services/ai-client.service";

type Db = SupabaseClient<any, any, any>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OcrData {
  bank_pengirim:    string | null;
  bank_tujuan:      string | null;
  /** Jumlah yang DITERIMA hotel (transfer principal, tanpa biaya bank). */
  nominal:          number | null;
  /** Biaya admin/transfer bank, kalau ada di bukti (mis. BI-FAST Rp 2.500). */
  biaya_admin:      number | null;
  /** Total yang DIDEBIT dari rekening pengirim = nominal + biaya_admin. */
  total_dibayar:    number | null;
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

async function resolveVisionConfig(db: Db): Promise<AiClientConfig | null> {
  return resolvePropertyAiConfig(db, {
    lovableFallbackModel: "google/gemini-2.5-flash",
  });
}

// ─── Vision OCR prompt ────────────────────────────────────────────────────────

const OCR_SYSTEM_PROMPT = `Anda adalah asisten OCR untuk memverifikasi bukti transfer bank Indonesia.

Analisis gambar bukti transfer dan ekstrak data berikut dalam format JSON:

{
  "bank_pengirim": "nama bank pengirim (misal: BCA, BNI, Mandiri, BRI, Wondr/BNI, dll) atau null",
  "bank_tujuan": "nama bank tujuan/penerima atau null",
  "nominal": angka transfer yang DITERIMA penerima (principal, tanpa biaya bank) atau null,
  "biaya_admin": angka biaya/admin/fee transfer (BI-FAST, transfer antar bank, dll) atau null,
  "total_dibayar": angka TOTAL yang didebit dari rekening pengirim (nominal + biaya) atau null,
  "tanggal": "tanggal transfer dalam format YYYY-MM-DD" atau null,
  "nama_pengirim": "nama pemilik rekening pengirim" atau null,
  "nomor_referensi": "nomor referensi/resi/BIZ ID transfer" atau null,
  "raw_text": "semua teks yang terbaca dari gambar, gabung dalam satu string"
}

ATURAN PENTING:
- "nominal" = jumlah yang sampai ke rekening penerima (yang dipakai untuk mencocokkan tagihan).
- "biaya_admin" = biaya transfer (mis. "Biaya transaksi Rp 2.500", "BI-FAST Rp 2.500"). null jika tidak terlihat.
- "total_dibayar" = nilai paling akhir/bawah, biasanya berlabel "Total" dan SAMA DENGAN nominal + biaya_admin.
- Kalau bukti hanya menyebut satu angka saja (tidak ada rincian biaya), isi "nominal" dengan angka itu dan biarkan "biaya_admin"=null, "total_dibayar"=null.
- Kalau ada rincian "Nominal Rp X" DAN "Total Rp Y" dimana Y > X, ekstrak KEDUANYA (nominal=X, total_dibayar=Y, biaya_admin=Y-X).
- Kembalikan HANYA JSON valid tanpa markdown code block, tanpa penjelasan.
- Jika gambar bukan bukti transfer (foto biasa, meme, dokumen lain), kembalikan JSON dengan semua field null dan raw_text berisi deskripsi singkat gambar.
- Semua angka harus integer (tanpa titik/koma/desimal) dalam Rupiah.
- Jangan menambahkan field apapun selain yang diminta.`;

// ─── Vision LLM call ──────────────────────────────────────────────────────────

function emptyOcr(rawText = ""): OcrData {
  return {
    bank_pengirim:   null,
    bank_tujuan:     null,
    nominal:         null,
    biaya_admin:     null,
    total_dibayar:   null,
    tanggal:         null,
    nama_pengirim:   null,
    nomor_referensi: null,
    raw_text:        rawText,
  };
}

function normalizeOcrData(parsed: Record<string, any>): OcrData {
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    bank_pengirim:   parsed.bank_pengirim   ?? null,
    bank_tujuan:     parsed.bank_tujuan     ?? null,
    nominal:         numOrNull(parsed.nominal),
    biaya_admin:     numOrNull(parsed.biaya_admin),
    total_dibayar:   numOrNull(parsed.total_dibayar),
    tanggal:         parsed.tanggal         ?? null,
    nama_pengirim:   parsed.nama_pengirim   ?? null,
    nomor_referensi: parsed.nomor_referensi ?? null,
    raw_text:        parsed.raw_text        ?? "",
  };
}

async function callVisionLlm(
  config:   AiClientConfig,
  imageUrl: string,
): Promise<OcrData> {
  try {
    const result = await chatCompletion(
      { ...config, timeoutMs: 30_000 },
      [
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
        } as any,
      ],
      { temperature: 0.1, maxTokens: 1000 },
    );

    if (!result.ok) {
      console.error("[PaymentProof] Vision LLM HTTP error:", result.status, result.error);
      return emptyOcr(`LLM error ${result.status ?? "unknown"}`);
    }

    const jsonText = extractJsonObject(result.content);
    if (!jsonText) {
      console.error("[PaymentProof] Vision OCR returned empty/invalid JSON");
      return emptyOcr("OCR error: invalid JSON");
    }

    const parsed = JSON.parse(jsonText);
    return normalizeOcrData(parsed);
  } catch (e: any) {
    console.error("[PaymentProof] Vision OCR error:", e);
    return emptyOcr(`OCR error: ${e.message ?? e}`);
  }
}

// ─── Booking matcher ──────────────────────────────────────────────────────────

const AMOUNT_TOLERANCE = 1000; // ± Rp 1.000

/**
 * Build the list of candidate amounts to compare against the booking total.
 * Indonesian transfer receipts may show either the principal (nominal) OR
 * the debited total (nominal + biaya). The hotel always receives the
 * principal, but OCR may pick up either depending on which figure is most
 * prominent. We try every plausible variant so a Rp 200.000 booking still
 * matches a receipt showing nominal=200000/biaya=2500/total=202500.
 */
function buildAmountCandidates(ocr: OcrData): number[] {
  const cands = new Set<number>();
  const push = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) cands.add(n);
  };
  push(ocr.nominal);
  push(ocr.total_dibayar);
  if (ocr.nominal != null && ocr.biaya_admin != null) {
    push(ocr.nominal - ocr.biaya_admin);
    push(ocr.nominal + ocr.biaya_admin);
  }
  if (ocr.total_dibayar != null && ocr.biaya_admin != null) {
    push(ocr.total_dibayar - ocr.biaya_admin);
  }
  return [...cands];
}

async function findMatchingBooking(
  db:       Db,
  phone:    string,
  ocr:      OcrData,
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

  const candidates = buildAmountCandidates(ocr);

  // If OCR didn't extract any usable amount, surface the most recent booking
  // as ambiguous so the agent can ask the guest for the booking code.
  if (candidates.length === 0) {
    const latest = bookings[0] as any;
    return {
      status: "ambiguous",
      booking_code: latest.reference_code ?? null,
      booking_amount: Number(latest.total_amount) || null,
      amount_diff: null,
    };
  }

  // Try matching every booking against every amount candidate. Pick the
  // pairing with the smallest abs(diff) within tolerance.
  type Pair = { booking: any; amount: number; diff: number };
  const allPairs: Pair[] = [];
  for (const b of bookings) {
    const amt = Number((b as any).total_amount);
    if (!Number.isFinite(amt)) continue;
    for (const c of candidates) {
      allPairs.push({ booking: b, amount: c, diff: c - amt });
    }
  }
  const within = allPairs
    .filter((p) => Math.abs(p.diff) <= AMOUNT_TOLERANCE)
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));

  // Distinct bookings that hit the tolerance — used to disambiguate.
  const uniqueMatchedBookings = new Set(within.map((p) => (p.booking as any).id));

  if (uniqueMatchedBookings.size === 1) {
    const m = within[0];
    return {
      status: "matched",
      booking_code: (m.booking as any).reference_code ?? null,
      booking_amount: Number((m.booking as any).total_amount) || null,
      amount_diff: m.diff,
    };
  }

  if (uniqueMatchedBookings.size > 1) {
    const m = within[0];
    return {
      status: "ambiguous",
      booking_code: (m.booking as any).reference_code ?? null,
      booking_amount: Number((m.booking as any).total_amount) || null,
      amount_diff: m.diff,
    };
  }

  // No tolerance hit — return the closest pair as unmatched so the agent
  // can quote the actual diff to the guest.
  const closest = allPairs.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
  if (!closest) {
    const latest = bookings[0] as any;
    return {
      status: "unmatched",
      booking_code: latest.reference_code ?? null,
      booking_amount: Number(latest.total_amount) || null,
      amount_diff: null,
    };
  }
  return {
    status: "unmatched",
    booking_code: (closest.booking as any).reference_code ?? null,
    booking_amount: Number((closest.booking as any).total_amount) || null,
    amount_diff: closest.diff,
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
  const llmConfig = await resolveVisionConfig(db);
  if (!llmConfig) {
    console.warn(`${tag} Tidak ada konfigurasi LLM — skip OCR`);
    return {
      ok: false,
      ocr: emptyOcr(),
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
  const match = await findMatchingBooking(db, phone, ocr);
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
 * Run Vision OCR + booking match WITHOUT writing to whatsapp_messages.metadata.
 * Used by the AI Lab simulator so admins can test the OCR flow against a real
 * image without leaving artefacts in the WA message table.
 */
export async function runOcrAndMatch(
  db:       Db,
  imageUrl: string,
  phone:    string,
): Promise<PaymentProofResult> {
  const llmConfig = await resolveVisionConfig(db);
  if (!llmConfig) {
    return {
      ok: false,
      ocr: emptyOcr(),
      match: {
        status: "no_pending_booking",
        booking_code: null, booking_amount: null, amount_diff: null,
      },
      error: "LLM not configured",
    };
  }
  const ocr = await callVisionLlm(llmConfig, imageUrl);
  const match = await findMatchingBooking(db, phone, ocr);
  return { ok: true, ocr, match };
}

/**
 * Format nominal as Indonesian Rupiah string.
 */
export function formatRupiahOcr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return "Rp " + value.toLocaleString("id-ID");
}
