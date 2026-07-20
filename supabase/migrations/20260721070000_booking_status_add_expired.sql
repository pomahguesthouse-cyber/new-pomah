-- Tambah nilai enum 'expired' pada booking_status: dipakai booking yang
-- auto-dibatalkan sistem karena tidak dibayar dalam 1 jam (lihat migrasi
-- berikutnya untuk kolom expires_at + cron job). Terpisah dari 'cancelled'
-- supaya laporan bisa membedakan auto-expired vs dibatalkan manual.
--
-- File tersendiri: Postgres tidak mengizinkan nilai enum baru dipakai dalam
-- transaksi yang sama saat ditambahkan.
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'expired';
