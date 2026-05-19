/**
 * SOP knowledge base — uploaded documents the AI agents draw on when
 * answering. Files live in the `sop-documents` storage bucket; this
 * table keeps their metadata and extracted text `content`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  created_at: string;
};

/** List all SOP documents, newest first. */
export const listSopDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await db(context.supabase)
      .from("sop_documents")
      .select("id, name, file_path, file_type, source_url, content, created_at")
      .order("created_at", { ascending: false });
    return { documents: (data ?? []) as unknown as SopDocument[] };
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
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = db(context.supabase);
    const { data: prop } = await sb.from("properties").select("id").limit(1).maybeSingle();
    const { error } = await sb.from("sop_documents").insert({
      property_id: (prop as Record<string, unknown> | null)?.id ?? null,
      name: data.name,
      file_path: data.filePath || null,
      file_type: data.fileType || null,
      source_url: data.sourceUrl || null,
      content: data.content || null,
    });
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
    const { error } = await db(context.supabase)
      .from("sop_documents")
      .update({ content: data.content })
      .eq("id", data.id);
    if (error) throw error;
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
