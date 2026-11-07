# Perbaikan alur chatbot kasus Sofiah (7 tamu, 11 Des)

Hanya plan. Tidak ada edit kode, SQL mutation, kirim WA, publish/deploy, atau merge.

## Temuan audit (terverifikasi di kode)

1. **Kapasitas kombinasi dilebih-lebihkan** — `src/tools/availability.tool.ts` `buildRoomCombinationRecommendations` (baris ~171-208):
   - `total_kapasitas_maksimal` = jumlah kapasitas kamar + SEMUA slot extra bed yang mungkin (3 Deluxe = 3x(2+1) = 9), padahal yang dialokasikan & dihargai hanya 1 extra bed (`allocateExtraBeds`). Kapasitas yang sesuai penawaran = standar + extra bed teralokasi = 7.
   - Per kamar, `kapasitas_maksimal` juga dihitung dengan semua slot extra bed (baris ~191).
   - Formatter `src/services/wa-autoreply/availability-formatters.ts` `formatToolCombinationRecommendations` (baris ~145-180) mencetak angka itu apa adanya ("kapasitas sampai 9 tamu"). Jalur fallback `findBestCombination` (baris ~482-497) memakai `kapasitas_per_kamar ?? kapasitas_maksimal_dengan_extra_bed`, risiko sama.
2. **Kombinasi Family+Single+1 extra bed / Family+Deluxe untuk 7 orang** — tidak dihasilkan tool (tool menolak `totalKapasitasMaksimal < guestCount` dan `allocation.ok`). Dugaan kuat dari teks LLM (front-office/pricing) tanpa validasi angka. **Belum terkonfirmasi**; langkah pertama: cek `whatsapp_messages`/log orkestrator pesan 06:11 (read-only) untuk memastikan intent & sumbernya.
3. **"boleh kak" atas tawaran foto Family 222** — `room-comparison.ts:211` hanya menangani persetujuan singkat untuk perbandingan kamar; belum ditemukan state "tawaran foto/brosur tertunda" yang mengubah "boleh/ya/mau" menjadi pemanggilan `send-room-photos` / `brochure-loader`. Akibatnya LLM menjanjikan "diteruskan ke admin" tanpa eskalasi nyata (escalated=false).
4. **Asumsi checkout** — orkestrator set `checkoutAssumed=true` (multi-agent-orchestrator.ts:1522) dan `start-booking.tool.ts:329` sudah memblok final booking bila `checkoutAssumed && !datesConfirmed`. Yang kurang: balasan availability tidak menyebut secara eksplisit "saya asumsikan checkout 12 Des (1 malam)".

## Rencana perubahan

A. `src/tools/availability.tool.ts`
- Tambah `kapasitas_ditawarkan` per kamar & `total_kapasitas_ditawarkan` = standar + extra bed teralokasi; pertahankan `total_kapasitas_maksimal` hanya sebagai info internal.
- `total_extra_bed` tetap jumlah unit (bukan rupiah); harga tetap dari data DB/calendar yang sudah dipakai, tanpa angka baru.

B. `src/services/wa-autoreply/availability-formatters.ts`
- Formatter kombinasi mencetak `kapasitas_ditawarkan` / `total_kapasitas_ditawarkan` (7 untuk 7 tamu), plus "bisa tambah extra bed lagi sampai N" hanya sebagai catatan opsional.
- Fallback `findBestCombination`: kapasitas dihitung standar + extra bed yang benar-benar dibutuhkan.
- Jika `checkoutAssumed`, tambahkan satu kalimat "(saya hitung 1 malam, checkout 12 Des — mohon dikoreksi bila berbeda)".

C. Validator kapasitas balasan LLM — `src/services/reply-postprocess.ts` (atau guard di front-office/pricing agent)
- Deteksi kombinasi kamar di teks LLM; hitung ulang kapasitas dari data tipe kamar (capacity + extra_capacity per kamar). Jika < jumlah tamu atau angka kapasitas tidak cocok, ganti dengan rekomendasi deterministik dari tool.

D. Penerimaan tawaran foto/brosur tertunda — `src/services/wa-autoreply.service.ts` + `media-fast-path.ts`
- Simpan `pendingMediaOffer {room_type_id, kind: photo|brochure, offeredAt}` di state thread saat bot menawarkan foto/brosur.
- Persetujuan singkat ("boleh", "ya", "mau", "boleh kak") dalam 30 menit → panggil `send-room-photos` / brochure loader langsung (dedup 30 menit yang sudah ada tetap berlaku), bukan janji "teruskan ke admin".
- Larang frasa "akan saya teruskan ke admin" kecuali eskalasi benar-benar dibuat.

## Tes (scripts/, diikutkan ke `test:wa-refactor`)
- `test-guest-count-capacity.ts` (perluas): 7 tamu, Deluxe 2+1, Single 1+1, Family 4+2 → 3 Deluxe + 1 extra bed tertulis kapasitas 7; tidak ada "9"/"8".
- `test-combination-capacity-validator.ts` (baru): teks LLM "Family + Single + 1 extra bed untuk 7" ditolak/diganti; Family+Deluxe untuk 7 ditolak (6 < 7 tanpa extra bed).
- `test-pending-media-offer.ts` (baru): tawaran foto Family 222 → "boleh kak" → tool kirim foto dipanggil; tidak ada janji admin.
- `test-checkout-assumed.ts` (baru): checkout tidak disebut → balasan menyebut asumsi; final booking tetap terblok sampai tanggal dikonfirmasi.

## Verifikasi & status
- Typecheck (`bunx tsgo --noEmit -p tsconfig.check.json`) dan `bun run test:wa-refactor` bisa dijalankan di sandbox setelah implementasi (terakhir 26/26 lulus).
- Git: branch kerja saat ini `edit/edt-cd924d25-…`, HEAD `290805ba fix(wa): negasi/koreksi didahulukan sebelum konfirmasi booking (#139)`. Status sinkron GitHub/PR tidak bisa saya lihat dari sandbox; preview akan memuat perubahan otomatis, tapi WhatsApp tamu hanya terpengaruh setelah publish (tidak dilakukan).
- Langkah read-only pertama sebelum implementasi: konfirmasi sumber balasan 06:11 (temuan 2).
