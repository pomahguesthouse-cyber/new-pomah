import type { ManagerRole } from "./rbac";

export function buildManagerHelp(role: ManagerRole | null | undefined): string {
  const roleLabel =
    role === "super_admin" ? "Super Admin" : role === "booking_manager" ? "Booking Manager" : role === "viewer" ? "Viewer" : "Tidak diketahui";

  const lines = [
    `Asisten Admin — peran: ${roleLabel}`,
    "",
    "Lihat data:",
    "• daftar booking / booking terbaru / booking hari ini",
    "• check-in hari ini / check-in besok / check-out hari ini / check-out besok",
    "• booking 11–14 Des / cari Budi / detail PG-XXXX",
    "• belum lunas / tamu menginap / okupansi hari ini",
    "• mutasi hari ini",
    "• ketersediaan Deluxe 12–14 Des",
    "• lagi  → halaman berikutnya",
  ];

  if (role === "super_admin" || role === "booking_manager") {
    lines.push(
      "",
      "Ubah data (wajib preview, lalu balas YA atau KONFIRMASI):",
      "• buat booking Single atas nama Budi 12–14 Des 1 orang",
      "• tandai lunas PG-XXXX / tandai DP PG-XXXX",
      "• check-in PG-XXXX / check-out PG-XXXX / batalkan PG-XXXX",
      "• kirim invoice PG-XXXX ke tamu",
      "• kirim brosur ke 0812xxxx",
    );
  }

  if (role === "super_admin") {
    lines.push(
      "",
      "Harga (super admin, tetap wajib konfirmasi):",
      "• lihat harga",
      "• ubah harga Single menjadi 250 rb",
    );
  } else if (role === "booking_manager") {
    lines.push("", "Peran Booking Manager tidak dapat mengubah harga sistem.");
  } else if (role === "viewer") {
    lines.push("", "Peran Viewer hanya dapat melihat data, tidak mengubah booking atau pembayaran.");
  }

  lines.push(
    "",
    "Lainnya:",
    "• mode tamu  → tes alur chatbot tamu dari nomor ini",
    "• mode manajer  → kembali ke Asisten Admin",
    "• bantuan",
    "",
    "Balas YA atau KONFIRMASI untuk menyetujui ringkasan. Balas BATAL untuk membatalkan.",
  );

  return lines.join("\n");
}
