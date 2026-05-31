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
  "fonnte_token",
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
      fonnte_token: (row.fonnte_token as string | null) ?? null,
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
        fonnte_token: z.string().max(100).nullable().optional(),
        google_place_id: z.string().max(300).nullable().optional(),
        google_places_api_key: z.string().max(500).nullable().optional(),
        google_analytics_id: z.string().max(100).nullable().optional(),
        google_tag_manager_id: z.string().max(100).nullable().optional(),
        google_search_console: z.string().max(500).nullable().optional(),
        ai_api_key: z.string().max(500).nullable().optional(),
        ai_base_url: z.string().max(300).nullable().optional(),
        ai_model: z.string().max(120).nullable().optional(),
        payment_bank_name: z.string().max(100).nullable().optional(),
        payment_account_number: z.string().max(100).nullable().optional(),
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
/* Custom Google Reviews (editable, no Google Maps API)                */
/* Kept separate so a missing migration on the custom_google_* columns */
/* never breaks the main integration/credential reads.                  */
/* ------------------------------------------------------------------ */

const CUSTOM_GOOGLE_REVIEWS_FIELDS = [
  "custom_google_rating",
  "custom_google_reviews_total",
  "custom_google_reviews_json",
] as const;

export const getCustomGoogleReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: propRow } = await db(context.supabase)
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();
    const id = (propRow as Record<string, unknown> | null)?.id as string | undefined ?? null;
    if (!id) {
      return { id: null, custom_google_rating: null, custom_google_reviews_total: null, custom_google_reviews_json: null };
    }
    const { data, error } = await db(context.supabase)
      .from("properties")
      .select(`id, ${CUSTOM_GOOGLE_REVIEWS_FIELDS.join(", ")}`)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      // Migration not yet applied — degrade gracefully
      return { id, custom_google_rating: null, custom_google_reviews_total: null, custom_google_reviews_json: null };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id,
      custom_google_rating:
        row.custom_google_rating !== null && row.custom_google_rating !== undefined
          ? Number(row.custom_google_rating)
          : null,
      custom_google_reviews_total:
        row.custom_google_reviews_total !== null && row.custom_google_reviews_total !== undefined
          ? Number(row.custom_google_reviews_total)
          : null,
      custom_google_reviews_json: row.custom_google_reviews_json ?? null,
    };
  });

export const updateCustomGoogleReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        custom_google_rating: z.number().min(0).max(5).nullable().optional(),
        custom_google_reviews_total: z.number().int().min(0).nullable().optional(),
        custom_google_reviews_json: z.any().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    for (const k of CUSTOM_GOOGLE_REVIEWS_FIELDS) {
      if ((data as Record<string, unknown>)[k] !== undefined) patch[k] = (data as Record<string, unknown>)[k];
    }
    const { error } = await db(context.supabase).from("properties").update(patch).eq("id", data.id);
    if (error) {
      throw new Error(
        "Gagal menyimpan Google Reviews kustom. Pastikan migration 20260529120000_add_custom_google_reviews.sql sudah dijalankan. Detail: " +
          error.message,
      );
    }
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Web Search API keys (Tavily / Serper) — for AI Content Studio       */
/* Isolated from main integration query so a missing migration on      */
/* tavily_api_key/serper_api_key columns never breaks credential reads.*/
/* ------------------------------------------------------------------ */

export const getWebSearchApiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: propRow } = await db(context.supabase)
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle();
    const id = ((propRow as Record<string, unknown> | null)?.id as string | undefined) ?? null;
    if (!id) {
      return { id: null, tavily_api_key: null, serper_api_key: null };
    }
    const { data, error } = await db(context.supabase)
      .from("properties")
      .select("id, tavily_api_key, serper_api_key")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return { id, tavily_api_key: null, serper_api_key: null };
    }
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id,
      tavily_api_key: (row.tavily_api_key as string | null) ?? null,
      serper_api_key: (row.serper_api_key as string | null) ?? null,
    };
  });

export const updateWebSearchApiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        tavily_api_key: z.string().max(500).nullable().optional(),
        serper_api_key: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.tavily_api_key !== undefined) patch.tavily_api_key = data.tavily_api_key;
    if (data.serper_api_key !== undefined) patch.serper_api_key = data.serper_api_key;
    const { error } = await db(context.supabase).from("properties").update(patch).eq("id", data.id);
    if (error) {
      throw new Error(
        "Gagal menyimpan API key. Pastikan migration 20260530140000_add_web_search_api_keys.sql sudah dijalankan. Detail: " +
          error.message,
      );
    }
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
      .select("id, property_id, name, phone, role, is_active, created_at")
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

export const togglePropertyManagerActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("property_managers")
      .update({ is_active: data.is_active })
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

/* ------------------------------------------------------------------ */
/* Notification Logs                                                  */
/* ------------------------------------------------------------------ */

export const getNotificationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("notification_logs")
      .select("id, event_type, recipient_phone, recipient_role, message, attachment_url, status, attempts, error, sent_at, created_at, related_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });
