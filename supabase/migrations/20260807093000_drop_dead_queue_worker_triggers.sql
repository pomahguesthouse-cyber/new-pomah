-- P3 (audit 7 Agu 2026): buang trigger pg_net yang memanggil endpoint mati.
--
-- `t_process_wa_queue` (INSERT) dan `t_process_wa_queue_update` (UPDATE) pada
-- wa_conversation_queue mem-POST ke https://pomahguesthouse.com/api/queue-worker
-- lewat pg_net. Sejak refactor antrian, endpoint itu SELALU membalas
-- 202 {disabled:true} untuk panggilan non-manual — drain produksi hanya lewat
-- pg_cron → /api/cron/process-wa-queue. Jadi tiap baris antrian yang masuk atau
-- berubah status memicu HTTP request yang dijamin tidak melakukan apa pun,
-- menambah beban pg_net dan latency transaksi tanpa manfaat.
--
-- Fungsi `public.trigger_process_wa_queue()` ikut dibuang karena tidak ada lagi
-- yang memakainya. Kalau nanti perlu nudge instan (lebih cepat dari tick 2
-- detik), buat trigger baru yang menunjuk ke /api/cron/process-wa-queue.

DROP TRIGGER IF EXISTS t_process_wa_queue ON public.wa_conversation_queue;
DROP TRIGGER IF EXISTS t_process_wa_queue_update ON public.wa_conversation_queue;
DROP FUNCTION IF EXISTS public.trigger_process_wa_queue();
