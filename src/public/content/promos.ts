/**
 * Konten promo Pomah Guesthouse — teks pemasaran saja.
 * Sengaja tanpa angka harga, persen, atau nominal: harga final
 * selalu mengikuti sistem dan tidak dihitung dari sini.
 */

export type Promo = {
  id: string;
  title: string;
  description: string;
  rooms: string;
};

export const PROMO_TERMS_NOTE = "Syarat & ketentuan berlaku, harga final mengikuti sistem.";

/**
 * Sitemap `<lastmod>` for `/promo` is PROMO_CONTENT_UPDATED_AT in public-seo.
 * Bump that constant when this copy or the promo page changes.
 */

export const PROMOS: readonly Promo[] = [
  {
    id: "hari-kerja-deluxe",
    title: "Promo hari kerja Deluxe",
    description:
      "Menginap malam Senin sampai Kamis di kamar Deluxe dengan harga khusus untuk booking langsung via WhatsApp atau website.",
    rooms: "Deluxe",
  },
  {
    id: "paket-wisuda",
    title: "Paket wisuda & acara kampus",
    description:
      "Datang bersama keluarga untuk wisuda atau acara kampus? Dapatkan bonus late check-out di Family Room 222 dan Family Suite 100.",
    rooms: "Family Room 222 & Family Suite 100",
  },
  {
    id: "tiga-malam-hari-kerja",
    title: "Menginap tiga malam di hari kerja",
    description:
      "Menginap tiga malam di hari kerja dan nikmati potongan untuk malam ketiga. Khusus kamar Single, bonusnya berupa late check-out.",
    rooms: "Semua tipe kamar",
  },
  {
    id: "tamu-lama",
    title: "Tamu lama booking ulang",
    description:
      "Pernah menginap di Pomah? Booking ulang via WhatsApp dan dapatkan potongan kecil atau gratis late check-out.",
    rooms: "Semua tipe kamar",
  },
  {
    id: "upgrade-grand-deluxe",
    title: "Upgrade hemat ke Grand Deluxe",
    description:
      "Untuk tamu Deluxe, tersedia upgrade hemat ke Grand Deluxe bila kamarnya masih kosong di hari kedatangan.",
    rooms: "Deluxe ke Grand Deluxe",
  },
];

/** Link WhatsApp dengan pesan terisi nama promo; null bila nomor kosong. */
export function promoWhatsAppHref(whatsappNumber: string | null | undefined, promo: Pick<Promo, "title">): string | null {
  const digits = String(whatsappNumber ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const text = `Halo Pomah, saya ingin tanya tentang promo "${promo.title}".`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
