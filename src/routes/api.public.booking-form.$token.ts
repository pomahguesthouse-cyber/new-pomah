import { createFileRoute } from "@tanstack/react-router";

/**
 * Endpoint publik untuk form booking sekali pakai.
 *
 * - GET  /api/public/booking-form/:token  → ambil prefill (kamar, tanggal,
 *   katalog kamar dasar) untuk render form. Tidak mengekspos data tamu lain.
 * - POST /api/public/booking-form/:token  → simpan submission, tandai
 *   status submitted, dan enqueue pesan sintetis ke chatbot.
 *
 * Token bertindak sebagai secret (32 char base64url, expire 30 menit), jadi
 * route ini publik dan tidak membutuhkan login.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

interface SubmissionPayload {
  fullName?: string;
  email?: string | null;
  guestCount?: number;
  rooms?: number;
  extrabed?: number;
  checkIn?: string;
  checkOut?: string;
  roomTypeId?: string;
  notes?: string | null;
}

function validateSubmission(raw: unknown): { ok: true; value: import("@/services/booking-form.service").BookingFormSubmission } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Payload tidak valid" };
  const p = raw as SubmissionPayload;

  const fullName = (p.fullName ?? "").trim();
  if (fullName.length < 2) return { ok: false, error: "Nama lengkap wajib diisi" };
  if (fullName.length > 120) return { ok: false, error: "Nama terlalu panjang" };

  const guestCount = Number(p.guestCount);
  if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 20) {
    return { ok: false, error: "Jumlah tamu tidak valid" };
  }
  const rooms = Number(p.rooms);
  if (!Number.isFinite(rooms) || rooms < 1 || rooms > 10) {
    return { ok: false, error: "Jumlah kamar tidak valid" };
  }
  const extrabed = Number(p.extrabed ?? 0);
  if (!Number.isFinite(extrabed) || extrabed < 0 || extrabed > 10) {
    return { ok: false, error: "Jumlah extra bed tidak valid" };
  }

  const checkIn = (p.checkIn ?? "").trim();
  const checkOut = (p.checkOut ?? "").trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(checkIn) || !dateRe.test(checkOut)) {
    return { ok: false, error: "Tanggal tidak valid" };
  }
  if (new Date(checkOut).getTime() <= new Date(checkIn).getTime()) {
    return { ok: false, error: "Tanggal check-out harus setelah check-in" };
  }

  const roomTypeId = (p.roomTypeId ?? "").trim();
  if (!roomTypeId) return { ok: false, error: "Pilih tipe kamar terlebih dahulu" };

  const emailRaw = (p.email ?? "").trim();
  let email: string | null = null;
  if (emailRaw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) || emailRaw.length > 200) {
      return { ok: false, error: "Format email tidak valid" };
    }
    email = emailRaw;
  }

  const notes = (p.notes ?? "").toString().trim().slice(0, 500) || null;

  return {
    ok: true,
    value: { fullName, email, guestCount, rooms, extrabed, checkIn, checkOut, roomTypeId, notes },
  };
}

export const Route = createFileRoute("/api/public/booking-form/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token;
        if (!token || token.length < 16) return jsonResponse({ error: "Token tidak valid" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getBookingFormByToken, isFormTokenUsable } = await import("@/services/booking-form.service");

        const row = await getBookingFormByToken(supabaseAdmin as any, token);
        if (!row) return jsonResponse({ error: "Token tidak ditemukan" }, 404);

        const usable = isFormTokenUsable(row);
        const status = row.status === "submitted" ? "submitted" : usable ? "pending" : "expired";

        // Ambil katalog kamar publik (id, name, base_rate, capacity, extrabed_*)
        // — hanya properti yang sama dengan token (kalau ada), kalau tidak,
        // semua kamar aktif (Pomah single-property).
        let roomsQuery = (supabaseAdmin as any)
          .from("room_types")
          .select("id, name, slug, base_rate, capacity, extrabed_capacity, extrabed_rate, hero_image_url, property_id");
        if (row.property_id) roomsQuery = roomsQuery.eq("property_id", row.property_id);
        const { data: rooms } = await roomsQuery.order("base_rate", { ascending: true });

        return jsonResponse({
          status,
          expiresAt: row.expires_at,
          submittedAt: row.submitted_at,
          prefill: row.prefill_data ?? {},
          rooms: rooms ?? [],
          phoneMasked: row.phone.replace(/^(\+?\d{2,4})(\d+)(\d{3})$/, (_, a, b, c) => `${a}${"•".repeat(Math.max(b.length, 0))}${c}`),
        });
      },

      POST: async ({ request, params }) => {
        const token = params.token;
        if (!token || token.length < 16) return jsonResponse({ error: "Token tidak valid" }, 400);

        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonResponse({ error: "Body JSON tidak valid" }, 400);
        }

        const validated = validateSubmission(payload);
        if (!validated.ok) return jsonResponse({ error: validated.error }, 422);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { submitBookingForm } = await import("@/services/booking-form.service");

        const result = await submitBookingForm({
          supabaseAdmin: supabaseAdmin as any,
          token,
          submission: validated.value,
        });

        if (!result.ok) return jsonResponse({ error: result.error ?? "Gagal menyimpan" }, 409);
        return jsonResponse({ ok: true });
      },
    },
  },
});
