/**
 * Media Library
 *
 * Dedicated page for managing all uploaded media (images, videos, PDFs).
 * Features: upload with auto-WebP conversion, inline rename, inline alt text
 * editor, copy-URL, delete, filter by type.
 *
 * Media documents are stored in sop_documents with doc_category = "brosur".
 * - `name`    → display/file name shown in the UI (rename action)
 * - `content` → alt text for SEO / accessibility (alt text editor action)
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload,
  Trash2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Tag,
  Pencil,
  FileText,
  Images,
  Film,
  Search,
  X,
} from "lucide-react";

import {
  listSopDocuments,
  createSopDocument,
  deleteSopDocument,
  renameSopDocument,
  updateMediaAltText,
  type SopDocument,
} from "@/admin/modules/ai-lab/sop.functions";
import { supabase } from "@/integrations/supabase/client";
import { convertToWebP } from "@/lib/image-webp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi"];
const DOC_EXTS   = ["pdf"];

const ALL_ALLOWED = [...IMAGE_EXTS, ...VIDEO_EXTS, ...DOC_EXTS];
const ACCEPT      = ALL_ALLOWED.map((e) => `.${e}`).join(",");

type FilterType = "all" | "image" | "video" | "doc";

const FILTERS: { key: FilterType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "all",   label: "Semua",   icon: Images   },
  { key: "image", label: "Gambar",  icon: Images   },
  { key: "video", label: "Video",   icon: Film     },
  { key: "doc",   label: "Dokumen", icon: FileText },
];

function extToFilter(ext: string): FilterType {
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (DOC_EXTS.includes(ext))   return "doc";
  return "all";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* Upload progress bar                                                  */
/* ------------------------------------------------------------------ */

function UploadBar({ progress, total }: { progress: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round((progress / total) * 100);
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium">Mengunggah {progress}/{total} file…</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline editable field                                               */
/* ------------------------------------------------------------------ */

function InlineEdit({
  value,
  placeholder,
  icon: Icon,
  label,
  onSave,
}: {
  value: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [saving, setSaving] = React.useState(false);

  // Sync if parent value changes (after save refresh)
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed && label === "Nama") return; // name is required
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 border-t border-border px-3 py-1.5">
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setEditing(false); setDraft(value); }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          disabled={saving}
          onClick={commit}
          className="shrink-0 text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
          title="Simpan"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setDraft(value); }}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title="Batal"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true); }}
      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left transition hover:bg-muted/30"
      title={`Edit ${label.toLowerCase()}`}
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate text-[11px]", value ? "text-foreground" : "italic text-muted-foreground")}>
        {value || placeholder}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Media card                                                           */
/* ------------------------------------------------------------------ */

function MediaCard({
  doc,
  onDelete,
  onChanged,
}: {
  doc: SopDocument;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const ext       = (doc.file_type ?? "").toLowerCase();
  const filterKey = extToFilter(ext);
  const isImage   = filterKey === "image";
  const isVideo   = filterKey === "video";

  const [copied, setCopied] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const renameFn  = useServerFn(renameSopDocument);
  const altFn     = useServerFn(updateMediaAltText);
  const deleteFn  = useServerFn(deleteSopDocument);

  const publicUrl = doc.file_path
    ? supabase.storage.from("sop-documents").getPublicUrl(doc.file_path).data.publicUrl
    : null;

  const copyUrl = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    toast.success("URL disalin");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    setDeleting(true);
    try {
      await deleteFn({ data: { id: doc.id } });
      toast.success("File dihapus");
      onDelete();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const handleRename = async (name: string) => {
    if (!name) return;
    await renameFn({ data: { id: doc.id, name } });
    toast.success("Nama diperbarui");
    onChanged();
  };

  const handleAlt = async (altText: string) => {
    await altFn({ data: { id: doc.id, altText } });
    toast.success("Alt text diperbarui");
    onChanged();
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-white transition hover:border-stone-300 hover:shadow-sm">
      {/* Preview */}
      <div className="relative h-40 overflow-hidden bg-stone-100">
        {isImage && publicUrl ? (
          <img
            src={publicUrl}
            alt={doc.content || doc.name}
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : isVideo && publicUrl ? (
          <video
            src={publicUrl}
            className="h-full w-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-stone-300">
            <FileText className="h-12 w-12" />
            <span className="text-xs font-medium uppercase">{ext}</span>
          </div>
        )}

        {/* Type badge */}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          {ext}
        </span>

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs">
                <ExternalLink className="h-3.5 w-3.5" />
                Buka
              </Button>
            </a>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={deleting}
            className="h-8 gap-1 text-xs"
            onClick={handleDelete}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Hapus
          </Button>
        </div>
      </div>

      {/* Rename (display name) */}
      <InlineEdit
        value={doc.name}
        placeholder="Nama file…"
        icon={Pencil}
        label="Nama"
        onSave={handleRename}
      />

      {/* Alt text (SEO) — only for images and videos */}
      {(isImage || isVideo) && (
        <InlineEdit
          value={doc.content ?? ""}
          placeholder="Tulis alt text untuk SEO…"
          icon={Tag}
          label="Alt Text"
          onSave={handleAlt}
        />
      )}

      {/* Footer: date + copy URL */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">{formatDate(doc.created_at)}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!publicUrl}
          className="h-7 gap-1 px-2 text-xs"
          onClick={copyUrl}
          title="Salin URL"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Media Library view                                                   */
/* ------------------------------------------------------------------ */

export function MediaLibraryView() {
  const qc      = useQueryClient();
  const listFn  = useServerFn(listSopDocuments);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [filter,    setFilter]    = React.useState<FilterType>("all");
  const [search,    setSearch]    = React.useState("");
  const [uploaded,  setUploaded]  = React.useState(0);   // files done
  const [total,     setTotal]     = React.useState(0);   // files in current batch

  const { data, isLoading } = useQuery({
    queryKey: ["media-library"],
    queryFn: () => listFn({ data: { category: "brosur" } }),
  });
  const allDocs = (data?.documents ?? []) as SopDocument[];

  const refresh = () => qc.invalidateQueries({ queryKey: ["media-library"] });

  // Filtered + searched list
  const visible = React.useMemo(() => {
    let docs = allDocs;
    if (filter !== "all") {
      docs = docs.filter((d) => extToFilter((d.file_type ?? "").toLowerCase()) === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      docs = docs.filter((d) => d.name.toLowerCase().includes(q));
    }
    return docs;
  }, [allDocs, filter, search]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const validFiles = files.filter((f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      if (!ALL_ALLOWED.includes(ext)) {
        toast.error(`Format tidak didukung: ${f.name}`);
        return false;
      }
      if (f.size > 50 * 1024 * 1024) {
        toast.error(`File terlalu besar (maks 50 MB): ${f.name}`);
        return false;
      }
      return true;
    });

    if (!validFiles.length) return;

    setTotal(validFiles.length);
    setUploaded(0);

    let ok = 0;
    for (const rawFile of validFiles) {
      try {
        const isImg = rawFile.type.startsWith("image/");
        // Convert raster images to WebP; leave videos/PDFs untouched
        const file    = isImg ? await convertToWebP(rawFile) : rawFile;
        const ext     = (file.name.split(".").pop() ?? "bin").toLowerCase();
        const baseName = rawFile.name.replace(/\.[^.]+$/, ""); // original name w/o ext
        const path    = `brosur/${crypto.randomUUID()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from("sop-documents")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;

        const createFn = (await import("@/admin/modules/ai-lab/sop.functions")).createSopDocument;
        await createFn({
          data: {
            name: baseName,
            filePath: path,
            fileType: ext,
            content: "",           // alt text starts empty; user fills it in
            docCategory: "brosur",
          },
        });
        ok++;
        setUploaded((n) => n + 1);
      } catch (err) {
        toast.error(`Gagal upload ${rawFile.name}: ${(err as Error).message}`);
      }
    }

    setTotal(0);
    setUploaded(0);
    if (ok > 0) {
      toast.success(`${ok} file berhasil diunggah`);
      refresh();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Content
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Media Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kelola gambar dan video — atur nama, alt text, dan salin URL untuk dikirimkan ke tamu.
            </p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={onPick}
            />
            <Button
              className="gap-2 bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()}
              disabled={total > 0}
            >
              {total > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {total > 0 ? `Mengunggah ${uploaded}/${total}…` : "Upload Media"}
            </Button>
          </div>
        </header>

        {/* Upload progress bar */}
        <UploadBar progress={uploaded} total={total} />

        {/* Toolbar: filter + search */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Filter tabs */}
          <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  filter === key
                    ? "bg-white text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {key !== "all" && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    ({allDocs.filter((d) => extToFilter((d.file_type ?? "").toLowerCase()) === key).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama file…"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <span className="ml-auto text-xs text-muted-foreground">
            {visible.length} file
          </span>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Memuat media…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border py-24 text-center">
            <Images className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              {search || filter !== "all"
                ? "Tidak ada file yang cocok dengan filter."
                : "Belum ada media. Klik Upload Media untuk memulai."}
            </p>
            {!search && filter === "all" && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Pilih File
              </Button>
            )}
            {(search || filter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearch(""); setFilter("all"); }}
              >
                Reset filter
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((doc) => (
              <MediaCard
                key={doc.id}
                doc={doc}
                onDelete={refresh}
                onChanged={refresh}
              />
            ))}
          </div>
        )}

        {/* Help note */}
        {visible.length > 0 && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Gambar JPG/PNG otomatis dikonversi ke WebP saat upload · Klik nama atau ikon tag pada kartu untuk mengedit · Maks 50 MB per file
          </p>
        )}
      </div>
    </div>
  );
}
