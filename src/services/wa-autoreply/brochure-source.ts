/**
 * Sumber brosur PDF yang dikirim chatbot saat tamu minta foto/brosur.
 *
 * Insiden 28 Sep 2026: file PDF brosur ada di bucket publik `brosur`, tapi
 * tidak ada baris `sop_documents` dengan `storage_bucket = 'brosur'` yang
 * menunjuk ke file itu. `loadPublicBrochure` selalu `null`, jadi fast-path
 * brosur diam-diam gagal dan tamu hanya dikirimi foto WebP/JPEG per kamar.
 *
 * Urutan sumber (pertama yang valid menang):
 *   1. env `BROCHURE_PDF_URL` (override manual, harus https)
 *   2. baris `sop_documents` di bucket `brosur` (PDF didahulukan)
 *   3. file `.pdf` terbaru di bucket publik `brosur` (Storage list)
 *
 * Modul ini murni (tanpa I/O) supaya bisa dites tanpa Supabase.
 */

export const BROCHURE_BUCKET = "brosur";

/** Nama file yang dilihat tamu di WhatsApp (dokumen Meta wajib punya ekstensi). */
export const BROCHURE_FILENAME = "Brosur Pomah Guesthouse.pdf";

export interface BrochureFile {
  url: string;
  name: string;
  source: "env" | "sop_documents" | "storage";
}

export interface BrochureDocRow {
  name?: string | null;
  file_path?: string | null;
  storage_bucket?: string | null;
}

export interface BrochureStorageObject {
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: { mimetype?: string | null } | null;
}

const PDF_RE = /\.pdf(?:[?#]|$)/i;

export function isPdfUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && PDF_RE.test(url.trim());
}

/** URL publik Supabase Storage untuk `bucket/path`. */
export function publicStorageUrl(supabaseUrl: string, bucket: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const cleanPath = path
    .replace(/^\/+/, "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/storage/v1/object/public/${bucket}/${cleanPath}`;
}

function brochureFilename(url: string): string {
  return isPdfUrl(url) ? BROCHURE_FILENAME : BROCHURE_FILENAME.replace(/\.pdf$/i, "");
}

export function pickBrochure(input: {
  supabaseUrl: string;
  envUrl?: string | null;
  docs?: BrochureDocRow[] | null;
  storageObjects?: BrochureStorageObject[] | null;
}): BrochureFile | null {
  const envUrl = (input.envUrl ?? "").trim();
  if (/^https:\/\//i.test(envUrl)) {
    return { url: envUrl, name: brochureFilename(envUrl), source: "env" };
  }

  const supabaseUrl = (input.supabaseUrl ?? "").trim();
  if (!supabaseUrl) return null;

  const docFiles = (input.docs ?? [])
    .filter(
      (d) =>
        (d.storage_bucket ?? "").trim().toLowerCase() === BROCHURE_BUCKET &&
        typeof d.file_path === "string" &&
        d.file_path.trim().length > 0,
    )
    .map((d) => publicStorageUrl(supabaseUrl, BROCHURE_BUCKET, d.file_path!.trim()));
  const docPdf = docFiles.find(isPdfUrl);
  if (docPdf) return { url: docPdf, name: BROCHURE_FILENAME, source: "sop_documents" };

  const storagePdf = [...(input.storageObjects ?? [])]
    .filter((o) => {
      const name = (o.name ?? "").trim();
      if (!name || name.endsWith("/") || name.startsWith(".")) return false;
      return isPdfUrl(name) || o.metadata?.mimetype === "application/pdf";
    })
    .sort((a, b) =>
      String(b.updated_at ?? b.created_at ?? "").localeCompare(
        String(a.updated_at ?? a.created_at ?? ""),
      ),
    )[0];
  if (storagePdf?.name) {
    return {
      url: publicStorageUrl(supabaseUrl, BROCHURE_BUCKET, storagePdf.name.trim()),
      name: BROCHURE_FILENAME,
      source: "storage",
    };
  }

  // Brosur non-PDF (mis. gambar) yang terdaftar tetap lebih baik daripada tidak ada.
  const docAny = docFiles[0];
  if (docAny) return { url: docAny, name: brochureFilename(docAny), source: "sop_documents" };
  return null;
}

/** Balasan teks saat dokumen brosur gagal dikirim: sertakan tautan langsung. */
export function brochureLinkFallbackReply(url: string): string {
  return (
    `Dengan senang hati Kak 😊 Ini brosur Pomah Guesthouse ya, bisa dibuka lewat tautan berikut:\n${url}\n\n` +
    "Rencana menginap tanggal berapa dan untuk berapa orang?"
  );
}
