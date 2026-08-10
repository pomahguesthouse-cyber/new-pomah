/**
 * Normalisasi nama tipe kamar yang datang dari manusia atau dari LLM.
 *
 * Insiden 10 Agu 2026 (Telegram, agen Juminten): manajer mengetik
 * "rubah harga single 250 rb". Perintah tidak tertangkap parser deterministik,
 * jatuh ke LLM, dan LLM meneruskan `room_type: "kamar Single menjadi"` ke
 * `update_room_rate`. Resolver menolaknya ("Tipe kamar ... tidak ditemukan"),
 * lalu percakapan berputar ke balasan "kendala teknis".
 *
 * Helper ini dipakai DUA sisi supaya masalah itu tertutup dari dua arah:
 *   • parser perintah manajer (`manager-command-parser.ts`), dan
 *   • resolver tool pricing (`tools/pricing/_resolve-room-type.ts`).
 */

/** Kata pengisi di DEPAN nama kamar. */
const LEADING = /^(?:untuk|buat|di|pada|harga|tarif|tipe\s+kamar|kamar|tipe|room)\s+/i;
/** Kata pengisi di BELAKANG nama kamar. */
const TRAILING = /\s+(?:menjadi|jadi|ke|sebesar|senilai|saja|yg|yang|tersebut|itu)$/i;

/**
 * Buang kata pengisi di sekitar nama tipe kamar.
 * "kamar Single menjadi" → "Single"; "tipe kamar deluxe saja" → "deluxe".
 * Nama kamar yang sah (mis. "Family Suite 100") tidak berubah.
 */
export function stripRoomNoise(raw: string): string {
  let out = String(raw ?? "").trim();
  // Beberapa lintasan: "kamar tipe deluxe saja menjadi" butuh >1 iterasi.
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = out
      .replace(LEADING, "")
      .replace(TRAILING, "")
      .replace(/[=:,.\s]+$/g, "")
      .trim();
    if (out === before) break;
  }
  // Kalau pengupasan menghabiskan seluruh string, kembalikan input asli —
  // lebih baik gagal dengan pesan berisi kata asli manajer daripada string kosong.
  return out || String(raw ?? "").trim();
}

/**
 * Token bermakna dari sebuah nama kamar, untuk pencocokan longgar.
 * "Family Suite 100" → ["family", "suite", "100"].
 */
export function roomNameTokens(name: string): string[] {
  return String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0 && !["kamar", "tipe", "room", "type"].includes(t));
}
