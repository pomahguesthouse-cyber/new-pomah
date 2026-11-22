import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { laterPause } from "@/services/wa-autoreply/admin-handoff";
import { sendWhatsAppMessage } from "@/services/whatsapp.service";
import { isMetaReengagementError } from "@/services/guest-whatsapp.service";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  WA_OUTBOUND_BUCKET,
  WA_OUTBOUND_MAX_BYTES,
  WA_PATH_INVALID_MESSAGE,
  adminSendFailureMessage,
  attachmentPathForThread,
  fileNameForMime,
  threadPreview,
} from "@/services/wa-outbound-attachment";
import { resolveHumanTakeoverMs } from "@/admin/modules/ai-lab/ai-lab.functions";
import { formatTransferAccountLine, resolveBotTransferAccount } from "@/lib/payment-account";
import { normalizePhone, phoneVariants } from "@/lib/phone";
import type { InvoiceBookingData } from "@/admin/components/invoice-pdf";
import {
  adminInvoiceMetadata,
  buildAdminInvoiceMessage,
  buildInvoicePageUrl,
  formatRoomLabel,
  resolveStayNights,
  type InvoiceMessageRoom,
} from "@/admin/modules/whatsapp/wa-invoice-message";

const BOOKING_ID = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Kode booking tidak valid.",
  );

const BOOKING_COLUMNS =
  "id, reference_code, guest_id, room_id, room_type_id, check_in, check_out, check_in_time, check_out_time, nights, total_amount, paid_amount, payment_status, payment_method, status, created_at, guests(id, full_name, phone, email)";

type GuestRow = {
  id?: string | null;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type BookingRow = {
  id: string;
  reference_code?: string | null;
  guest_id?: string | null;
  room_id?: string | null;
  room_type_id?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  check_in_time?: string | null;
  check_out_time?: string | null;
  nights?: number | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  status?: string | null;
  created_at?: string | null;
  guests?: GuestRow | GuestRow[] | null;
};

type RoomJoin = {
  id?: string;
  booking_id: string;
  room_id?: string | null;
  room_type_id?: string | null;
  nightly_rate?: number | string | null;
  extra_bed_count?: number | null;
  extra_bed_rate?: number | string | null;
  room_types?: { name?: string | null } | { name?: string | null }[] | null;
  rooms?: { number?: string | null } | { number?: string | null }[] | null;
};

export type ThreadInvoiceBooking = {
  id: string;
  reference_code: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  room_label: string;
  total_amount: number;
  paid_amount: number;
  payment_status: string;
  status: string;
  related: boolean;
  preview: string;
  invoice_url: string;
  invoice_booking: InvoiceBookingData;
};

export type ThreadInvoicePropertyInfo = {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  transfer_account_line: string;
};

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nameOf(value: { name?: string | null } | { name?: string | null }[] | null | undefined): string | null {
  return asOne(value)?.name ?? null;
}

function numberOf(value: { number?: string | null } | { number?: string | null }[] | null | undefined): string | null {
  return asOne(value)?.number ?? null;
}

async function requireStaffSender(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) return { ok: false, error: "Gagal memeriksa izin. Coba lagi." };
  const roles = ((data ?? []) as { role?: string }[]).map((row) => row.role);
  const allowed = roles.includes("admin") || roles.includes("staff") || roles.includes("manager");
  if (!allowed) {
    return { ok: false, error: "Anda tidak memiliki izin untuk mengirim invoice ke tamu." };
  }
  return { ok: true };
}

function sanitizeCodeQuery(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);
}

async function guestIdsForThread(
  supabase: any,
  thread: { guest_id?: string | null; phone?: string | null },
): Promise<string[]> {
  const ids = new Set<string>();
  if (thread.guest_id) ids.add(thread.guest_id);
  const variants = new Set(phoneVariants(thread.phone));
  const normalized = thread.phone ? normalizePhone(thread.phone) : "";
  if (normalized) {
    variants.add(normalized);
    variants.add("0" + normalized.replace(/^62/, ""));
  }
  const list = [...variants].filter((v) => v.length >= 8 && v.length <= 20);
  if (list.length) {
    const { data, error } = await supabase.from("guests").select("id, phone").in("phone", list);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row?.id) ids.add(row.id);
    }
  }
  return [...ids];
}

async function loadProperty(supabase: any): Promise<{
  info: ThreadInvoicePropertyInfo;
  payment: Parameters<typeof resolveBotTransferAccount>[0];
}> {
  const { data, error } = await supabase
    .from("properties")
    .select(
      "name, address, city, country, phone, whatsapp_number, public_domain, payment_bank_name, payment_account_number, payment_account_holder",
    )
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, string | null>;
  const payment = {
    payment_bank_name: row.payment_bank_name,
    payment_account_number: row.payment_account_number,
    payment_account_holder: row.payment_account_holder,
  };
  const account = resolveBotTransferAccount(payment);
  const address = [row.address, row.city, row.country].filter(Boolean).join(", ") || null;
  const rawDomain = row.public_domain ?? null;
  const website = rawDomain ? (rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`) : "https://pomahguesthouse.com";
  return {
    payment,
    info: {
      name: row.name || "Pomah Guesthouse",
      address,
      phone: row.whatsapp_number || row.phone || null,
      website,
      transfer_account_line: formatTransferAccountLine(account),
    },
  };
}

async function enrichBookings(
  supabase: any,
  rows: BookingRow[],
  property: ThreadInvoicePropertyInfo,
  relatedIds: Set<string>,
): Promise<ThreadInvoiceBooking[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const { data: roomRows, error: roomErr } = await supabase
    .from("booking_rooms")
    .select("id, booking_id, room_id, room_type_id, nightly_rate, extra_bed_count, extra_bed_rate, room_types(name), rooms(number)")
    .in("booking_id", ids);
  if (roomErr) throw roomErr;

  const roomsByBooking = new Map<string, RoomJoin[]>();
  for (const room of (roomRows ?? []) as RoomJoin[]) {
    const list = roomsByBooking.get(room.booking_id) ?? [];
    list.push(room);
    roomsByBooking.set(room.booking_id, list);
  }

  const headerTypeIds = [...new Set(rows.map((row) => row.room_type_id).filter(Boolean))] as string[];
  const headerRoomIds = [...new Set(rows.map((row) => row.room_id).filter(Boolean))] as string[];
  const typeName = new Map<string, string>();
  const roomNumber = new Map<string, { number: string; typeId?: string | null }>();
  if (headerTypeIds.length) {
    const { data, error } = await supabase.from("room_types").select("id, name").in("id", headerTypeIds);
    if (error) throw error;
    for (const row of data ?? []) typeName.set(row.id, row.name);
  }
  if (headerRoomIds.length) {
    const { data, error } = await supabase.from("rooms").select("id, number, room_type_id").in("id", headerRoomIds);
    if (error) throw error;
    for (const row of data ?? []) roomNumber.set(row.id, { number: row.number, typeId: row.room_type_id });
  }

  return rows.map((row) => {
    const guest = asOne(row.guests);
    const joined = roomsByBooking.get(row.id) ?? [];
    const rooms: InvoiceMessageRoom[] = joined.map((room) => ({
      typeName: nameOf(room.room_types),
      roomNumber: numberOf(room.rooms),
    }));
    const headerRoom = row.room_id ? roomNumber.get(row.room_id) : undefined;
    const headerType =
      (row.room_type_id && typeName.get(row.room_type_id)) ||
      (headerRoom?.typeId ? typeName.get(headerRoom.typeId) : null) ||
      null;
    const code = String(row.reference_code ?? "").trim() || row.id.slice(0, 8);
    const invoiceUrl = buildInvoicePageUrl(property.website, code);
    const total = money(row.total_amount);
    const paid = money(row.paid_amount);
    const nights = resolveStayNights(row.nights, row.check_in, row.check_out);
    const preview = buildAdminInvoiceMessage({
      guestName: guest?.full_name || "Tamu",
      referenceCode: code,
      rooms,
      headerRoomType: headerType,
      headerRoomNumber: headerRoom?.number ?? null,
      checkIn: row.check_in ?? "",
      checkOut: row.check_out ?? "",
      checkInTime: row.check_in_time,
      checkOutTime: row.check_out_time,
      totalAmount: total,
      paidAmount: paid,
      nights,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      invoiceUrl,
      transferAccountLine: property.transfer_account_line,
    });
    const invoiceRooms = joined.map((room) => ({
      id: String(room.id ?? crypto.randomUUID()),
      room_id: room.room_id ?? null,
      nightly_rate: money(room.nightly_rate),
      extra_bed_count: room.extra_bed_count ?? 0,
      extra_bed_rate: money(room.extra_bed_rate),
      room_types: { name: nameOf(room.room_types) },
      rooms: { number: numberOf(room.rooms) },
    }));
    const paymentStatus = (row.payment_status ?? "unpaid") as InvoiceBookingData["payment_status"];
    return {
      id: row.id,
      reference_code: code,
      guest_name: guest?.full_name || "Tamu",
      check_in: row.check_in ?? "",
      check_out: row.check_out ?? "",
      nights,
      room_label: formatRoomLabel(rooms, headerType, headerRoom?.number ?? null),
      total_amount: total,
      paid_amount: paid,
      payment_status: row.payment_status ?? "unpaid",
      status: row.status ?? "",
      related: relatedIds.has(row.id),
      preview,
      invoice_url: invoiceUrl,
      invoice_booking: {
        id: row.id,
        reference_code: code,
        check_in: row.check_in ?? "",
        check_out: row.check_out ?? "",
        total_amount: total,
        payment_status: paymentStatus === "paid" || paymentStatus === "partial" || paymentStatus === "unpaid" ? paymentStatus : "unpaid",
        payment_method: row.payment_method ?? null,
        paid_amount: paid,
        guests: {
          full_name: guest?.full_name ?? null,
          email: guest?.email ?? null,
          phone: guest?.phone ?? null,
        },
        booking_rooms: invoiceRooms,
      },
    };
  });
}

function uniqueBookings(rows: BookingRow[]): BookingRow[] {
  const seen = new Set<string>();
  const out: BookingRow[] = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export const listThreadInvoiceBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        threadId: z.string().uuid(),
        q: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const access = await requireStaffSender(context.supabase, context.userId);
      if (!access.ok) return { ok: false as const, error: access.error };

      const { data: thread, error: threadErr } = await context.supabase
        .from("whatsapp_threads")
        .select("id, guest_id, phone")
        .eq("id", data.threadId)
        .maybeSingle();
      if (threadErr) throw threadErr;
      if (!thread) return { ok: false as const, error: "Percakapan tidak ditemukan." };

      const { info: property } = await loadProperty(context.supabase);
      const guestIds = await guestIdsForThread(context.supabase, thread);
      const relatedIds = new Set<string>();
      let related: BookingRow[] = [];
      if (guestIds.length) {
        const { data: rows, error } = await context.supabase
          .from("bookings")
          .select(BOOKING_COLUMNS)
          .in("guest_id", guestIds)
          .order("check_in", { ascending: false })
          .limit(30);
        if (error) throw error;
        related = (rows ?? []) as BookingRow[];
        for (const row of related) relatedIds.add(row.id);
      }

      const term = sanitizeCodeQuery(data.q ?? "");
      let searched: BookingRow[] = [];
      if (term) {
        const { data: rows, error } = await context.supabase
          .from("bookings")
          .select(BOOKING_COLUMNS)
          .ilike("reference_code", `%${term}%`)
          .order("check_in", { ascending: false })
          .limit(20);
        if (error) throw error;
        searched = (rows ?? []) as BookingRow[];
      }

      const merged = uniqueBookings(term ? [...searched, ...related] : related);
      const bookings = await enrichBookings(context.supabase, merged, property, relatedIds);
      return { ok: true as const, property, bookings };
    } catch (error) {
      console.error("[Admin WhatsApp] list invoice bookings:", error);
      return { ok: false as const, error: "Gagal memuat daftar booking. Coba lagi." };
    }
  });

export const sendThreadInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        threadId: z.string().uuid(),
        bookingId: BOOKING_ID,
        body: z.string().trim().min(1, "Pesan invoice tidak boleh kosong.").max(4000),
        attachment: z
          .object({
            path: z.string().trim().min(1).max(512),
            name: z.string().trim().min(1).max(180),
            mime: z.string().trim().min(1).max(200),
            size: z.number().int().positive(),
          })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      const access = await requireStaffSender(context.supabase, context.userId);
      if (!access.ok) return { ok: false as const, error: access.error };

      if (data.attachment) {
        if (data.attachment.mime !== "application/pdf") {
          return { ok: false as const, error: "Lampiran invoice harus berupa PDF." };
        }
        if (data.attachment.size > WA_OUTBOUND_MAX_BYTES) {
          return { ok: false as const, error: "Ukuran berkas maksimal 25 MB." };
        }
        if (!attachmentPathForThread(data.attachment.path, data.threadId)) {
          return { ok: false as const, error: WA_PATH_INVALID_MESSAGE };
        }
      }

      const { data: thread, error: threadErr } = await context.supabase
        .from("whatsapp_threads")
        .select("id, phone")
        .eq("id", data.threadId)
        .maybeSingle();
      if (threadErr) throw threadErr;
      if (!thread) return { ok: false as const, error: "Percakapan tidak ditemukan." };

      const { data: booking, error: bookingErr } = await context.supabase
        .from("bookings")
        .select("id, reference_code")
        .eq("id", data.bookingId)
        .maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) return { ok: false as const, error: "Booking tidak ditemukan." };

      const { info: property } = await loadProperty(context.supabase);
      const code = String(booking.reference_code ?? "").trim() || booking.id.slice(0, 8);
      const invoiceUrl = buildInvoicePageUrl(property.website, code);
      const fileName = data.attachment
        ? fileNameForMime(data.attachment.name, data.attachment.mime)
        : null;
      const delivery = data.attachment ? "document" : "text";
      const metadataBase = adminInvoiceMetadata({
        bookingId: booking.id,
        referenceCode: code,
        invoiceUrl,
        delivery,
        fileName: fileName ?? undefined,
        storagePath: data.attachment?.path,
      });

      const insert = async (
        sendStatus: "sent" | "failed" | "local_only",
        wppId: string | null,
        errorText?: string,
        mediaUrl?: string,
      ) => {
        const { error } = await context.supabase.from("whatsapp_messages").insert({
          thread_id: data.threadId,
          direction: "out",
          from_me: true,
          body: data.body,
          wpp_id: wppId,
          metadata: {
            ...metadataBase,
            ...(mediaUrl ? { media_url: mediaUrl } : {}),
            send_status: sendStatus,
            ...(errorText ? { error: errorText.slice(0, 500) } : {}),
          },
        } as any);
        if (error) throw error;
      };

      const { isMetaConfigured } = await import("@/services/whatsapp-meta.service");
      let sentDelivery: "document" | "text" = delivery;
      if (isMetaConfigured()) {
        let fileUrl: string | undefined;
        if (data.attachment) {
          const signed = await supabaseAdmin.storage
            .from(WA_OUTBOUND_BUCKET)
            .createSignedUrl(data.attachment.path, 2 * 60 * 60);
          const signedUrl = signed.data?.signedUrl;
          if (signed.error || !signedUrl) {
            const message = "Gagal menyiapkan lampiran PDF. Coba kirim tanpa PDF, atau unggah ulang.";
            console.error("[Admin WhatsApp] invoice signed url:", signed.error?.message);
            await insert("failed", null, message);
            return { ok: false as const, error: message };
          }
          fileUrl = signedUrl;
        }

        const sendResult = await sendWhatsAppMessage(
          "",
          thread.phone,
          data.body,
          fileUrl,
          fileName ?? undefined,
          data.attachment ? { mediaType: "document", mimetype: "application/pdf" } : undefined,
        );
        if (!sendResult.ok) {
          const message = adminSendFailureMessage(isMetaReengagementError(sendResult), sendResult.error);
          console.error("[Admin WhatsApp] invoice send failed:", sendResult.error);
          await insert("failed", null, message, fileUrl);
          return { ok: false as const, error: message };
        }
        const messageId = sendResult.messageId;
        const wppId = typeof messageId === "string" && messageId.trim() ? messageId.trim() : null;
        await insert("sent", wppId, undefined, fileUrl);
      } else {
        await insert("local_only", null);
        sentDelivery = delivery;
      }

      const pauseMs = await resolveHumanTakeoverMs(context.supabase);
      let existingPause: string | null = null;
      try {
        const { data: th } = await (context.supabase as any)
          .from("whatsapp_threads")
          .select("ai_paused_until")
          .eq("id", data.threadId)
          .maybeSingle();
        existingPause = (th as { ai_paused_until?: string | null } | null)?.ai_paused_until ?? null;
      } catch {
        existingPause = null;
      }
      const staffPause = pauseMs > 0 ? new Date(Date.now() + pauseMs).toISOString() : null;
      await context.supabase
        .from("whatsapp_threads")
        .update({
          last_message_preview: threadPreview(data.body, fileName),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
          ai_paused_until: laterPause(existingPause, staffPause),
        } as any)
        .eq("id", data.threadId);

      return { ok: true as const, delivery: sentDelivery };
    } catch (error) {
      console.error("[Admin WhatsApp] send invoice:", error);
      const message = error instanceof Error && /tidak boleh kosong|tidak valid/i.test(error.message)
        ? error.message
        : "Invoice gagal dikirim. Coba lagi.";
      return { ok: false as const, error: message };
    }
  });
