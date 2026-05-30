-- ============================================================
-- Lokasi lantai untuk tipe kamar
-- ============================================================
--
-- Free-text field so the admin can describe where rooms of this
-- type live in the building. Examples:
--   "Lantai 1"
--   "Lantai 2 & 3"
--   "Lantai dasar (Ground Floor)"
--   "Lantai 2, dekat lift"
--
-- Bahasa Indonesia: ditampilkan di kartu kamar publik dan di
-- dialog detail kamar admin.
-- ============================================================

ALTER TABLE public.room_types
  ADD COLUMN IF NOT EXISTS floor_info TEXT;
