import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabasePublic } from "@/integrations/supabase/client.server";
import { mergeAiLabConfig, AGENT_KEYS } from "@/admin/modules/ai-lab/ai-lab.functions";

export const getPublicSiteData = createServerFn({ method: "GET" }).handler(async () => {
  const [{ data: property }, { data: roomTypes }] = await Promise.all([
    supabasePublic.from("properties").select("*").limit(1).maybeSingle(),
    supabasePublic
      .from("room_types")
      .select(
        "id, name, slug, description, base_rate, capacity, bed_type, size_sqm, amenities, hero_image_url",
      )
      .order("base_rate"),
  ]);
  return { property, roomTypes: roomTypes ?? [] };
});

export const submitPublicBooking = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        fullName: z.string().min(1).max(120),
        email: z.string().email().max(200),
        phone: z.string().min(3).max(40).optional().or(z.literal("")),
        roomTypeId: z.string().uuid(),
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int().min(1).max(8),
        children: z.number().int().min(0).max(8),
        specialRequests: z.string().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: property } = await supabasePublic
      .from("properties")
      .select("id")
      .limit(1)
      .single();
    if (!property) throw new Error("Property not configured");

    const { data: rt } = await supabasePublic
      .from("room_types")
      .select("id, base_rate")
      .eq("id", data.roomTypeId)
      .single();
    if (!rt) throw new Error("Room type not found");

    const nights =
      (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / 86400000;
    if (nights < 1) throw new Error("Check-out must be after check-in");

    const { data: guest, error: gerr } = await supabasePublic
      .from("guests")
      .insert({
        full_name: data.fullName,
        email: data.email,
        phone: data.phone || null,
      })
      .select("id")
      .single();
    if (gerr || !guest) throw gerr ?? new Error("Could not create guest");

    const total = Number(rt.base_rate) * nights;
    const { data: booking, error: berr } = await supabasePublic
      .from("bookings")
      .insert({
        property_id: property.id,
        guest_id: guest.id,
        check_in: data.checkIn,
        check_out: data.checkOut,
        nights: Math.round(nights),
        adults: data.adults,
        children: data.children,
        total_amount: total,
        source: "direct",
        status: "pending",
        special_requests: data.specialRequests || null,
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking) throw berr ?? new Error("Could not create booking");

    // One booking_rooms line for the chosen room type (room assigned
    // later by staff).
    const { error: brErr } = await supabasePublic.from("booking_rooms").insert({
      booking_id: booking.id,
      room_id: null,
      room_type_id: rt.id,
      nightly_rate: rt.base_rate,
    });
    if (brErr) throw brErr;

    return { id: booking.id, reference_code: booking.reference_code, total, nights };
  });

export const getBookingReference = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: booking } = await supabasePublic
      .from("bookings")
      .select("reference_code")
      .eq("id", data.id)
      .maybeSingle();
    return { reference_code: booking?.reference_code ?? null };
  });

/* ------------------------------------------------------------------ */
/* Room-type availability                                              */
/* ------------------------------------------------------------------ */

/**
 * For a chosen date range, return which room types still have a free
 * room. A room type is available when its total room count exceeds the
 * number of active (pending/confirmed/checked-in) bookings that overlap
 * the range. Room types with no rooms defined are omitted (treated as
 * available by the caller).
 */
export const checkRoomTypeAvailability = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { checkIn, checkOut } = data;
    if (checkIn >= checkOut) {
      return { availability: {} as Record<string, boolean>, debug: { rows: 0, error: null } };
    }

    // Computed by a SECURITY DEFINER DB function so booking data stays
    // private — it returns only aggregate availability per room type.
    const client = supabasePublic as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: { room_type_id: string; available: boolean }[] | null;
        error: { message: string } | null;
      }>;
    };
    const { data: rows, error } = await client.rpc("room_type_availability", {
      p_check_in: checkIn,
      p_check_out: checkOut,
    });

    const availability: Record<string, boolean> = {};
    for (const r of rows ?? []) {
      availability[r.room_type_id] = r.available;
    }
    return {
      availability,
      debug: { rows: (rows ?? []).length, error: error?.message ?? null },
    };
  });

/* ------------------------------------------------------------------ */
/* Google reviews (Places API)                                         */
/* ------------------------------------------------------------------ */

export interface GoogleReview {
  author: string;
  text: string;
  rating: number;
}
export interface GoogleReviewsResult {
  rating: number | null;
  total: number | null;
  reviews: GoogleReview[];
  /** Diagnostic — Places API status or a local error code. */
  status: string;
}

const empty = (status: string): GoogleReviewsResult => ({
  rating: null,
  total: null,
  reviews: [],
  status,
});

/**
 * Fetch the property's Google rating, review count and recent reviews
 * from the Google Places API. The Place ID and API key come from the
 * property's integration settings (Settings → Integrasi); the key also
 * falls back to the GOOGLE_PLACES_API_KEY env var. Returns empty data
 * (so the homepage falls back) on any failure.
 */
export const getGoogleReviews = createServerFn({ method: "GET" }).handler(async () => {
  const { data: prop } = await supabasePublic
    .from("properties")
    .select("google_place_id, google_places_api_key")
    .limit(1)
    .maybeSingle();
  const row = (prop as Record<string, unknown> | null) ?? {};
  const placeId = (row.google_place_id as string | undefined)?.trim();
  const key = (
    (row.google_places_api_key as string | undefined) || process.env.GOOGLE_PLACES_API_KEY
  )?.trim();
  if (!key) return empty("NO_API_KEY");
  if (!placeId) return empty("NO_PLACE_ID");

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(placeId)}` +
      "&fields=rating,user_ratings_total,reviews&language=id" +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: { author_name?: string; text?: string; rating?: number }[];
      };
    };
    if (json.status !== "OK") {
      // e.g. REQUEST_DENIED (key restricted / Places API off), NOT_FOUND.
      return empty(
        json.status ? `${json.status}: ${json.error_message ?? ""}`.trim() : "API_ERROR",
      );
    }
    const r = json.result ?? {};
    const reviews: GoogleReview[] = Array.isArray(r.reviews)
      ? r.reviews
          .slice(0, 6)
          .map((rv) => ({
            author: String(rv.author_name ?? "Tamu"),
            text: String(rv.text ?? ""),
            rating: Number(rv.rating ?? 0),
          }))
          .filter((rv) => rv.text)
      : [];
    return {
      rating: typeof r.rating === "number" ? r.rating : null,
      total: typeof r.user_ratings_total === "number" ? r.user_ratings_total : null,
      reviews,
      status: "OK",
    };
  } catch (e) {
    return empty(`FETCH_ERROR: ${(e as Error).message}`);
  }
});

/* ------------------------------------------------------------------ */
/* AI webchat (LLM)                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run one turn of the public AI chatbot. The system prompt is built from
 * the AI LAB agent instructions and live room data ("tools"); the LLM is
 * any OpenAI-compatible endpoint configured in Settings → Integrasi.
 */
export const chatWithAI = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(2000),
            }),
          )
          .min(1)
          .max(24),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: prop } = await supabasePublic
      .from("properties")
      .select("*")
      .limit(1)
      .maybeSingle();
    const p = (prop ?? {}) as Record<string, unknown>;
    const key = (p.ai_api_key as string | undefined)?.trim();
    if (!key) return { reply: null as string | null, error: "NO_AI_KEY" };

    const baseUrl = ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1")
      .trim()
      .replace(/\/+$/, "");
    const model = ((p.ai_model as string | undefined) || "gpt-4o-mini").trim();

    const cfg = mergeAiLabConfig(p.ai_lab_config);
    const { data: rooms } = await supabasePublic
      .from("room_types")
      .select("id, name, base_rate, capacity, bed_type, description")
      .order("base_rate");
    const roomRows = (rooms ?? []) as Record<string, unknown>[];

    const agentLines = AGENT_KEYS.filter(
      (k) => cfg.agents[k]?.enabled && cfg.agents[k]?.instructions?.trim(),
    ).map((k) => `• ${k}: ${cfg.agents[k].instructions.trim()}`);

    const roomLines = roomRows.map(
      (rr) =>
        `• ${rr.name} — Rp ${Number(rr.base_rate ?? 0).toLocaleString("id-ID")}/malam, kapasitas ${
          rr.capacity ?? "-"
        } tamu${rr.bed_type ? `, ${rr.bed_type}` : ""}`,
    );

    // Today in WIB (UTC+7) so "hari ini" is correct for Indonesia.
    const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    const nextDay = (d: string) =>
      new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

    const system = [
      `Anda adalah asisten AI untuk ${(p.name as string) ?? "Pomah Guesthouse"}, sebuah penginapan.`,
      "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",
      `Hari ini tanggal ${todayStr}.`,
      agentLines.length ? `Panduan tiap agent:\n${agentLines.join("\n")}` : "",
      roomLines.length
        ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
        : "",
      "KETERSEDIAAN KAMAR: Anda memiliki tool `check_room_availability`. Setiap kali tamu " +
        "menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin " +
        "booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak ketersediaan. " +
        "Jika tamu tidak menyebut tanggal, anggap untuk hari ini (check-in hari ini, 1 malam).",
      "Saat menyampaikan hasil tool: awali dengan baris 'Ketersediaan kamar untuk <tanggal>'. " +
        "Lalu tiap tipe kamar satu baris — gunakan ✅ bila ada kamar tersedia atau ❌ bila penuh, " +
        "diikuti nama kamar, jumlah kamar tersedia, dan harga per malam. " +
        "Tutup dengan ajakan memilih kamar untuk lanjut booking.",
      "BOOKING VIA CHAT: Anda dapat membuatkan pesanan kamar langsung. Alurnya: (1) cek " +
        "ketersediaan dengan tool, (2) setelah tamu memilih satu tipe kamar, minta nama " +
        "lengkap, email, dan nomor HP tamu, (3) setelah SEMUA data lengkap baru panggil tool " +
        "`create_booking`. JANGAN pernah mengarang data tamu — bila ada yang belum diberikan, " +
        "tanyakan dulu dan jangan panggil tool.",
      "Setelah `create_booking` berhasil: sampaikan sapaan dengan nama tamu, kode booking, " +
        "total harga, lalu instruksi transfer ke rekening (bank, nomor rekening, atas nama) " +
        "bila tersedia, dan minta tamu mengirim bukti pembayaran. Bila info rekening kosong, " +
        "beritahu tamu bahwa detail pembayaran akan dikirim staf. Bila tool gagal, sampaikan " +
        "alasannya dengan sopan.",
      "Untuk pemesanan, tamu juga bisa memakai widget pemesanan di halaman lalu klik 'Cek Ketersediaan' atau 'Pesan Kamar'.",
    ]
      .filter(Boolean)
      .join("\n\n");

    // SECURITY DEFINER RPC — returns aggregate counts only, no guest data.
    const rpcClient = supabasePublic as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{
        data: { room_type_id: string; total: number; taken: number; available: number }[] | null;
        error: { message: string } | null;
      }>;
    };

    /** Execute the availability tool — returns a JSON string for the LLM. */
    const runAvailability = async (rawArgs: Record<string, unknown>): Promise<string> => {
      const isDate = (v: unknown): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const checkIn = isDate(rawArgs.check_in) ? rawArgs.check_in : todayStr;
      let checkOut = isDate(rawArgs.check_out) ? rawArgs.check_out : nextDay(checkIn);
      if (checkOut <= checkIn) checkOut = nextDay(checkIn);
      const { data: rows } = await rpcClient.rpc("room_type_availability_detail", {
        p_check_in: checkIn,
        p_check_out: checkOut,
      });
      const byId = new Map((rows ?? []).map((r) => [r.room_type_id, r]));
      const kamar = roomRows.map((rr) => {
        const d = byId.get(rr.id as string);
        return {
          nama: rr.name,
          harga_per_malam: Number(rr.base_rate ?? 0),
          kamar_tersedia: d ? d.available : null,
          total_kamar: d ? d.total : null,
          catatan: d ? undefined : "jumlah kamar belum diatur di sistem",
        };
      });
      return JSON.stringify({ check_in: checkIn, check_out: checkOut, kamar });
    };

    /** Execute the booking tool — creates a real booking, returns JSON. */
    const runCreateBooking = async (raw: Record<string, unknown>): Promise<string> => {
      const isDate = (v: unknown): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const fullName = str(raw.full_name);
      const email = str(raw.email);
      const phone = str(raw.phone);
      const roomTypeName = str(raw.room_type).toLowerCase();
      const checkIn = isDate(raw.check_in) ? raw.check_in : "";
      const checkOut = isDate(raw.check_out) ? raw.check_out : "";
      const adults = Math.max(1, Math.min(8, Number(raw.adults) || 1));
      const children = Math.max(0, Math.min(8, Number(raw.children) || 0));

      if (!fullName || !email || !phone)
        return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return JSON.stringify({ ok: false, error: "Format email tidak valid." });
      if (!checkIn || !checkOut || checkOut <= checkIn)
        return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });

      // Match the chosen room type by name.
      const rt =
        roomRows.find((r) => String(r.name).toLowerCase() === roomTypeName) ??
        roomRows.find((r) => {
          const n = String(r.name).toLowerCase();
          return n.includes(roomTypeName) || roomTypeName.includes(n);
        });
      if (!rt)
        return JSON.stringify({
          ok: false,
          error: `Tipe kamar "${str(raw.room_type)}" tidak ditemukan.`,
        });

      // Re-check availability so we never overbook.
      const { data: availRows } = await rpcClient.rpc("room_type_availability_detail", {
        p_check_in: checkIn,
        p_check_out: checkOut,
      });
      const detail = (availRows ?? []).find((r) => r.room_type_id === (rt.id as string));
      if (detail && detail.available < 1)
        return JSON.stringify({
          ok: false,
          error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
        });

      const propId = p.id as string | undefined;
      if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

      const nights = Math.round(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
      );
      const rate = Number(rt.base_rate ?? 0);
      const total = rate * nights;

      const { data: guest, error: gerr } = await supabasePublic
        .from("guests")
        .insert({ full_name: fullName, email, phone })
        .select("id")
        .single();
      if (gerr || !guest) return JSON.stringify({ ok: false, error: "Gagal menyimpan data tamu." });

      const { data: booking, error: berr } = await supabasePublic
        .from("bookings")
        .insert({
          property_id: propId,
          guest_id: guest.id,
          check_in: checkIn,
          check_out: checkOut,
          nights,
          adults,
          children,
          total_amount: total,
          source: "direct",
          status: "pending",
        })
        .select("id, reference_code")
        .single();
      if (berr || !booking) return JSON.stringify({ ok: false, error: "Gagal membuat booking." });

      const { error: brErr } = await supabasePublic.from("booking_rooms").insert({
        booking_id: booking.id,
        room_id: null,
        room_type_id: rt.id as string,
        nightly_rate: rate,
      });
      if (brErr) return JSON.stringify({ ok: false, error: "Gagal menyimpan detail kamar." });

      return JSON.stringify({
        ok: true,
        reference_code: booking.reference_code,
        room_type: rt.name,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        nightly_rate: rate,
        total,
        guest: { full_name: fullName, email, phone },
        pembayaran: {
          bank: (p.payment_bank_name as string | undefined) || null,
          no_rekening: (p.payment_account_number as string | undefined) || null,
          atas_nama: (p.payment_account_holder as string | undefined) || null,
        },
      });
    };

    const tools = [
      {
        type: "function",
        function: {
          name: "check_room_availability",
          description:
            "Cek ketersediaan kamar nyata (jumlah kamar kosong per tipe) untuk rentang tanggal. Gunakan saat tamu menanyakan kamar tersedia/kosong atau ingin booking.",
          parameters: {
            type: "object",
            properties: {
              check_in: {
                type: "string",
                description: "Tanggal check-in format YYYY-MM-DD. Kosongkan untuk hari ini.",
              },
              check_out: {
                type: "string",
                description:
                  "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk sehari setelah check-in.",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_booking",
          description:
            "Buat pesanan/booking kamar untuk tamu. Panggil HANYA setelah tamu memilih tipe kamar dan memberikan nama lengkap, email, dan nomor HP. Jangan panggil bila data belum lengkap.",
          parameters: {
            type: "object",
            properties: {
              room_type: {
                type: "string",
                description: "Nama tipe kamar yang dipilih tamu, mis. 'Single'.",
              },
              full_name: { type: "string", description: "Nama lengkap tamu." },
              email: { type: "string", description: "Alamat email tamu." },
              phone: { type: "string", description: "Nomor HP/WhatsApp tamu." },
              check_in: {
                type: "string",
                description: "Tanggal check-in format YYYY-MM-DD.",
              },
              check_out: {
                type: "string",
                description: "Tanggal check-out format YYYY-MM-DD.",
              },
              adults: { type: "number", description: "Jumlah tamu dewasa. Default 1." },
              children: { type: "number", description: "Jumlah anak. Default 0." },
            },
            required: ["room_type", "full_name", "email", "phone", "check_in", "check_out"],
          },
        },
      },
    ];

    type LlmMsg = Record<string, unknown>;
    const messages: LlmMsg[] = [{ role: "system", content: system }, ...data.messages];

    try {
      // Tool-calling loop: the model may call the availability tool, we
      // run it, feed results back, and let it compose the final reply.
      for (let turn = 0; turn < 4; turn++) {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0.6,
            max_tokens: 600,
            messages,
            tools,
            tool_choice: "auto",
          }),
        });
        const raw = await res.text();
        let json: {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: {
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
          error?: { message?: string };
        };
        try {
          json = JSON.parse(raw);
        } catch {
          return {
            reply: null as string | null,
            error: `HTTP ${res.status}: ${raw.slice(0, 200)}`,
          };
        }
        const msg = json.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls ?? [];
        if (toolCalls.length) {
          messages.push(msg as LlmMsg);
          for (const tc of toolCalls) {
            let out = JSON.stringify({ error: "unknown tool" });
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function?.arguments || "{}");
            } catch {
              args = {};
            }
            if (tc.function?.name === "check_room_availability") {
              out = await runAvailability(args);
            } else if (tc.function?.name === "create_booking") {
              out = await runCreateBooking(args);
            }
            messages.push({ role: "tool", tool_call_id: tc.id, content: out });
          }
          continue;
        }
        const reply = msg?.content;
        if (reply && reply.trim()) {
          return { reply: reply.trim(), error: null as string | null };
        }
        const detail = json.error?.message ?? `HTTP ${res.status} · ${raw.slice(0, 400)}`;
        return { reply: null as string | null, error: detail };
      }
      return { reply: null as string | null, error: "TOOL_LOOP_LIMIT" };
    } catch (e) {
      return { reply: null as string | null, error: (e as Error).message };
    }
  });
