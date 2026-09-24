/**
 * Gerbang poll inbox Evolution.
 *
 * Nomor tamu resmi sudah pindah ke Meta Cloud API. Poll Evolution yang
 * memutar ulang `messages.upsert` ke `/api/evolution` bisa menyusup ke
 * percakapan tamu. Default: bila Meta terkonfigurasi dan kanal tamu
 * bukan Evolution, poll tidak jalan.
 *
 * Balikkan dengan salah satu (tanpa menghapus kode Evolution):
 *   EVOLUTION_INBOX_POLL_ENABLED=true   — paksa poll (pemulihan internal)
 *   WA_PRIMARY_GUEST_CHANNEL=evolution  — tamu masih di Evolution
 *   EVOLUTION_INBOX_POLL_ENABLED=false  — matikan poll walau Meta belum ada
 *
 * Webhook `/api/evolution` tidak disentuh di sini, supaya alur staf/internal
 * yang masih menerima event langsung tetap hidup.
 */

export interface EvolutionPollEnv {
  EVOLUTION_INBOX_POLL_ENABLED?: string;
  LOVABLE_API_KEY?: string;
  WHATSAPP_API_KEY?: string;
  WA_PRIMARY_GUEST_CHANNEL?: string;
}

export function evolutionInboxPollDecision(env: EvolutionPollEnv): {
  run: boolean;
  reason: string;
} {
  const flag = (env.EVOLUTION_INBOX_POLL_ENABLED ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    return { run: false, reason: "EVOLUTION_INBOX_POLL_ENABLED menonaktifkan poll" };
  }
  if (flag === "1" || flag === "true" || flag === "on") {
    return { run: true, reason: "EVOLUTION_INBOX_POLL_ENABLED memaksa poll (internal)" };
  }

  const metaConfigured = Boolean(env.LOVABLE_API_KEY?.trim() && env.WHATSAPP_API_KEY?.trim());
  const primary = (env.WA_PRIMARY_GUEST_CHANNEL ?? "meta").trim().toLowerCase();
  if (metaConfigured && primary !== "evolution") {
    return {
      run: false,
      reason: "kanal tamu Meta aktif; evolution-inbox-poll tidak memutar ulang pesan tamu",
    };
  }
  return { run: true, reason: "Meta belum menjadi kanal tamu; poll Evolution tetap jalan" };
}
