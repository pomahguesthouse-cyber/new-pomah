/**
 * Setelah staf membalas manual, bot diam selama jendela ini.
 * Angka ini sengaja satu konstanta supaya mudah diubah.
 */
export const STAFF_REPLY_SILENCE_MS = 60 * 60 * 1000;

type OutboundMeta = Record<string, unknown>;

function asMeta(value: unknown): OutboundMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as OutboundMeta;
}

/**
 * Outbound manusia (bukan bot/ack). Selaras dengan penanda yang sudah dipakai
 * worker: is_native_human, source whatsapp_native, atau tanpa agent dan bukan otomatis.
 */
export function isStaffOutboundMetadata(metadata: unknown): boolean {
  const md = asMeta(metadata);
  if (!md) return false;
  if (md.is_ack === true || md.handoff_ack === true || md.is_automated === true) return false;
  if (md.agent || md.agent_key) return false;
  const source = typeof md.source === "string" ? md.source : "";
  if (/bot|autoreply|orchestrator|\bai\b/i.test(source) && md.is_native_human !== true)
    return false;
  if (md.is_native_human === true || source === "whatsapp_native") return true;
  return !md.agent && !md.agent_key && md.is_automated !== true;
}

export type SilenceMessage = {
  direction?: string | null;
  sent_at?: string | null;
  metadata?: unknown;
};

/** ISO akhir diam, atau null bila tidak ada balasan staf dalam jendela. */
export function staffSilenceUntil(messages: SilenceMessage[], now = Date.now()): string | null {
  const cutoff = now - STAFF_REPLY_SILENCE_MS;
  let latest: number | null = null;
  for (const message of messages) {
    if (message.direction !== "out") continue;
    if (!isStaffOutboundMetadata(message.metadata)) continue;
    const sent = Date.parse(message.sent_at ?? "");
    if (!Number.isFinite(sent) || sent < cutoff || sent > now) continue;
    if (latest === null || sent > latest) latest = sent;
  }
  if (latest === null) return null;
  return new Date(latest + STAFF_REPLY_SILENCE_MS).toISOString();
}
