const INTERNAL_GUEST_ROLE_REPLACEMENTS: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  {
    pattern:
      /\bSaya\s+([\p{L}][\p{L}\s.'-]{0,40}),\s*(?:seorang\s+)?(?:Pricing Specialist|Pricing Agent|Front Office Specialist|Front Office Agent|Booking Specialist|Reservation Specialist)(?:\s+di\s+sini)?[.!]?\s*/giu,
    replacement: "Saya $1 siap membantu.\n\n",
  },
  {
    pattern:
      /\b(?:sebagai\s+)?(?:Pricing Specialist|Pricing Agent|Front Office Specialist|Front Office Agent|Booking Specialist|Reservation Specialist)\b[,.]?\s*/giu,
    replacement: "",
  },
];

/**
 * Hilangkan jabatan internal agent dari balasan untuk tamu.
 * Nama persona boleh disebut, tetapi detail routing seperti Pricing Specialist
 * tidak boleh tampil di WhatsApp karena membingungkan dan terasa tidak natural.
 */
export function sanitizeGuestFacingRoleDisclosure(reply: string): string {
  let out = reply;
  for (const rule of INTERNAL_GUEST_ROLE_REPLACEMENTS) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}
