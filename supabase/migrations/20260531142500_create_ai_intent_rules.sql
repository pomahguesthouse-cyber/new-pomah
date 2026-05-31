-- Create ai_intent_rules table
CREATE TABLE IF NOT EXISTS public.ai_intent_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  patterns text[] NOT NULL,
  weight integer NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.ai_intent_rules ENABLE ROW LEVEL SECURITY;

-- Select policy for authenticated users and service role
CREATE POLICY "Select rules" ON public.ai_intent_rules
  FOR SELECT TO authenticated, service_role USING (true);

-- Manage policy for authenticated staff
CREATE POLICY "Staff manage rules" ON public.ai_intent_rules
  FOR ALL TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

-- Seed default rules
INSERT INTO public.ai_intent_rules (category, patterns, weight) VALUES
  ('complaint', ARRAY[
    '\b(komplain|complain|kecewa|tidak puas|nggak puas|ga puas|buruk|jelek|parah|mengecewakan|kecewa banget|sangat kecewa)\b',
    '\b(minta ganti rugi|minta refund|kembalikan uang|uang kembali|cancel booking)\b',
    '\b(mana pelayanannya|pelayanan buruk|lambat banget|nggak profesional|tidak profesional)\b'
  ], 10),
  ('maintenance', ARRAY[
    '\b(rusak|bocor|mati|tidak berfungsi|nggak berfungsi|ga berfungsi|error|trouble)\b',
    '\b(ac|air conditioner|kipas|lampu|listrik|tv|televisi|remote|kran|shower|toilet|flush|pintu|kunci|gembok)\b.*\b(rusak|mati|bocor|macet|tidak|nggak|ga)\b',
    '\b(tolong (perbaiki|cek|periksa)|ada masalah dengan|laporkan kerusakan|maintenance|teknisi)\b',
    '\b(mati lampu|air mati|air tidak keluar|ac tidak dingin|wifi mati|wifi tidak)\b'
  ], 8),
  ('customer-care', ARRAY[
    '\b(handuk|towel|selimut|bantal|pillow|sabun|shampoo|sampo|toiletries|perlengkapan mandi)\b',
    '\b(bersih(kan)?|beres(kan)?|ganti|tukar|tambah(kan)?|kekurangan)\b.*\b(kamar|sprei|bed|tempat tidur|handuk)\b',
    '\b(housekeeping|room service|layanan kamar|minta (tolong )?(bersih|ganti|tambah))\b',
    '\b(sprei|bed cover|bantal tambahan|ekstra bantal|extra pillow|extra towel)\b'
  ], 8),
  ('payment', ARRAY[
    '\b(bayar|pembayaran|transfer|rekening|bank|bca|mandiri|bni|bri|gopay|ovo|dana|qris)\b',
    '\b(invoice|kwitansi|bukti bayar|konfirmasi bayar|sudah (bayar|transfer))\b',
    '\b(cicil|dp|uang muka|down payment|lunas|sisa pembayaran|tagihan)\b',
    '\b(refund|pengembalian dana|cancel dan refund|minta refund)\b'
  ], 7),
  ('pricing_inquiry', ARRAY[
    '\b(harga|tarif|rate|biaya|cost|per malam|semalam|weekend|weekday)\b',
    '\b(diskon|promo|paket|special rate|long stay|early bird|flash sale)\b',
    '\b(berapa (harga|tarif|biayanya?|costnya?))\b',
    '\b(kamar (paling )?(murah|termurah|mahal|termahal))\b'
  ], 6),
  ('availability_check', ARRAY[
    '\b(ada kamar|kamar (ada|kosong|tersedia)|masih ada kamar|kamar masih)\b',
    '\b(tersedia|ketersediaan|available|availability)\b',
    '\b(cek kamar)\b',
    '\b(masih ada|ada kosong|ada yang kosong|masih tersedia)\b',
    '\btanggal\b.*\b(masih|ada|kosong)\b'
  ], 6),
  ('booking_inquiry', ARRAY[
    '\b(pesan|booking|reservasi|book|reserve|mau (pesan|booking|menginap|nginap))\b',
    '\b(check[ -]?in|check[ -]?out|checkin|checkout)\b',
    '\b(menginap|nginap|mau (malam|tidur) di|ingin menginap)\b',
    '\b(untuk (berapa malam|tanggal|besok|lusa|akhir pekan|weekend|malam ini))\b',
    '\b(lihat kamar|kamar untuk)\b'
  ], 5),
  ('greeting', ARRAY[
    '^(halo|hai|hi|hey|hello|hei|assalam|selamat (pagi|siang|sore|malam)|pagi|siang|sore|malam)\b',
    '\b(apa kabar|gimana kabarnya|ada yang bisa dibantu|bisa dibantu)\b'
  ], 3)
ON CONFLICT DO NOTHING;
