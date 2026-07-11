-- Align Rani training examples and rental policy with runtime behavior.
-- Deliberately avoids ON CONFLICT because some deployments do not have
-- compatible unique constraints on the target columns.

BEGIN;

-- Availability example must be a natural guest-facing reply, not internal
-- instructions that the model could accidentally repeat verbatim.
UPDATE public.chatbot_training_examples
SET
  ideal_assistant_response = 'Baik Kak, saya cek ketersediaannya untuk besok dengan asumsi 1 malam ya.',
  intent = 'availability_check',
  stage = 'availability',
  training_type = 'curated',
  language = 'id-ID',
  is_active = true,
  embedding = NULL,
  embedding_updated_at = NULL,
  updated_at = now()
WHERE id = 'tr-value-unnes-20260710';

-- Monthly-rental examples use a runtime-compatible general stage.
UPDATE public.chatbot_training_examples
SET
  stage = 'general',
  embedding = NULL,
  embedding_updated_at = NULL,
  updated_at = now()
WHERE intent = 'inquiry_monthly_rental';

-- Final policy: no weekly/monthly/kost package, but multiple nights may still
-- be booked at the daily rate when inventory is available.
UPDATE public.sop_documents
SET
  content = 'Pomah Guesthouse hanya menggunakan skema dan tarif sewa harian. Kami tidak menyediakan paket kost, kontrak, tarif mingguan, tarif bulanan, atau tarif semester. Tamu tetap dapat memesan beberapa malam, termasuk masa inap yang lebih panjang, menggunakan tarif harian dan hanya jika kamar tersedia pada seluruh tanggal yang diminta.',
  doc_category = 'sop'
WHERE name = 'Kebijakan Sewa Bulanan';

INSERT INTO public.sop_documents (name, content, doc_category)
SELECT
  'Kebijakan Sewa Bulanan',
  'Pomah Guesthouse hanya menggunakan skema dan tarif sewa harian. Kami tidak menyediakan paket kost, kontrak, tarif mingguan, tarif bulanan, atau tarif semester. Tamu tetap dapat memesan beberapa malam, termasuk masa inap yang lebih panjang, menggunakan tarif harian dan hanya jika kamar tersedia pada seluruh tanggal yang diminta.',
  'sop'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sop_documents
  WHERE name = 'Kebijakan Sewa Bulanan'
);

-- Keep long-stay training consistent with the SOP above.
UPDATE public.chatbot_training_examples
SET
  ideal_assistant_response = 'Pomah Guesthouse tidak menyediakan paket mingguan atau bulanan, Kak. Namun Kakak tetap dapat memesan 20 malam menggunakan tarif harian, selama kamar tersedia pada seluruh tanggal yang diminta. Boleh kirim tanggal check-in dan check-out agar saya cek?',
  stage = 'general',
  embedding = NULL,
  embedding_updated_at = NULL,
  updated_at = now()
WHERE id = 'tr-deny-monthly-long-stay-20260711';

COMMIT;
