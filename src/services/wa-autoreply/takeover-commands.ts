/**
 * Perintah ambil alih percakapan lewat chat WhatsApp.
 *
 * Dua cara pakai:
 * 1. Operator mengetik `/human` atau `/ai` LANGSUNG di chat tamu dari HP-nya
 *    (pesan fromMe). Thread tamu itu yang diubah.
 * 2. Manajer/admin mengirim `/human 0812xxxx` atau `/ai 0812xxxx` ke nomor bot,
 *    dengan nomor tamu sebagai argumen.
 */
import { normalizePhone } from "./identity";

export type TakeoverMode = "human" | "ai";

export type TakeoverCommand = {
  mode: TakeoverMode;
  /** Nomor tamu target (sudah dinormalisasi) bila perintah menyertakan nomor. */
  targetPhone: string | null;
};

const HUMAN_KEYWORDS = ["human", "manusia", "takeover", "admin"];
const AI_KEYWORDS = ["ai", "bot", "auto"];

/** Kembalikan perintah takeover bila body pesan adalah perintah, selain itu null. */
export function parseTakeoverCommand(body: string): TakeoverCommand | null {
  const text = String(body ?? "").trim();
  const match = text.match(/^[/!.]([a-zA-Z]+)\s*(.*)$/);
  if (!match) return null;

  const keyword = (match[1] ?? "").toLowerCase();
  const rest = (match[2] ?? "").trim();

  let mode: TakeoverMode | null = null;
  if (HUMAN_KEYWORDS.includes(keyword)) mode = "human";
  else if (AI_KEYWORDS.includes(keyword)) mode = "ai";
  if (!mode) return null;

  const digits = rest.replace(/[^\d]/g, "");
  const targetPhone = digits.length >= 8 ? normalizePhone(digits) : null;
  return { mode, targetPhone };
}

type Db = {
  from: (table: string) => any;
};

/**
 * Terapkan mode ke thread: `human` mematikan AI auto, `ai` menyalakannya lagi
 * dan menghapus jeda human-takeover supaya bot langsung aktif.
 */
export async function applyTakeoverMode(
  db: Db,
  threadId: string,
  mode: TakeoverMode,
): Promise<void> {
  await db
    .from("whatsapp_threads")
    .update(
      mode === "human"
        ? { ai_auto: false, ai_paused_until: null }
        : { ai_auto: true, ai_paused_until: null },
    )
    .eq("id", threadId);
}

/** Catat perintah sebagai pesan internal supaya terlihat di inbox admin. */
export async function logTakeoverNote(
  db: Db,
  threadId: string,
  mode: TakeoverMode,
  actorLabel: string,
): Promise<void> {
  const note =
    mode === "human"
      ? `AI dinonaktifkan — percakapan diambil alih oleh ${actorLabel}.`
      : `AI diaktifkan kembali oleh ${actorLabel}.`;
  await db.from("whatsapp_messages").insert({
    thread_id: threadId,
    direction: "out",
    body: `[sistem] ${note}`,
    metadata: { is_system_command: true, takeover_mode: mode, source: "wa_command" },
  });
}

/** Cari thread berdasarkan nomor; buat baru bila belum ada. */
export async function resolveThreadIdByPhone(
  db: Db,
  phone: string,
  displayName?: string | null,
): Promise<string | null> {
  const { data: existing } = await db
    .from("whatsapp_threads")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created } = await db
    .from("whatsapp_threads")
    .insert({
      phone,
      display_name: displayName || phone,
      status: "open",
      unread_count: 0,
    })
    .select("id")
    .single();
  return created?.id ?? null;
}
