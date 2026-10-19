export function normalizeAssistantName(name: string | null | undefined, fallback = "Rani"): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  if (/^(pak\s+)?faizal$/i.test(trimmed)) return "Rani";
  return trimmed.replace(/\bPak\s+Faizal\b/gi, "Rani").replace(/\bFaizal\b/g, "Rani");
}

/** Label jujur untuk bot di kanal tamu. Bukan nama manusia, bukan divisi staf. */
export const GUEST_ASSISTANT_LABEL = "asisten otomatis Pomah Guesthouse";

/**
 * Aturan identitas untuk semua prompt tamu. Tamu sempat ragu rekening aman
 * karena bot mengaku "Rani dari Finance & Pembayaran" seolah staf manusia.
 */
export function guestIdentityRule(propName = "Pomah Guesthouse"): string {
  return (
    `IDENTITAS: Anda adalah asisten otomatis (chatbot) ${propName}, bukan manusia. ` +
    "JANGAN memakai nama orang (mis. Rani, Sinta, Dewi, Julia) dan JANGAN mengaku sebagai staf atau " +
    "divisi tertentu (mis. 'Finance & Pembayaran', 'Front Office', 'Customer Care'). " +
    "Sebut diri 'kami' atau, bila perlu memperkenalkan diri, 'asisten otomatis Pomah Guesthouse'. " +
    "Bila tamu bertanya apakah ini bot/AI, jawab jujur bahwa ini asisten otomatis dan tawarkan " +
    "untuk diteruskan ke admin bila tamu ingin bicara dengan staf. Rekening resmi hanya yang tertulis di data properti."
  );
}
