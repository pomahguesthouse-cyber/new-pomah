/**
 * Rule-based intent classification for a single WhatsApp message.
 *
 * Fast, zero-cost (no LLM call).  Used to attach a human-readable intent
 * badge to incoming messages immediately, before AI processing begins.
 */

const RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(halo|hai|hi|pagi|siang|sore|malam|assalam|selamat)\b/i,                         label: "Sapaan" },
  { pattern: /(harga|tarif|biaya|rate|price|berapa)/i,                                             label: "Tanya Harga" },
  // Pilih / ambil kamar (+ opsional minta dibantu bayar) → alur booking, bukan FAQ Pembayaran.
  // Insiden Syahrul Alwi 5 Nov 2026: "saya ambil yg single… dibantu pembayarannya" ter-label Pembayaran.
  { pattern: /\b(?:(?:saya|kami|kita|mau|ingin)\s+)?(?:ambil|pilih|pesan)\s+(?:yg|yang|kamar|tipe|single|deluxe|family|grand)?/i, label: "Booking" },
  { pattern: /(tersedia|available|kosong|booking|pesan|reservasi|cek|check)/i,                    label: "Cek Ketersediaan" },
  { pattern: /(lokasi|alamat|dimana|jarak|jauh|dekat|map|peta|arah|rute|unnes|kampus|pusat|kota)/i, label: "Tanya Lokasi" },
  { pattern: /(fasilitas|wifi|sarapan|parkir|cafe|kolam|gym|ameniti|fitur)/i,                     label: "Tanya Fasilitas" },
  { pattern: /(check.?in|check.?out|waktu|jam|kapan|lama)/i,                                      label: "Kebijakan" },
  { pattern: /(rusak|broken|mati|tidak (bisa|berfungsi)|macet|bocor|keluhan|komplain)/i,           label: "Keluhan" },
  { pattern: /(bayar|transfer|payment|invoice|tagihan|bukti|rekening)/i,                           label: "Pembayaran" },
  { pattern: /(terima kasih|makasih|thanks|terimakasih)/i,                                        label: "Apresiasi" },
];

export function classifyMessageIntent(text: string): string {
  for (const { pattern, label } of RULES) {
    if (pattern.test(text)) return label;
  }
  return "Pertanyaan Umum";
}
