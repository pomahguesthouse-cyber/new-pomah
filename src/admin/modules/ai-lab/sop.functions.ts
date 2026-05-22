/**
 * SOP knowledge base — uploaded documents the AI agents draw on when
 * answering. Files live in the `sop-documents` storage bucket; this
 * table keeps their metadata and extracted text `content`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { processSopDocumentChunks } from "@/ai/rag.service";
import type { AiClientConfig } from "@/ai/types";

/** Untyped client view — `sop_documents` is not in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export type SopDocument = {
  id: string;
  name: string;
  file_path: string | null;
  file_type: string | null;
  source_url: string | null;
  content: string | null;
  doc_category: "knowledge" | "sop" | "brosur";
  agent_key: string | null;
  created_at: string;
};

async function getAiConfig(supabase: SupabaseClient): Promise<AiClientConfig | null> {
  const { data: prop } = await supabase.from("properties").select("*").limit(1).maybeSingle();
  const p = (prop ?? {}) as Record<string, unknown>;
  const explicitKey = (p.ai_api_key as string | undefined)?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const apiKey      = explicitKey || lovableKey;

  if (!apiKey) return null;

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = (p.ai_model as string | undefined)?.trim();
  const model = useLovable
    ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
    : cfgModel || "gpt-4o-mini";

  return { apiKey, baseUrl, model };
}

/** List SOP documents, optionally filtered by doc_category and/or agent_key. */
export const listSopDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        category: z.enum(["knowledge", "sop", "brosur"]).optional(),
        agentKey: z.string().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = db(context.supabase)
      .from("sop_documents")
      .select("id, name, file_path, file_type, source_url, content, doc_category, agent_key, created_at")
      .order("created_at", { ascending: false });
    if (data?.category) q = q.eq("doc_category", data.category);
    if (data?.agentKey !== undefined) {
      q = data.agentKey ? q.eq("agent_key", data.agentKey) : q.is("agent_key", null);
    }
    const { data: rows } = await q;
    return { documents: (rows ?? []) as unknown as SopDocument[] };
  });

/**
 * Register a SOP knowledge entry — either an uploaded file (file already
 * stored in the bucket) or an external link with a description.
 */
export const createSopDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().min(1).max(300),
        filePath: z.string().max(500).optional().or(z.literal("")),
        fileType: z.string().max(20).optional().or(z.literal("")),
        sourceUrl: z.string().url().max(2000).optional().or(z.literal("")),
        content: z.string().max(200000).optional().or(z.literal("")),
        docCategory: z.enum(["knowledge", "sop", "brosur"]).default("sop"),
        agentKey: z.string().max(50).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { data: prop } = await sb.from("properties").select("id").limit(1).maybeSingle();
    const { error, data: insertedSop } = await sb.from("sop_documents").insert({
      property_id: (prop as Record<string, unknown> | null)?.id ?? null,
      name: data.name,
      file_path: data.filePath || null,
      file_type: data.fileType || null,
      source_url: data.sourceUrl || null,
      content: data.content || null,
      doc_category: data.docCategory,
      agent_key: data.agentKey || null,
    }).select("id").single();
    if (error) throw error;

    if (insertedSop?.id && (data.content || data.sourceUrl)) {
      getAiConfig(sb).then(config => {
        if (config) {
          processSopDocumentChunks(
            sb,
            insertedSop.id,
            data.content || "",
            data.sourceUrl || null,
            config
          ).catch(e => console.error("[SOP] Background chunk error:", e));
        }
      });
    }

    return { ok: true };
  });

/**
 * Update only the display name of a document.
 * For media files (brosur) this is the "rename" action shown in the UI.
 */
export const renameSopDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), name: z.string().min(1).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("sop_documents")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Update alt text for a media document (image/video).
 * Stored in the `content` column; does NOT trigger RAG processing.
 */
export const updateMediaAltText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), altText: z.string().max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("sop_documents")
      .update({ content: data.altText })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Update the extracted text content the agents read. */
export const updateSopDocumentContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), content: z.string().max(200000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { error } = await sb
      .from("sop_documents")
      .update({ content: data.content })
      .eq("id", data.id);
    if (error) throw error;

    const { data: doc } = await sb
      .from("sop_documents")
      .select("source_url")
      .eq("id", data.id)
      .maybeSingle();

    getAiConfig(sb).then(config => {
      if (config) {
        processSopDocumentChunks(
          sb,
          data.id,
          data.content,
          (doc as Record<string, unknown> | null)?.source_url as string | null,
          config
        ).catch(e => console.error("[SOP] Background update chunk error:", e));
      }
    });

    return { ok: true };
  });

/** Delete a SOP document — removes the stored file and the metadata row. */
export const deleteSopDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { data: row } = await sb
      .from("sop_documents")
      .select("file_path")
      .eq("id", data.id)
      .maybeSingle();
    const filePath = (row as Record<string, unknown> | null)?.file_path as string | undefined;
    if (filePath) await sb.storage.from("sop-documents").remove([filePath]);
    const { error } = await sb.from("sop_documents").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const DEFAULT_SOPS: { agentKey: string; name: string; content: string }[] = [
  {
    agentKey: "front-office",
    name: "SOP Front Office — Check-in, Check-out & Reservasi",
    content: `SOP FRONT OFFICE AGENT

1. PENERIMAAN TAMU
- Sambut tamu: "Selamat datang di Pomah Guesthouse, ada yang bisa kami bantu?"
- Minta identitas resmi (KTP/Paspor/SIM) dan verifikasi di sistem PMS
- Konfirmasi detail booking: nama, tipe kamar, tanggal, jumlah tamu

2. PROSEDUR CHECK-IN
- Check-in resmi mulai pukul 14:00 WIB
- Early check-in jika kamar siap: dikenakan biaya tambahan Rp50.000
- Minta tamu isi formulir registrasi, serahkan kunci dan jelaskan fasilitas
- Sampaikan: jam sarapan 07:00–09:30, WiFi di kartu kamar, nomor darurat tekan 0

3. PROSEDUR CHECK-OUT
- Check-out maksimal pukul 12:00 WIB
- Late check-out hingga 15:00: 50% tarif harian
- Late check-out di atas 15:00: 1 malam penuh
- Periksa kondisi kamar dan minibar sebelum kunci dikembalikan

4. KEBIJAKAN RESERVASI
- Booking terkonfirmasi setelah DP minimal 50% diterima
- Pembatalan H-3 atau lebih: DP kembali penuh
- Pembatalan H-2 hingga H-1: DP hangus 50%
- No-show: DP hangus seluruhnya
- Perubahan tanggal: gratis jika kamar tersedia

5. INFORMASI KAMAR
- Selalu cek ketersediaan kamar di sistem sebelum menjawab tamu
- Jika kamar penuh, tawarkan tanggal alternatif atau waiting list`,
  },
  {
    agentKey: "pricing",
    name: "SOP Pricing Agent — Tarif, Diskon & Promo",
    content: `SOP PRICING AGENT

1. TARIF DASAR
- Tarif mengacu pada rate sheet yang ditetapkan manajemen di sistem
- Harga sudah termasuk sarapan untuk 2 orang
- Extra bed: Rp100.000/malam (termasuk sarapan 1 orang)

2. STRUKTUR DISKON MENGINAP
- 3–4 malam: diskon 5%
- 5–6 malam: diskon 10%
- 7+ malam: diskon 15%
- Repeat guest / member: tambahan diskon 5%

3. EARLY BIRD
- Booking 14 hari sebelum check-in: diskon 10%
- Booking 30 hari sebelum check-in: diskon 15%
- Early bird tidak bisa digabung dengan diskon lain

4. PEAK SEASON
- Periode: Lebaran, Natal, Tahun Baru, libur nasional panjang
- Kenaikan tarif: 20–30% dari tarif normal
- Minimum stay: 2 malam — tidak ada diskon selama peak season kecuali izin manager

5. WEWENANG DISKON
- Staff/chatbot: diskon hingga 5%
- Supervisor: diskon hingga 10%
- Manager: diskon hingga 20%
- Di atas 20%: perlu persetujuan owner

6. PAKET KHUSUS
- Honeymoon/Anniversary: dekorasi + sarapan romantis + late check-out 12:00 gratis
- Keluarga: anak di bawah 10 tahun bebas extra bed
- Corporate: tarif khusus negosiasi langsung dengan manager`,
  },
  {
    agentKey: "customer-care",
    name: "SOP Customer Care Agent — Layanan & Kesiapan Kamar",
    content: `SOP CUSTOMER CARE AGENT

1. STANDAR KESIAPAN KAMAR
- Kamar siap setelah housekeeping selesai dan supervisor verifikasi
- Status kamar diupdate di sistem maksimal 30 menit setelah bersih
- Standar: tempat tidur rapi, kamar mandi bersih, amenities lengkap, AC dan TV berfungsi

2. AMENITIES STANDAR PER KAMAR
- Handuk mandi 2 buah, handuk tangan 2 buah
- Sabun, sampo, kondisioner, sikat gigi, pasta gigi
- Air mineral 2 botol (600ml), teh, kopi, gula sachet
- Remote TV dan AC, panduan kamar

3. PENANGANAN PERMINTAAN TAMU
- Tambahan handuk/bantal: dilayani dalam 30 menit
- Amenities tambahan: dilayani dalam 20 menit
- Kamar perlu dibersihkan ulang: housekeeping dalam 45 menit
- Late check-out: koordinasi dengan resepsionis

4. PENANGANAN KOMPLAIN
- Setiap komplain dicatat dengan waktu masuk di sistem
- Komplain ringan (kebersihan kecil): selesai dalam 1 jam
- Komplain sedang (AC, air panas): selesai dalam 2 jam
- Komplain berat (keamanan/kenyamanan serius): eskalasi ke supervisor SEGERA
- Follow-up kepuasan tamu setelah komplain ditangani

5. STANDAR KOMUNIKASI
- Gunakan sapaan "Kak" atau "Bapak/Ibu" sesuai konteks
- Balas pesan WhatsApp maksimal dalam 5 menit
- Jika tidak bisa bantu, arahkan ke nomor yang tepat
- Selalu ucapkan terima kasih di akhir percakapan`,
  },
  {
    agentKey: "maintenance",
    name: "SOP Maintenance Agent — Perbaikan & Pemeliharaan Fasilitas",
    content: `SOP MAINTENANCE AGENT

1. PELAPORAN KERUSAKAN
- Semua laporan dicatat: kamar/lokasi, jenis kerusakan, waktu, pelapor
- Notifikasi ke teknisi dikirim dalam 15 menit setelah laporan masuk

2. KATEGORI DAN PRIORITAS

DARURAT — response dalam 1 jam:
- Kebocoran air / pipa bocor
- Gangguan listrik / korsleting
- AC mati total saat tamu ada
- Kunci kamar rusak tidak bisa dibuka
- Kebakaran / asap → langsung hubungi pemadam 113

TINGGI — response dalam 2–3 jam:
- Air panas tidak berfungsi
- Toilet tersumbat
- TV/remote tidak berfungsi
- Lampu kamar mati

SEDANG — response dalam 24 jam:
- Engsel pintu longgar, tirai rusak, stop kontak goyang

RENDAH — jadwal rutin:
- Pengecatan, furnitur kusam, taman perlu dirapikan

3. PEMELIHARAAN RUTIN
- Senin: cek AC dan instalasi listrik seluruh kamar
- Rabu: cek plumbing dan sanitasi
- Jumat: cek pintu, kunci, jendela
- Bulanan: service AC, cek CCTV, test genset

4. KOMUNIKASI KE TAMU
- Informasikan estimasi waktu perbaikan kepada tamu
- Minta izin sebelum masuk kamar jika tamu sedang di dalam
- Jika perlu pindah kamar: koordinasi dengan resepsionis terlebih dahulu
- Update tamu setelah perbaikan selesai`,
  },
  {
    agentKey: "finance",
    name: "SOP Finance Agent — Pembayaran, Tagihan & Refund",
    content: `SOP FINANCE AGENT

1. METODE PEMBAYARAN
- Tunai (Rupiah)
- Transfer bank: BCA dan Mandiri (nomor rekening di sistem)
- QRIS (semua e-wallet)
- Kartu kredit/debit via EDC di resepsionis

2. PROSEDUR DOWN PAYMENT (DP)
- DP minimal 50% dari total biaya menginap
- DP harus diterima dalam 24 jam setelah booking dikonfirmasi
- Bukti transfer dikirim ke WhatsApp atau email resepsionis
- Konfirmasi DP dikirimkan ke tamu setelah pembayaran terverifikasi

3. PELUNASAN
- Pelunasan saat check-in atau check-out (sesuai kesepakatan)
- Invoice diterbitkan otomatis saat check-out
- Tamu bisa minta invoice lebih awal untuk keperluan reimbursement

4. REFUND & PEMBATALAN
- Pembatalan H-3 atau lebih: refund DP penuh (3 hari kerja)
- Pembatalan H-2: refund 50% DP (3 hari kerja)
- Pembatalan H-1 atau no-show: tidak ada refund
- Refund ditransfer ke rekening asal — konfirmasi via WhatsApp

5. TAGIHAN TAMBAHAN
- Extra bed, laundry, layanan tambahan: ditagih saat check-out
- Kerusakan fasilitas: ditagih sesuai estimasi biaya perbaikan
- Tamu corporate: bisa diberikan invoice net 7 hari

6. REKONSILIASI HARIAN
- Laporan kas harian dibuat pukul 22:00
- Selisih kas di atas Rp50.000 wajib dilaporkan ke supervisor
- Data pembayaran diinput ke sistem PMS maksimal 30 menit setelah transaksi`,
  },
  {
    agentKey: "manager",
    name: "SOP Manager Agent — Keputusan & Eskalasi Manajerial",
    content: `SOP MANAGER AGENT

1. WEWENANG MANAGER
- Akses ke semua data operasional hotel
- Diskon: hingga 20% tanpa persetujuan tambahan
- Upgrade kamar gratis jika kamar tersedia
- Menyetujui refund hingga Rp2.000.000
- Di atas batas tersebut: perlu persetujuan owner

2. SITUASI YANG HARUS DIESKALASI KE MANAGER
- Tamu komplain keras dan tidak puas dengan solusi staff
- Permintaan diskon di atas 10%
- Permintaan refund di luar kebijakan standar
- Insiden keamanan atau keselamatan
- Tamu VIP atau relasi bisnis penting
- Media / jurnalis yang ingin wawancara
- Komplain yang berpotensi viral di media sosial

3. LAPORAN HARIAN
- Laporan occupancy: pukul 08:00 dan 22:00
- Laporan keuangan harian: pukul 22:00
- Laporan insiden/komplain: real-time via WhatsApp
- Laporan forecasting: mingguan setiap Minggu malam

4. KEPUTUSAN OPERASIONAL
- Hotel penuh saat ada walk-in: manager putuskan opsi overbooking atau kompensasi
- Grup besar (10+ kamar): negosiasi langsung dengan manager
- Vendor/supplier baru: perlu persetujuan manager
- Pengeluaran tak terduga di atas Rp500.000: perlu approval manager

5. JADWAL RUTIN
- Briefing harian staff: pukul 08:00
- Evaluasi mingguan: Senin pukul 10:00
- Rapat bulanan: tanggal 1 setiap bulan pukul 10:00
- Manager wajib diinformasikan jika tamu VIP akan check-in

6. STANDAR RESPONS CHATBOT KE MANAGER
- Jawab pertanyaan operasional berdasarkan data sistem secara ringkas
- Sertakan perbandingan periode sebelumnya untuk pertanyaan performa
- Gunakan bahasa formal namun efisien — hindari bertele-tele
- Laporan angka: sertakan tren (naik/turun) dan persentase perubahan`,
  },
];

/** Seed default SOP documents per agent. Skips agents that already have a SOP. */
export const seedDefaultSopDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = db(context.supabase);
    const { data: prop } = await sb.from("properties").select("id").limit(1).maybeSingle();
    const propertyId = (prop as Record<string, unknown> | null)?.id ?? null;

    const { data: existing } = await sb
      .from("sop_documents")
      .select("agent_key")
      .eq("doc_category", "sop")
      .not("agent_key", "is", null);

    const existingKeys = new Set(
      ((existing ?? []) as { agent_key: string }[]).map((r) => r.agent_key),
    );

    const toInsert = DEFAULT_SOPS.filter((s) => !existingKeys.has(s.agentKey)).map((s) => ({
      property_id: propertyId,
      name: s.name,
      file_path: null,
      file_type: "txt",
      source_url: null,
      content: s.content,
      doc_category: "sop",
      agent_key: s.agentKey,
    }));

    if (toInsert.length === 0) return { seeded: 0 };

    const { error } = await sb.from("sop_documents").insert(toInsert);
    if (error) throw error;

    return { seeded: toInsert.length };
  });
