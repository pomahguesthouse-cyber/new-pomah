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
import { phoneVariants } from "@/lib/phone";
import {
  chatCompletion,
  extractJsonObject,
  resolvePropertyAiConfig,
  type AiClientConfig,
} from "@/services/ai-client.service";
import {
  candidateFromBookingRow,
  candidateFromDraftRow,
  matchProofToCandidates,
  minimumCheckoutDate,
  type PaymentMatchCandidate,
  type PaymentMatchResult,
  type PaymentProofOcrInput,
} from "@/services/payment-proof-match";

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

export type MatchResult = PaymentMatchResult;

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
        },
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

const BOOKING_MATCH_SELECT =
  "id, reference_code, total_amount, paid_amount, nights, check_in, check_out, status, payment_status, created_at, guest_id, room_types(name), booking_rooms(room_types(name))";
const BOOKING_MATCH_SELECT_PLAIN =
  "id, reference_code, total_amount, paid_amount, nights, check_in, check_out, status, payment_status, created_at, guest_id";

function unavailableMatch(reason: string): MatchResult {
  const match = matchProofToCandidates(null, []);
  return { ...match, match_reason: reason };
}

async function selectRows(
  query: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message ?? "query failed");
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}

async function loadGuestIds(db: Db, variants: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const pulls = [
    db.from("guests").select("id").in("phone", variants).limit(20),
    db.from("guests").select("id").in("phone_normalized", variants).limit(20),
  ];
  for (const pull of pulls) {
    try {
      const rows = await selectRows(pull);
      for (const row of rows) {
        if (typeof row.id === "string" && row.id) ids.add(row.id);
      }
    } catch (e) {
      console.warn("[PaymentProof] baca tamu gagal:", e instanceof Error ? e.message : e);
    }
  }
  return [...ids];
}

async function loadBookingRows(db: Db, guestIds: string[], minCheckout: string): Promise<Record<string, unknown>[]> {
  if (guestIds.length === 0) return [];
  const run = (columns: string) =>
    db
      .from("bookings")
      .select(columns)
      .in("guest_id", guestIds)
      .neq("status", "cancelled")
      .gte("check_out", minCheckout)
      .order("created_at", { ascending: false })
      .limit(40);
  try {
    return await selectRows(run(BOOKING_MATCH_SELECT));
  } catch (e) {
    console.warn("[PaymentProof] baca kamar booking gagal, coba tanpa relasi:", e instanceof Error ? e.message : e);
  }
  return selectRows(run(BOOKING_MATCH_SELECT_PLAIN));
}

async function loadDraftRows(db: Db, variants: string[], minCheckout: string, sinceIso: string): Promise<Record<string, unknown>[]> {
  try {
    return await selectRows(
      db
        .from("booking_drafts")
        .select("id, phone, check_in, check_out, room_type, quoted_total, payload, status, booking_code, created_at")
        .in("phone", variants)
        .in("status", ["draft", "failed"])
        .gte("check_out", minCheckout)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(20),
    );
  } catch (e) {
    console.warn("[PaymentProof] booking_drafts tidak dibaca:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Booking non-batal milik nomor ini (semua varian nomor) plus draft baru,
 * yang masih punya sisa dan check-out >= kemarin (WIB). Tidak mengubah booking.
 */
export async function loadPaymentMatchCandidates(
  db: Db,
  phone: string,
  now: Date = new Date(),
): Promise<PaymentMatchCandidate[]> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return [];
  const minCheckout = minimumCheckoutDate(now);
  const sinceIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const guestIds = await loadGuestIds(db, variants);
  const [bookingRows, draftRows] = await Promise.all([
    loadBookingRows(db, guestIds, minCheckout),
    loadDraftRows(db, variants, minCheckout, sinceIso),
  ]);
  const bookings = bookingRows
    .map(candidateFromBookingRow)
    .filter((candidate) => candidate.bookingCode);
  const codes = new Set(bookings.map((candidate) => candidate.bookingCode.toUpperCase()));
  const drafts = draftRows
    .map(candidateFromDraftRow)
    .filter((candidate) => !codes.has(candidate.bookingCode.toUpperCase()));
  return [...bookings, ...drafts];
}

export async function matchPaymentProof(
  db: Db,
  phone: string,
  ocr: PaymentProofOcrInput,
  options?: { now?: Date; note?: string | null },
): Promise<MatchResult> {
  const now = options?.now ?? new Date();
  if (!phone.trim()) {
    return matchProofToCandidates(ocr, [], { now, note: options?.note });
  }
  try {
    const candidates = await loadPaymentMatchCandidates(db, phone, now);
    return matchProofToCandidates(ocr, candidates, { now, note: options?.note });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn("[PaymentProof] pencocokan gagal (booking tidak diubah):", reason);
    const empty = matchProofToCandidates(ocr, [], { now, note: options?.note });
    return {
      ...empty,
      status: empty.status === "no_pending_booking" ? "unmatched" : empty.status,
      match_reason: `Pencocokan gagal dibaca (${reason.slice(0, 120)}). Status pembayaran tidak diubah.`,
      summary: empty.summary,
    };
  }
}

async function findMatchingBooking(db: Db, phone: string, ocr: OcrData): Promise<MatchResult> {
  return matchPaymentProof(db, phone, ocr);
}

async function persistOcrMetadata(
  db: Db,
  messageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await (db as any).rpc("save_message_metadata", {
      p_message_id: messageId,
      p_metadata: patch,
    });
    if (error) console.warn("[PaymentProof] Gagal simpan OCR metadata:", error.message ?? error);
  } catch (e) {
    console.warn("[PaymentProof] Gagal simpan OCR metadata:", e);
  }
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
    await persistOcrMetadata(db, messageId, {
      ocr_status: "failed",
      ocr_reason: "llm_not_configured",
    });
    return {
      ok: false,
      ocr: emptyOcr(),
      match: unavailableMatch("OCR tidak dijalankan: LLM belum dikonfigurasi."),
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

  // callVisionLlm menelan error jaringan sebagai raw_text, bukan throw.
  const visionFailed = /^(LLM error|OCR error)\b/i.test(ocr.raw_text ?? "");
  // 4. Gabungkan hasil OCR ke metadata (jsonb ||), jangan menimpa storage_path.
  await persistOcrMetadata(db, messageId, {
    ocr_result: ocr,
    ocr_match: match,
    ocr_analyzed_at: new Date().toISOString(),
    ocr_status: visionFailed ? "failed" : "ok",
    ocr_reason: visionFailed ? ocr.raw_text.slice(0, 180) : null,
  });

  return visionFailed
    ? { ok: false, ocr, match, error: ocr.raw_text.slice(0, 180) }
    : { ok: true, ocr, match };
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
      match: unavailableMatch("OCR tidak dijalankan: LLM belum dikonfigurasi."),
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
