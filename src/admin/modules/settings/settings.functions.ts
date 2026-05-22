import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Untyped client view — branding columns aren't in the generated types. */
function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

/** Read domain settings from the first property row. */
export const getDomainSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("properties")
      .select("id, public_domain")
      .limit(1)
      .maybeSingle();
    return {
      id: data?.id ?? null,
      public_domain: ((data as Record<string, unknown>)?.public_domain as string | null) ?? null,
    };
  });

/* ------------------------------------------------------------------ */
/* Property Core Settings                                             */
/* ------------------------------------------------------------------ */

const PROPERTY_CORE_FIELDS = [
  "name",
  "tagline",
  "address",
  "city",
  "country",
  "email",
  "phone",
  "whatsapp_number",
  "currency",
  "timezone",
  "public_domain",
] as const;

export const getPropertySettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("properties")
      .select(`id, ${PROPERTY_CORE_FIELDS.join(", ")}`)
      .limit(1)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: (row.id as string | undefined) ?? null,
      name: (row.name as string | null) ?? null,
      tagline: (row.tagline as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      country: (row.country as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      whatsapp_number: (row.whatsapp_number as string | null) ?? null,
      currency: (row.currency as string | null) ?? null,
      timezone: (row.timezone as string | null) ?? null,
      public_domain: (row.public_domain as string | null) ?? null,
    };
  });

export const updatePropertySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().max(100).nullable().optional(),
        tagline: z.string().max(250).nullable().optional(),
        address: z.string().max(500).nullable().optional(),
        city: z.string().max(100).nullable().optional(),
        country: z.string().max(100).nullable().optional(),
        email: z.string().email().max(100).nullable().optional().or(z.literal("")),
        phone: z.string().max(50).nullable().optional(),
        whatsapp_number: z.string().max(50).nullable().optional(),
        currency: z.string().max(10).nullable().optional(),
        timezone: z.string().max(100).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    const d = data as Record<string, unknown>;
    for (const k of PROPERTY_CORE_FIELDS) {
      if (d[k] !== undefined) {
        if (k === "email" && d[k] === "") patch[k] = null;
        else patch[k] = d[k];
      }
    }
    const { error } = await db(context.supabase).from("properties").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Persist domain settings for the first property row. */
export const updateDomainSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        public_domain: z.string().max(253).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("properties")
      .update({
        public_domain: data.public_domain ?? null,
      } as never)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Branding — guesthouse logo, invoice logo, favicon                    */
/* ------------------------------------------------------------------ */

/** Read the property's branding asset URLs. */
export const getBrandingSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("properties")
      .select("id, logo_url, invoice_logo_url, favicon_url")
      .limit(1)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: (row.id as string | undefined) ?? null,
      logo_url: (row.logo_url as string | null) ?? null,
      invoice_logo_url: (row.invoice_logo_url as string | null) ?? null,
      favicon_url: (row.favicon_url as string | null) ?? null,
    };
  });

/** Persist one or more branding asset URLs for the property. */
export const updateBrandingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        logo_url: z.string().url().max(1000).nullable().optional(),
        invoice_logo_url: z.string().url().max(1000).nullable().optional(),
        favicon_url: z.string().url().max(1000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.logo_url !== undefined) patch.logo_url = data.logo_url;
    if (data.invoice_logo_url !== undefined) patch.invoice_logo_url = data.invoice_logo_url;
    if (data.favicon_url !== undefined) patch.favicon_url = data.favicon_url;
    const { error } = await db(context.supabase).from("properties").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Integrations — Fonnte WhatsApp + Google services                    */
/* ------------------------------------------------------------------ */

const INTEGRATION_FIELDS = [
  "meta_access_token",
  "meta_phone_number_id",
  "meta_verify_token",
  "google_place_id",
  "google_places_api_key",
  "google_analytics_id",
  "google_tag_manager_id",
  "google_search_console",
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "payment_bank_name",
  "payment_account_number",
  "payment_account_holder",
  "hotel_policy",
] as const;

/** Default hotel policy used until the property sets its own. */
export const DEFAULT_HOTEL_POLICY = [
  "Tidak diperbolehkan membawa makanan/buah berbau menyengat seperti durian",
  "Tidak diperbolehkan mengkonsumsi alkohol di penginapan ini",
  "Tidak diperbolehkan melakukan pesta",
  "Tidak boleh merokok di dalam kamar",
  "Area merokok pada lokasi tertentu seperti balkon dan lobby lantai 2",
].join("\n");

/** Read the property's third-party integration settings. */
export const getIntegrationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("properties")
      .select(`id, ${INTEGRATION_FIELDS.join(", ")}`)
      .limit(1)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: (row.id as string | undefined) ?? null,
      meta_access_token: (row.meta_access_token as string | null) ?? null,
      meta_phone_number_id: (row.meta_phone_number_id as string | null) ?? null,
      meta_verify_token: (row.meta_verify_token as string | null) ?? null,
      google_place_id: (row.google_place_id as string | null) ?? null,
      google_places_api_key: (row.google_places_api_key as string | null) ?? null,
      google_analytics_id: (row.google_analytics_id as string | null) ?? null,
      google_tag_manager_id: (row.google_tag_manager_id as string | null) ?? null,
      google_search_console: (row.google_search_console as string | null) ?? null,
      ai_api_key: (row.ai_api_key as string | null) ?? null,
      ai_base_url: (row.ai_base_url as string | null) ?? null,
      ai_model: (row.ai_model as string | null) ?? null,
      payment_bank_name: (row.payment_bank_name as string | null) ?? null,
      payment_account_number: (row.payment_account_number as string | null) ?? null,
      payment_account_holder: (row.payment_account_holder as string | null) ?? null,
      hotel_policy: (row.hotel_policy as string | null) ?? null,
    };
  });

/** Persist one or more integration settings for the property. */
export const updateIntegrationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        meta_access_token: z.string().max(2000).nullable().optional(),
        meta_phone_number_id: z.string().max(50).nullable().optional(),
        meta_verify_token: z.string().max(100).nullable().optional(),
        google_place_id: z.string().max(300).nullable().optional(),
        google_places_api_key: z.string().max(500).nullable().optional(),
        google_analytics_id: z.string().max(100).nullable().optional(),
        google_tag_manager_id: z.string().max(100).nullable().optional(),
        google_search_console: z.string().max(500).nullable().optional(),
        ai_api_key: z.string().max(500).nullable().optional(),
        ai_base_url: z.string().max(300).nullable().optional(),
        ai_model: z.string().max(120).nullable().optional(),
        payment_bank_name: z.string().max(120).nullable().optional(),
        payment_account_number: z.string().max(60).nullable().optional(),
        payment_account_holder: z.string().max(120).nullable().optional(),
        hotel_policy: z.string().max(4000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    for (const k of INTEGRATION_FIELDS) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    const { error } = await db(context.supabase).from("properties").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Property Managers                                                  */
/* ------------------------------------------------------------------ */

export const getPropertyManagers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("property_managers")
      .select("id, property_id, name, phone, role, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

export const addPropertyManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        property_id: z.string().uuid(),
        name: z.string().min(1).max(100),
        phone: z.string().min(5).max(20),
        role: z.enum(["super_admin", "booking_manager", "viewer"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).from("property_managers").insert([data]);
    if (error) throw error;
    return { ok: true };
  });

export const updatePropertyManagerRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        role: z.enum(["super_admin", "booking_manager", "viewer"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("property_managers")
      .update({ role: data.role })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deletePropertyManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.string().uuid().parse(d))
  .handler(async ({ data: id, context }) => {
    const { error } = await db(context.supabase).from("property_managers").delete().eq("id", id);
    if (error) throw error;
    return { ok: true };
  });
