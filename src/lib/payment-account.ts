/**
 * Satu-satunya rekening transfer yang boleh disebut bot ke tamu.
 *
 * Kolom `properties.payment_*` tetap dibaca admin/invoice publik, tetapi
 * salinan tamu (FAQ, prompt, ringkasan, invoice WA, tool pembayaran) wajib
 * lewat modul ini. Nomor lain di config tidak ikut disebut, supaya tidak
 * ada dua versi rekening.
 */

export const OFFICIAL_TRANSFER_ACCOUNT = {
  bankName: "BCA",
  accountNumber: "0095584379",
  accountHolder: "Faizal Abdurachman",
} as const;

export type TransferAccount = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

export type PropertyPaymentFields = {
  payment_bank_name?: string | null;
  payment_account_number?: string | null;
  payment_account_holder?: string | null;
};

function digits(value: string): string {
  return value.replace(/\s+/g, "");
}

/** Rekening yang disebut bot. Rekening resmi menang bila config kosong atau berbeda. */
export function resolveBotTransferAccount(
  property?: PropertyPaymentFields | null,
): TransferAccount {
  const bank = (property?.payment_bank_name ?? "").trim();
  const number = digits((property?.payment_account_number ?? "").trim());
  const holder = (property?.payment_account_holder ?? "").trim();
  const officialNumber = OFFICIAL_TRANSFER_ACCOUNT.accountNumber;
  const sameNumber = number === officialNumber;
  return {
    bankName: sameNumber && bank ? bank : OFFICIAL_TRANSFER_ACCOUNT.bankName,
    accountNumber: officialNumber,
    accountHolder: sameNumber && holder ? holder : OFFICIAL_TRANSFER_ACCOUNT.accountHolder,
  };
}

/** "BCA 0095584379 a.n. Faizal Abdurachman" */
export function formatTransferAccountLine(
  account: TransferAccount = OFFICIAL_TRANSFER_ACCOUNT,
): string {
  return `${account.bankName} ${account.accountNumber} a.n. ${account.accountHolder}`;
}

export function toPaymentAccountFields(property?: PropertyPaymentFields | null): {
  bank: string;
  no_rekening: string;
  atas_nama: string;
} {
  const account = resolveBotTransferAccount(property);
  return {
    bank: account.bankName,
    no_rekening: account.accountNumber,
    atas_nama: account.accountHolder,
  };
}

/** Aturan pembayaran pemilik, untuk prompt bot. Angka DP 2+ malam tidak diubah (50%). */
export function botPaymentRuleText(): string {
  const transfer = formatTransferAccountLine();
  return (
    "ATURAN PEMBAYARAN (PEMILIK): Menginap 1 malam TIDAK ada DP. " +
    `Tamu bisa bayar langsung di tempat (lunas saat check-in) atau transfer ke ${transfer}. ` +
    "Booking 1 malam tetap dicatat tanpa DP; JANGAN pernah menjawab 'tidak bisa bayar di tempat'. " +
    "DP 50% hanya untuk menginap 2 malam atau lebih (jangan ubah persentase atau nominal DP). " +
    `Untuk DP 2 malam atau lebih, sebut juga transfer ke ${transfer}.`
  );
}
