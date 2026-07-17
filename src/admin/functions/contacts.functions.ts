/**
 * Contacts (Guest CRM) admin server functions.
 *
 * Data model dasar: tabel `guests` yang diperluas menjadi entitas CRM
 * (phone_normalized, source, first/last_seen_at, total_bookings,
 * total_spent, tags, avatar_url, merged_into). Timeline gabungan
 * booking + whatsapp thread + structured memory diagregasi di
 * `getContactDetail`.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const listInput = z.object({
  search: z.string().trim().max(120).optional(),
  source: z.string().trim().max(40).optional(),
  tag: z.string().trim().max(40).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = (supabaseAdmin as any)
      .from("guests")
      .select(
        "id, full_name, real_name, display_name, phone, phone_normalized, email, source, tags, total_bookings, total_spent, last_seen_at, first_seen_at, avatar_url",
        { count: "exact" },
      )
      .is("merged_into", null)
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.search) {
      const term = `%${data.search}%`;
      query = query.or(
        `full_name.ilike.${term},real_name.ilike.${term},display_name.ilike.${term},phone.ilike.${term},email.ilike.${term}`,
      );
    }
    if (data.source) query = query.eq("source", data.source);
    if (data.tag) query = query.contains("tags", [data.tag]);

    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    // Referenced but silenced to keep the type inference tight.
    void context;
    return { rows: rows ?? [], total: count ?? 0 };
  });

const detailInput = z.object({ id: z.string().uuid() });

export const getContactDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => detailInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as any;

    const { data: contact } = await client
      .from("guests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!contact) throw new Error("Contact not found");

    const { data: bookings } = await client
      .from("bookings")
      .select(
        "id, reference_code, check_in, check_out, status, payment_status, total_amount, paid_amount, adults, children, created_at",
      )
      .eq("guest_id", data.id)
      .order("check_in", { ascending: false })
      .limit(50);

    const { data: threads } = await client
      .from("whatsapp_threads")
      .select("id, phone, display_name, last_message_at, last_message_preview, unread_count, chat_summary")
      .eq("guest_id", data.id)
      .order("last_message_at", { ascending: false })
      .limit(20);

    let memory: any = null;
    if (contact.phone_normalized) {
      const { data: mem } = await client
        .from("guest_structured_memory")
        .select("*")
        .eq("phone", contact.phone_normalized)
        .maybeSingle();
      memory = mem ?? null;
    }

    return { contact, bookings: bookings ?? [], threads: threads ?? [], memory };
  });

const updateInput = z.object({
  id: z.string().uuid(),
  real_name: z.string().trim().max(120).nullable().optional(),
  display_name: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
});

export const updateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {};
    if (data.real_name !== undefined) patch.real_name = data.real_name;
    if (data.display_name !== undefined) patch.display_name = data.display_name;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.tags !== undefined) patch.tags = data.tags;
    const { error } = await (supabaseAdmin as any)
      .from("guests")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const mergeInput = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
});

export const mergeContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => mergeInput.parse(d))
  .handler(async ({ data }) => {
    if (data.sourceId === data.targetId) throw new Error("Sumber dan tujuan sama");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as any;
    // Pindahkan bookings & threads ke target
    await client.from("bookings").update({ guest_id: data.targetId }).eq("guest_id", data.sourceId);
    await client
      .from("whatsapp_threads")
      .update({ guest_id: data.targetId })
      .eq("guest_id", data.sourceId);
    const { error } = await client
      .from("guests")
      .update({ merged_into: data.targetId })
      .eq("id", data.sourceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const reminderInput = z.object({
  bookingId: z.string().uuid(),
  message: z.string().trim().min(3).max(1500).optional(),
});

export const sendPreArrivalReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => reminderInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin as any;

    const { data: booking } = await client
      .from("bookings")
      .select("id, reference_code, check_in, check_out, guest_id, guests(full_name, phone_normalized, phone)")
      .eq("id", data.bookingId)
      .maybeSingle();
    if (!booking) throw new Error("Booking tidak ditemukan");
    const guest = booking.guests as { full_name?: string; phone_normalized?: string; phone?: string } | null;
    const target = guest?.phone_normalized || guest?.phone;
    if (!target) throw new Error("Nomor tamu tidak tersedia");

    const { data: prop } = await client
      .from("properties")
      .select("wpp_token")
      .limit(1)
      .maybeSingle();
    const token = (prop as { wpp_token?: string } | null)?.wpp_token;
    if (!token) throw new Error("WPP token belum diset di property");

    const name = guest?.full_name ?? "Kak";
    const defaultMsg =
      `Halo ${name}, ini pengingat check-in di Pomah Guesthouse pada ${booking.check_in}. ` +
      `Reservasi: ${booking.reference_code ?? booking.id.slice(0, 8)}. ` +
      `Kalau ada permintaan khusus atau perkiraan jam tiba, silakan balas pesan ini ya. Terima kasih!`;
    const body = data.message?.trim() || defaultMsg;

    const { sendWhatsAppMessage } = await import("@/services/whatsapp.service");
    const { ok, error } = await sendWhatsAppMessage(token, target, body);
    if (!ok) throw new Error(error ?? "Gagal kirim WhatsApp");
    return { ok: true };
  });
