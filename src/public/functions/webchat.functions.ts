/**
 * Webchat Backup — server functions.
 *
 * Kanal cadangan resmi saat WhatsApp/Fonnte error. Endpoint publik tanpa
 * auth — gunakan validasi Zod ketat dan jangan bocorkan kolom sensitif.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { WEBCHAT_FALLBACK_PROMPT } from "@/ai/agents/webchat-fallback.prompt";

/* ----------------------------- helpers ----------------------------- */

function normalizePhone(raw: string): string {
  let p = String(raw).replace(/\D/g, "");
  if (p.startsWith("620")) p = "62" + p.slice(3);
  else if (p.startsWith("0")) p = "62" + p.slice(1);
  else if (p.startsWith("8")) p = "62" + p;
  return p;
}

function fmtRupiah(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return "Rp " + (Number.isFinite(v) ? v.toLocaleString("id-ID") : "0");
}

function fmtDateID(d: string | null | undefined): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return String(d); }
}

const SAFE_BOOKING_COLS =
  "id, reference_code, status, payment_status, check_in, check_out, nights, total_amount, source, guest_id";

/* ----------------------------- types ------------------------------- */

export interface WebchatThreadRow {
  id: string;
  guest_name: string | null;
  guest_phone: string | null;
  booking_id: string | null;
  booking_code: string | null;
  whatsapp_thread_id: string | null;
  status: "open" | "waiting_admin" | "ai_active" | "closed";
  handoff_status: "ai" | "human" | "paused";
  handoff_until: string | null;
  context_summary: string;
  context_summary_json: any;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface WebchatMessageRow {
  id: string;
  thread_id: string;
  sender_type: "guest" | "bot" | "admin" | "system";
  sender_name: string | null;
  body: string | null;
  attachment_url: string | null;
  attachment_type: string | null;
  metadata: any;
  created_at: string;
}

export interface BookingSummary {
  id: string;
  referenceCode: string | null;
  status: string;
  paymentStatus: string;
  checkIn: string;
  checkOut: string;
  nights: number | null;
  totalAmount: number;
  guestName: string | null;
  roomName: string | null;
}

/* ----------------------------- 1. channel status ------------------- */

export const getChannelStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("channel_status")
    .select("channel, status, fallback_enabled, last_ok_at, last_error_at, last_error_message");
  if (error) {
    console.warn("[Webchat] getChannelStatus error:", error.message);
    return { channels: [] as Array<any> };
  }
  return { channels: (data ?? []) as Array<any> };
});

/* ----------------------------- 2. start session -------------------- */

const StartSchema = z.object({
  guestName:   z.string().trim().min(2, "Nama minimal 2 karakter").max(80),
  guestPhone:  z.string().trim().min(8, "Nomor WhatsApp tidak valid").max(20),
  bookingCode: z.string().trim().max(40).optional(),
});

export const startWebchatSession = createServerFn({ method: "POST" })
  .inputValidator((d) => StartSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normalizePhone(data.guestPhone);
    if (!phone) throw new Error("Nomor WhatsApp tidak valid");

    // 1. Cari WA thread untuk seed konteks.
    const { data: waThread } = await (supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id, chat_summary, chat_summary_json, guest_name")
      .eq("phone", phone)
      .maybeSingle();

    // 2. Resolve booking kalau ada code.
    let booking: { id: string; reference_code: string | null } | null = null;
    if (data.bookingCode) {
      const { data: b } = await (supabaseAdmin as any)
        .from("bookings")
        .select("id, reference_code")
        .ilike("reference_code", data.bookingCode.trim())
        .maybeSingle();
      if (b) booking = b;
    }

    // 3. Cari thread webchat aktif untuk phone yang sama.
    const { data: existingThread } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("*")
      .eq("guest_phone", phone)
      .in("status", ["open", "ai_active", "waiting_admin"])
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let thread = existingThread as WebchatThreadRow | null;

    if (thread) {
      // Update info tamu/booking yang mungkin baru diisi.
      const patch: Record<string, unknown> = {
        guest_name: data.guestName,
        last_message_at: new Date().toISOString(),
      };
      if (booking) {
        patch.booking_id   = booking.id;
        patch.booking_code = booking.reference_code;
      }
      if (waThread?.id && !thread.whatsapp_thread_id) {
        patch.whatsapp_thread_id = waThread.id;
        patch.context_summary       = waThread.chat_summary ?? thread.context_summary;
        patch.context_summary_json  = waThread.chat_summary_json ?? thread.context_summary_json;
      }
      const { data: upd } = await (supabaseAdmin as any)
        .from("webchat_threads")
        .update(patch)
        .eq("id", thread.id)
        .select("*")
        .single();
      thread = upd as WebchatThreadRow;
    } else {
      const { data: inserted, error: insErr } = await (supabaseAdmin as any)
        .from("webchat_threads")
        .insert({
          guest_name:           data.guestName,
          guest_phone:          phone,
          booking_id:           booking?.id ?? null,
          booking_code:         booking?.reference_code ?? null,
          whatsapp_thread_id:   waThread?.id ?? null,
          context_summary:      waThread?.chat_summary ?? "",
          context_summary_json: waThread?.chat_summary_json ?? {},
          status:               "open",
          handoff_status:       "ai",
        })
        .select("*")
        .single();
      if (insErr || !inserted) {
        throw new Error("Gagal membuat sesi web chat: " + (insErr?.message ?? "unknown"));
      }
      thread = inserted as WebchatThreadRow;

      // Pesan sambutan dari sistem.
      await (supabaseAdmin as any).from("webchat_messages").insert({
        thread_id:   thread.id,
        sender_type: "system",
        body:
          `Halo ${data.guestName}! 👋 Kakak terhubung ke Web Chat Cadangan ` +
          `Pomah Guesthouse. Silakan tanyakan apa saja terkait kamar, booking, ` +
          `atau pembayaran. Tim kami siap membantu.`,
      });

      // Notifikasi sesi baru ke super admin (fire-and-forget).
      try {
        const { notifyNewConversationSession } = await import("@/services/manager-notifier.service");
        await notifyNewConversationSession(supabaseAdmin as any, {
          phone,
          guestName:    data.guestName,
          firstMessage: `(Sesi web chat baru dibuka${booking ? ` untuk ${booking.reference_code}` : ""})`,
          isNewThread:  !waThread,
          threadId:     thread.id,
        });
      } catch (e) {
        console.warn("[Webchat] notify new session failed:", e);
      }
    }

    const messages = await loadMessages(thread!.id);
    const bookingSummary = thread!.booking_id ? await loadBookingSummary(thread!.booking_id) : null;

    return { thread: thread!, messages, booking: bookingSummary };
  });

/* ----------------------------- 3. send message --------------------- */

const SendSchema = z.object({
  threadId: z.string().uuid(),
  body:     z.string().trim().min(1).max(2000),
});

export const sendWebchatMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => SendSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: thread, error: thErr } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("*")
      .eq("id", data.threadId)
      .maybeSingle();
    if (thErr || !thread) throw new Error("Sesi web chat tidak ditemukan");
    if (thread.status === "closed") throw new Error("Sesi sudah ditutup");

    const now = new Date().toISOString();

    // 1. Simpan pesan tamu.
    await (supabaseAdmin as any).from("webchat_messages").insert({
      thread_id:   data.threadId,
      sender_type: "guest",
      sender_name: thread.guest_name,
      body:        data.body,
    });
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update({ last_message_at: now })
      .eq("id", data.threadId);

    // 2. Cek handoff ke admin: jika human dan belum expired → skip AI.
    const handoffActive =
      thread.handoff_status === "human" &&
      thread.handoff_until &&
      new Date(thread.handoff_until).getTime() > Date.now();

    if (thread.handoff_status === "paused") {
      return { reply: null, status: "paused" as const };
    }
    if (handoffActive) {
      await (supabaseAdmin as any)
        .from("webchat_threads")
        .update({ status: "waiting_admin" })
        .eq("id", data.threadId);
      // Notify admin baru ada pesan.
      try {
        const { notifyNewConversationSession } = await import("@/services/manager-notifier.service");
        await notifyNewConversationSession(supabaseAdmin as any, {
          phone:        thread.guest_phone ?? "",
          guestName:    thread.guest_name,
          firstMessage: data.body,
          isNewThread:  false,
          threadId:     thread.id,
        });
      } catch { /* non-fatal */ }
      return { reply: null, status: "waiting_admin" as const };
    }

    // 3. Jalankan AI fallback.
    const aiReply = await runWebchatAi(thread.id);

    if (aiReply) {
      await (supabaseAdmin as any).from("webchat_messages").insert({
        thread_id:   data.threadId,
        sender_type: "bot",
        sender_name: "Pomah AI",
        body:        aiReply,
      });
      await (supabaseAdmin as any)
        .from("webchat_threads")
        .update({ status: "ai_active", last_message_at: new Date().toISOString() })
        .eq("id", data.threadId);
    }

    return { reply: aiReply, status: aiReply ? ("ai_active" as const) : ("open" as const) };
  });

/* ----------------------------- 4. upload attachment ---------------- */

const UploadSchema = z.object({
  threadId:    z.string().uuid(),
  fileName:    z.string().min(1).max(120),
  contentType: z.string().min(1).max(120),
  base64:      z.string().min(20).max(15_000_000), // ~10MB binary
  note:        z.string().max(500).optional(),
});

export const uploadWebchatAttachment = createServerFn({ method: "POST" })
  .inputValidator((d) => UploadSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: thread } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("id, booking_id, guest_phone, guest_name, whatsapp_thread_id")
      .eq("id", data.threadId)
      .maybeSingle();
    if (!thread) throw new Error("Sesi tidak ditemukan");

    // Decode base64 → Uint8Array.
    const b64 = data.base64.includes(",") ? data.base64.split(",")[1] : data.base64;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const cleanName = data.fileName.replace(/[^\w.\-]/g, "_").slice(0, 80);
    const path = `${thread.id}/${Date.now()}-${cleanName}`;

    const { error: upErr } = await (supabaseAdmin as any).storage
      .from("webchat-attachments")
      .upload(path, bin, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error("Upload gagal: " + upErr.message);

    const { data: signed } = await (supabaseAdmin as any).storage
      .from("webchat-attachments")
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 hari
    const url = signed?.signedUrl ?? null;

    await (supabaseAdmin as any).from("webchat_messages").insert({
      thread_id:       data.threadId,
      sender_type:     "guest",
      sender_name:     thread.guest_name,
      body:            data.note ?? "(lampiran terkirim)",
      attachment_url:  url,
      attachment_type: data.contentType,
      metadata:        { storage_path: path },
    });
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.threadId);

    // Heuristik bukti transfer.
    const isImage = data.contentType.startsWith("image/");
    const looksLikePayment = isImage && !!thread.booking_id;
    if (looksLikePayment) {
      try {
        const { notifyPaymentProof } = await import("@/services/manager-notifier.service");
        await notifyPaymentProof(supabaseAdmin as any, {
          threadId:  thread.whatsapp_thread_id ?? null,
          messageId: data.threadId,
          phone:     thread.guest_phone ?? "",
          guestName: thread.guest_name,
          imageUrl:  url ?? "",
        });
      } catch (e) {
        console.warn("[Webchat] notify payment proof failed:", e);
      }
    }

    return { url, path };
  });

/* ----------------------------- 5. get messages --------------------- */

export const getWebchatMessages = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({
    threadId: z.string().uuid(),
    sinceId:  z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const messages = await loadMessages(data.threadId, data.sinceId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: thread } = await (supabaseAdmin as any)
      .from("webchat_threads")
      .select("*")
      .eq("id", data.threadId)
      .maybeSingle();
    return { thread: thread as WebchatThreadRow | null, messages };
  });

/* ----------------------------- 6. close thread --------------------- */

export const closeWebchatThread = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any)
      .from("webchat_threads")
      .update({ status: "closed", handoff_status: "ai" })
      .eq("id", data.threadId);
    return { ok: true };
  });

/* ----------------------------- helpers (internal) ------------------ */

async function loadMessages(threadId: string, sinceId?: string): Promise<WebchatMessageRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = (supabaseAdmin as any)
    .from("webchat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (sinceId) {
    const { data: anchor } = await (supabaseAdmin as any)
      .from("webchat_messages")
      .select("created_at")
      .eq("id", sinceId)
      .maybeSingle();
    if (anchor?.created_at) q = q.gt("created_at", anchor.created_at);
  }
  const { data } = await q;
  return (data ?? []) as WebchatMessageRow[];
}

async function loadBookingSummary(bookingId: string): Promise<BookingSummary | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: b } = await (supabaseAdmin as any)
    .from("bookings")
    .select(`${SAFE_BOOKING_COLS}, guests(full_name), booking_rooms(room_types(name))`)
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return null;
  const bk = b as any;
  return {
    id:            bk.id,
    referenceCode: bk.reference_code,
    status:        String(bk.status ?? ""),
    paymentStatus: String(bk.payment_status ?? ""),
    checkIn:       fmtDateID(bk.check_in),
    checkOut:      fmtDateID(bk.check_out),
    nights:        bk.nights ?? null,
    totalAmount:   Number(bk.total_amount ?? 0),
    guestName:     bk.guests?.full_name ?? null,
    roomName:      bk.booking_rooms?.[0]?.room_types?.name ?? null,
  };
}

/* ----------------------------- AI runner --------------------------- */

async function runWebchatAi(threadId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: thread } = await (supabaseAdmin as any)
    .from("webchat_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return null;

  const messages = await loadMessages(threadId);

  // Load property settings + LLM key.
  const { data: prop } = await (supabaseAdmin as any)
    .from("properties")
    .select("ai_api_key, ai_base_url, ai_model, name, payment_account_number, payment_bank_name, payment_account_holder")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const p = (prop ?? {}) as Record<string, any>;
  const explicitKey = (p.ai_api_key as string | undefined)?.trim();
  const lovableKey  = process.env.LOVABLE_API_KEY?.trim();
  const useLovable  = !explicitKey && !!lovableKey;
  const key         = explicitKey || lovableKey;
  if (!key) {
    console.warn("[Webchat] No AI key configured, skipping AI reply");
    return null;
  }

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const configuredModel = (p.ai_model as string | undefined)?.trim();
  const model = useLovable
    ? (configuredModel && configuredModel.includes("/") ? configuredModel : "google/gemini-2.5-flash")
    : (configuredModel || "gpt-4o-mini");

  // Build context.
  const { data: rooms } = await (supabaseAdmin as any)
    .from("room_types")
    .select("name, base_rate, capacity, bed_type, description")
    .order("base_rate");
  const roomLines = (rooms ?? []).map((r: any) =>
    `- ${r.name}: ${fmtRupiah(r.base_rate)}/malam, kapasitas ${r.capacity ?? "-"} tamu${r.bed_type ? `, ${r.bed_type}` : ""}`,
  ).join("\n");

  let bookingBlock = "";
  if (thread.booking_id) {
    const b = await loadBookingSummary(thread.booking_id);
    if (b) {
      bookingBlock =
        `\n[BOOKING TAMU]\n` +
        `- Kode: ${b.referenceCode}\n` +
        `- Kamar: ${b.roomName ?? "-"}\n` +
        `- Check-in: ${b.checkIn} → Check-out: ${b.checkOut} (${b.nights ?? "-"} malam)\n` +
        `- Total: ${fmtRupiah(b.totalAmount)}\n` +
        `- Status booking: ${b.status} | Status pembayaran: ${b.paymentStatus}\n`;
    }
  }

  const paymentBlock = p.payment_account_number
    ? `\n[INFO PEMBAYARAN]\n${p.payment_bank_name ?? "Bank"} ${p.payment_account_number} a.n. ${p.payment_account_holder ?? "-"}\n`
    : "";

  const summaryBlock = thread.context_summary
    ? `\n[RINGKASAN KONTEKS DARI WHATSAPP]\n${thread.context_summary}\n`
    : "";

  // Tanggal hari ini di zona waktu Asia/Jakarta (WIB) agar AI tidak salah
  // mengartikan "hari ini", "besok", "lusa", dsb.
  const fmtJakarta = (d: Date) =>
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(d);
  // ISO YYYY-MM-DD untuk tanggal WIB (offset +07:00, tanpa DST).
  const isoJakarta = (d: Date) => {
    const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    return wib.toISOString().slice(0, 10);
  };
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const todayBlock =
    `\n[TANGGAL ACUAN — ZONA WIB / Asia/Jakarta]\n` +
    `- Hari ini  : ${fmtJakarta(now)} (${isoJakarta(now)})\n` +
    `- Besok     : ${fmtJakarta(tomorrow)} (${isoJakarta(tomorrow)})\n` +
    `- Lusa      : ${fmtJakarta(dayAfter)} (${isoJakarta(dayAfter)})\n` +
    `Selalu gunakan tanggal di atas saat tamu menyebut "hari ini", "besok", ` +
    `"lusa", "minggu depan", "akhir pekan", dsb. JANGAN menebak tahun atau bulan; ` +
    `pakai tahun & bulan dari blok ini. Bila tamu menyebut nama hari (mis. "Sabtu"), ` +
    `hitung relatif terhadap "Hari ini" di atas.\n`;


  const systemPrompt =
    WEBCHAT_FALLBACK_PROMPT
      .replace("{{PROPERTY_NAME}}", String(p.name ?? "Pomah Guesthouse"))
      .replace("{{ROOM_DATA}}", roomLines || "(belum ada data kamar)")
      .replace("{{BOOKING_BLOCK}}", bookingBlock)
      .replace("{{PAYMENT_BLOCK}}", paymentBlock)
      .replace("{{SUMMARY_BLOCK}}", summaryBlock + todayBlock);


  // Transform pesan jadi format OpenAI Chat.
  const chatHistory = messages
    .filter((m) => m.sender_type !== "system")
    .slice(-24)
    .map((m) => ({
      role:    m.sender_type === "guest" ? "user" : "assistant",
      content: m.body ?? (m.attachment_url ? "(mengirim lampiran)" : ""),
    }));

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistory,
        ],
        temperature: 0.5,
        max_tokens:  600,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[Webchat] LLM error:", res.status, txt.slice(0, 200));
      return null;
    }
    const json: any = await res.json();
    const reply = json?.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } catch (e) {
    console.warn("[Webchat] LLM call failed:", e);
    return null;
  }
}
