import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BROCHURE_BUCKET, pickBrochure, type BrochureFile } from "./brochure-source";

/**
 * Brosur PDF publik untuk dikirim ke tamu (dipakai bot dan tombol "Kirim
 * Brosur" admin). Lihat `brochure-source.ts` untuk urutan sumber
 * (env → sop_documents bucket `brosur` → Storage bucket `brosur`).
 */
export async function loadPublicBrochure(): Promise<BrochureFile | null> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const envUrl = process.env.BROCHURE_PDF_URL ?? "";
  if (!supabaseUrl && !envUrl) return null;
  const direct = pickBrochure({ supabaseUrl, envUrl });
  if (direct) return direct;
  const [{ data: docs }, storageList] = await Promise.all([
    (supabaseAdmin as any)
      .from("sop_documents")
      .select("name, file_path, storage_bucket")
      .eq("storage_bucket", BROCHURE_BUCKET)
      .order("created_at", { ascending: false })
      .limit(20),
    (supabaseAdmin as any).storage
      .from(BROCHURE_BUCKET)
      .list("", { limit: 50, sortBy: { column: "created_at", order: "desc" } })
      .catch((e: unknown) => ({ data: null, error: e })),
  ]);
  if (storageList?.error) {
    console.warn("[Brosur] brosur bucket list failed:", storageList.error);
  }
  return pickBrochure({ supabaseUrl, docs: docs ?? [], storageObjects: storageList?.data ?? [] });
}
