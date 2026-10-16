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

/** Aturan pembayaran pemilik, untuk prompt bot. 1–2 malam wajib lunas; DP 50% hanya 3+ malam. */
export function botPaymentRuleText(): string {
  const transfer = formatTransferAccountLine();
  return (
    "ATURAN PEMBAYARAN (PEMILIK): Pemesanan 1–2 malam WAJIB LUNAS (tidak ada opsi DP 50%), " +
    `dibayar penuh via transfer ke ${transfer} sebelum kedatangan. ` +
    "TIDAK ADA opsi bayar di tempat / saat check-in untuk booking baru; bila tamu menanyakannya, " +
    "jelaskan dengan sopan bahwa pembayaran dilakukan via transfer sebelum kedatangan. " +
    "DP 50% hanya untuk menginap 3 malam atau lebih (jangan ubah persentase atau nominal DP). " +
    `Untuk DP 3 malam atau lebih, sebut juga transfer ke ${transfer}. ` +
    "Bila tamu 1–2 malam minta DP, jelaskan dengan sopan: 'pemesanan 1–2 malam wajib lunas'."
  );
}
