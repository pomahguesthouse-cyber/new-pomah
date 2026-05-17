/**
 * Server functions for the Visual Page Builder.
 *
 * All admin operations are gated by `requireSupabaseAuth` (staff only;
 * RLS enforces this a second time at the database layer). The page
 * builder tables are not yet in the generated Supabase `Database` type,
 * so we access them through an untyped client view and re-type the rows
 * with the interfaces in `./types`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EMPTY_PAGE, type LandingPageVersionRow } from "./types";

/** View the authed Supabase client without the generated table types. */
function db(supabase: unknown): SupabaseClient {
  return supabase as SupabaseClient;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The page document is a free-form JSONB blob (sections + theme, or the
 * legacy `nodes` shape). The client `normalizePage()` enforces structure
 * on read, so the server only needs a permissive object check here.
 */
const pageContentSchema = z.record(z.string(), z.unknown());

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/** List every landing page (lightweight columns for the index view). */
export const listLandingPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("landing_pages")
      .select("id, title, slug, status, updated_at, published_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return { pages: data ?? [] };
  });

/** Fetch a single landing page with its full draft content. */
export const getLandingPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: page, error } = await db(context.supabase)
      .from("landing_pages")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!page) throw new Error("Page not found");
    // `page` is untyped (builder tables absent from generated types);
    // the editor route re-types it as LandingPageRow.
    return { page };
  });

/* ------------------------------------------------------------------ */
/* Create / duplicate                                                  */
/* ------------------------------------------------------------------ */

/** Create a new, empty landing page. */
export const createLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        title: z.string().min(1).max(160),
        slug: z
          .string()
          .min(1)
          .max(120)
          .regex(SLUG_RE, "Use lowercase letters, numbers and hyphens"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await db(context.supabase)
      .from("landing_pages")
      .insert({
        title: data.title,
        slug: data.slug,
        status: "draft",
        content: EMPTY_PAGE,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(`Slug "${data.slug}" is already in use`);
      throw error;
    }
    return { id: row.id as string };
  });

/** Duplicate an existing page (draft copy, "-copy" slug suffix). */
export const duplicateLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: src, error: e1 } = await db(context.supabase)
      .from("landing_pages")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (e1) throw e1;
    if (!src) throw new Error("Page not found");

    const base = `${src.slug}-copy`;
    let slug = base;
    for (let i = 2; i < 50; i++) {
      const { data: hit } = await db(context.supabase)
        .from("landing_pages")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!hit) break;
      slug = `${base}-${i}`;
    }

    const { data: row, error } = await db(context.supabase)
      .from("landing_pages")
      .insert({
        title: `${src.title} (copy)`,
        slug,
        status: "draft",
        content: src.content,
        seo_title: src.seo_title,
        seo_description: src.seo_description,
        og_image_url: src.og_image_url,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row.id as string };
  });

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

/** Save draft content and/or page metadata (autosave target). */
export const updateLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(160).optional(),
        slug: z.string().min(1).max(120).regex(SLUG_RE).optional(),
        content: pageContentSchema.optional(),
        seo_title: z.string().max(200).nullable().optional(),
        seo_description: z.string().max(400).nullable().optional(),
        og_image_url: z.string().url().nullable().optional().or(z.literal("")),
        canonical_url: z.string().url().nullable().optional().or(z.literal("")),
        noindex: z.boolean().optional(),
        tags: z.array(z.string().max(60)).max(30).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.content !== undefined) patch.content = data.content;
    if (data.seo_title !== undefined) patch.seo_title = data.seo_title;
    if (data.seo_description !== undefined) patch.seo_description = data.seo_description;
    if (data.og_image_url !== undefined) patch.og_image_url = data.og_image_url || null;
    if (data.canonical_url !== undefined) patch.canonical_url = data.canonical_url || null;
    if (data.noindex !== undefined) patch.noindex = data.noindex;
    if (data.tags !== undefined) patch.tags = data.tags;

    const { error } = await db(context.supabase)
      .from("landing_pages")
      .update(patch)
      .eq("id", data.id);
    if (error) {
      if (error.code === "23505") throw new Error("That slug is already in use");
      throw error;
    }
    return { ok: true };
  });

/** Permanently delete a landing page (and its versions, via cascade). */
export const deleteLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).from("landing_pages").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Publish + version history                                           */
/* ------------------------------------------------------------------ */

/** Publish the current draft: snapshot a version and go live. */
export const publishLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), label: z.string().max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: page, error: e1 } = await db(context.supabase)
      .from("landing_pages")
      .select("content")
      .eq("id", data.id)
      .maybeSingle();
    if (e1) throw e1;
    if (!page) throw new Error("Page not found");

    // Next version number.
    const { data: last } = await db(context.supabase)
      .from("landing_page_versions")
      .select("version_number")
      .eq("page_id", data.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (last?.version_number ?? 0) + 1;

    const { error: e2 } = await db(context.supabase)
      .from("landing_page_versions")
      .insert({
        page_id: data.id,
        version_number: nextVersion,
        content: page.content,
        label: data.label ?? `Published v${nextVersion}`,
        created_by: context.userId,
      });
    if (e2) throw e2;

    const { error: e3 } = await db(context.supabase)
      .from("landing_pages")
      .update({
        status: "published",
        published_content: page.content,
        published_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (e3) throw e3;

    return { ok: true, version: nextVersion };
  });

/** Take a published page offline (status back to draft). */
export const unpublishLandingPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("landing_pages")
      .update({ status: "draft" })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** List the version history of a page (newest first). */
export const listPageVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ pageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await db(context.supabase)
      .from("landing_page_versions")
      .select("id, page_id, version_number, label, created_at")
      .eq("page_id", data.pageId)
      .order("version_number", { ascending: false });
    if (error) throw error;
    return { versions: (rows ?? []) as Omit<LandingPageVersionRow, "content">[] };
  });

/** Restore a past version into the working draft. */
export const restorePageVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ versionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: version, error: e1 } = await db(context.supabase)
      .from("landing_page_versions")
      .select("page_id, content")
      .eq("id", data.versionId)
      .maybeSingle();
    if (e1) throw e1;
    if (!version) throw new Error("Version not found");

    const { error: e2 } = await db(context.supabase)
      .from("landing_pages")
      .update({ content: version.content })
      .eq("id", version.page_id);
    if (e2) throw e2;
    return { ok: true, pageId: version.page_id as string };
  });
