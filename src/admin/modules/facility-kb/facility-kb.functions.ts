import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FACILITY_FIELDS } from "@/services/room-facility-kb";

/**
 * Kelola knowledge base fasilitas (room_facility_knowledge). Memakai klien
 * Supabase milik user → RLS tabel berlaku (baca: staf, tulis: admin).
 */
export const listFacilityKb = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const [kb, rooms] = await Promise.all([
      db.from("room_facility_knowledge").select(`id, room_type_id, ${FACILITY_FIELDS.join(", ")}, notes, updated_at`),
      db.from("room_types").select("id, name").order("name"),
    ]);
    if (kb.error) throw kb.error;
    if (rooms.error) throw rooms.error;
    return { rows: kb.data ?? [], rooms: rooms.data ?? [] } as {
      rows: Array<Record<string, string | null>>;
      rooms: Array<{ id: string; name: string }>;
    };
  });

const fieldShape = Object.fromEntries(
  [...FACILITY_FIELDS, "notes"].map((f) => [f, z.string().max(2000).nullable().optional()]),
) as Record<string, z.ZodOptional<z.ZodNullable<z.ZodString>>>;

export const saveFacilityKb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ roomTypeId: z.string().uuid().nullable(), values: z.object(fieldShape) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: context.userId ?? null };
    for (const [k, v] of Object.entries(data.values)) {
      if (v === undefined) continue;
      const t = (v ?? "").trim();
      patch[k] = t ? t : null; // kosong = belum diketahui → bot fallback/handoff
    }
    const sel = db.from("room_facility_knowledge").select("id");
    const { data: existing, error: e1 } = await (data.roomTypeId
      ? sel.eq("room_type_id", data.roomTypeId)
      : sel.is("room_type_id", null)
    ).maybeSingle();
    if (e1) throw e1;
    const res = existing?.id
      ? await db.from("room_facility_knowledge").update(patch).eq("id", existing.id)
      : await db.from("room_facility_knowledge").insert({ ...patch, room_type_id: data.roomTypeId });
    if (res.error) throw res.error;
    return { ok: true };
  });
