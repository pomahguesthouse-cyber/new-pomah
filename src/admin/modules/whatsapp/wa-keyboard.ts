/**
 * Atribut keyboard untuk kolom ketik di layar WhatsApp admin: koreksi otomatis,
 * cek ejaan, saran kata (Gboard / Samsung Keyboard di app Android & web),
 * huruf besar awal kalimat, bahasa Indonesia.
 *
 * Tanpa atribut eksplisit sebagian keyboard Android di WebView memperlakukan
 * textarea sebagai kolom "tanpa saran" (seperti kolom kode/nama pengguna).
 */
export const WA_KEYBOARD_TEXT_PROPS = {
  spellCheck: true,
  autoCorrect: "on",
  autoCapitalize: "sentences",
  autoComplete: "on",
  lang: "id",
  inputMode: "text",
} as const;
