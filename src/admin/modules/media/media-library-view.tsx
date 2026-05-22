/**
 * Media Library — unified view for ALL media in the system.
 *
 * Shows two data sources in one grid:
 *  1. sop_documents (doc_category='brosur') — DB-backed → full features:
 *     rename, alt text editor, copy URL, delete
 *  2. room-images bucket (prefixes: media/, room-types/, branding/) —
 *     Storage-only → copy URL, delete (no DB row = no rename/alt text)
 *
 * New uploads go to the sop-documents bucket and get a DB row so they
 * immediately get full features.
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
  Link as LinkIcon,
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
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "ogg"];
const DOC_EXTS   = ["pdf"];

const ALL_ALLOWED = [...IMAGE_EXTS, ...VIDEO_EXTS, ...DOC_EXTS];
const ACCEPT      = ALL_ALLOWED.map((e) => `.${e}`).join(",");

type FilterType = "all" | "image" | "video" | "doc";

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

/* ------------------------------------------------------------------ */
/* Storage bucket prefixes for room-images                             */
/* ------------------------------------------------------------------ */

const ROOM_IMAGE_PREFIXES = [
  { prefix: "media",      label: "Hero Slider" },
  { prefix: "room-types", label: "Foto Kamar"  },
  { prefix: "branding",   label: "Branding"    },
];

type StorageAsset = {
  kind: "storage";
  id: string;          // bucket:prefix/name
  bucket: string;
  path: string;        // prefix/name
  name: string;        // raw filename
  displayName: string; // filename w/o extension
  ext: string;
  url: string;
  label: string;       // Human category label
  createdAt: string;
};

type DbAsset = {
  kind: "db";
  doc: SopDocument;
  url: string;
  ext: string;
};

type UnifiedAsset = StorageAsset | DbAsset;

function assetId(a: UnifiedAsset) { return a.kind === "db" ? `db:${a.doc.id}` : a.id; }
function assetName(a: UnifiedAsset) {
  return a.kind === "db" ? a.doc.name : a.displayName;
}
function assetExt(a: UnifiedAsset) { return a.ext; }
function assetUrl(a: UnifiedAsset) { return a.kind === "db" ? a.url : a.url; }
function assetDate(a: UnifiedAsset) {
  return a.kind === "db" ? a.doc.created_at : a.createdAt;
}
function assetLabel(a: UnifiedAsset) {
  return a.kind === "db" ? "Brosur" : a.label;
}

async function loadStorageAssets(): Promise<StorageAsset[]> {
  const all: StorageAsset[] = [];
  for (const { prefix, label } of ROOM_IMAGE_PREFIXES) {
    const { data, error } = await supabase.storage
      .from("room-images")
      .list(prefix, { limit: 500, sortBy: { column: "created_at", order: "desc" } });
    if (error) {
      console.warn(`[Media] list room-images/${prefix}:`, error.message);
      continue;
    }
    for (const f of data ?? []) {
      if (!f.name || f.name.startsWith(".")) continue;
      const path = `${prefix}/${f.name}`;
      const url  = supabase.storage.from("room-images").getPublicUrl(path).data.publicUrl;
      const ext  = (f.name.split(".").pop() ?? "").toLowerCase();
      all.push({
        kind: "storage",
        id: `room-images:${path}`,
        bucket: "room-images",
        path,
        name: f.name,
        displayName: f.name.replace(/\.[^.]+$/, ""),
        ext,
        url,
        label,
        createdAt: (f as { created_at?: string }).created_at ?? "",
      });
    }
  }
  return all;
}

/* ------------------------------------------------------------------ */
/* Inline editable field                                               */
/* ------------------------------------------------------------------ */

function InlineEdit({
  value,
  placeholder,
  icon: Icon,
  onSave,
}: {
  value: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft,   setDraft]   = React.useState(value);
  const [saving,  setSaving]  = React.useState(false);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = async () => {
    const t = draft.trim();
    if (!t) return;
    setSaving(true);
    try { await onSave(t); setEditing(false); }
    finally { setSaving(false); }
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
        <button type="button" disabled={saving} onClick={commit}
          className="shrink-0 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => { setEditing(false); setDraft(value); }}
          className="shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => { setDraft(value); setEditing(true); }}
      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left transition hover:bg-muted/30"
      title="Edit">
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={cn("min-w-0 flex-1 truncate text-[11px]",
        value ? "text-foreground" : "italic text-muted-foreground")}>
        {value || placeholder}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/50" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* DB-backed media card (brosur — full features)                       */
/* ------------------------------------------------------------------ */

function DbCard({ doc, url, ext, onDelete, onChanged }: {
  doc: SopDocument;
  url: string;
  ext: string;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  const [copied,   setCopied]   = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const renameFn = useServerFn(renameSopDocument);
  const altFn    = useServerFn(updateMediaAltText);
  const deleteFn = useServerFn(deleteSopDocument);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("URL disalin");
    setTimeout(() => setCopied(false), 2000);
  };
  const handleDelete = async () => {
    if (!confirm(`Hapus "${doc.name}"?`)) return;
    setDeleting(true);
    try { await deleteFn({ data: { id: doc.id } }); toast.success("File dihapus"); onDelete(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-white transition hover:border-stone-300 hover:shadow-sm">
      {/* Preview */}
      <div className="relative h-36 overflow-hidden bg-stone-100">
        {isImage ? (
          <img src={url} alt={doc.content || doc.name} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : isVideo ? (
          <video src={url} muted preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-stone-300">
            <FileText className="h-10 w-10" />
            <span className="text-xs font-medium uppercase">{ext}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{ext}</span>
        <span className="absolute right-2 top-2 rounded bg-teal-700/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">Brosur</span>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          {url && <a href={url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />Buka</Button></a>}
          <Button size="sm" variant="destructive" disabled={deleting} className="h-8 gap-1 text-xs" onClick={handleDelete}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Hapus
          </Button>
        </div>
      </div>

      {/* Rename */}
      <InlineEdit value={doc.name} placeholder="Nama file…" icon={Pencil}
        onSave={async (v) => { await renameFn({ data: { id: doc.id, name: v } }); toast.success("Nama diperbarui"); onChanged(); }} />

      {/* Alt text (images & videos) */}
      {(isImage || isVideo) && (
        <InlineEdit value={doc.content ?? ""} placeholder="Tulis alt text untuk SEO…" icon={Tag}
          onSave={async (v) => { await altFn({ data: { id: doc.id, altText: v } }); toast.success("Alt text diperbarui"); onChanged(); }} />
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">{formatDate(doc.created_at)}</span>
        <Button size="sm" variant="outline" disabled={!url} className="h-7 gap-1 px-2 text-xs" onClick={copyUrl}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Storage-only media card (room-images — copy URL + delete)          */
/* ------------------------------------------------------------------ */

function StorageCard({ asset, onDelete }: { asset: StorageAsset; onDelete: () => void }) {
  const isImage = IMAGE_EXTS.includes(asset.ext);
  const isVideo = VIDEO_EXTS.includes(asset.ext);
  const [copied,   setCopied]   = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(asset.url);
    setCopied(true);
    toast.success("URL disalin");
    setTimeout(() => setCopied(false), 2000);
  };
  const handleDelete = async () => {
    if (!confirm(`Hapus "${asset.name}"?`)) return;
    setDeleting(true);
    try {
      const { error } = await supabase.storage.from(asset.bucket).remove([asset.path]);
      if (error) throw error;
      toast.success("File dihapus");
      onDelete();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-white transition hover:border-stone-300 hover:shadow-sm">
      {/* Preview */}
      <div className="relative h-36 overflow-hidden bg-stone-100">
        {isImage ? (
          <img src={asset.url} alt={asset.displayName} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : isVideo ? (
          <video src={asset.url} muted preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-stone-300">
            <FileText className="h-10 w-10" />
            <span className="text-xs font-medium uppercase">{asset.ext}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{asset.ext}</span>
        <span className="absolute right-2 top-2 rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{asset.label}</span>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          <a href={asset.url} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />Buka</Button></a>
          <Button size="sm" variant="destructive" disabled={deleting} className="h-8 gap-1 text-xs" onClick={handleDelete}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Hapus
          </Button>
        </div>
      </div>

      {/* Display name (read-only for storage assets) */}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={asset.displayName}>
          {asset.displayName}
        </span>
        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground" title="Upload via Media Library untuk edit nama & alt text">
          hanya baca
        </span>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {asset.createdAt ? formatDate(asset.createdAt) : asset.label}
        </span>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={copyUrl}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
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
        <div className="h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Media Library view                                                   */
/* ------------------------------------------------------------------ */

const FILTER_LABELS: { key: FilterType; label: string }[] = [
  { key: "all",   label: "Semua"   },
  { key: "image", label: "Gambar"  },
  { key: "video", label: "Video"   },
  { key: "doc",   label: "Dokumen" },
];

const SOURCE_LABELS: { key: "all" | "brosur" | "room-images"; label: string }[] = [
  { key: "all",         label: "Semua sumber"   },
  { key: "brosur",      label: "Brosur / Upload" },
  { key: "room-images", label: "Hero & Kamar"   },
];

export function MediaLibraryView() {
  const qc     = useQueryClient();
  const listFn = useServerFn(listSopDocuments);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [filter,     setFilter]     = React.useState<FilterType>("all");
  const [source,     setSource]     = React.useState<"all" | "brosur" | "room-images">("all");
  const [search,     setSearch]     = React.useState("");
  const [uploaded,   setUploaded]   = React.useState(0);
  const [total,      setTotal]      = React.useState(0);
  const [storageAssets, setStorageAssets] = React.useState<StorageAsset[]>([]);
  const [storageLoading, setStorageLoading] = React.useState(true);

  // DB-backed brosur docs
  const { data, isLoading: dbLoading, refetch } = useQuery({
    queryKey: ["media-library"],
    queryFn: () => listFn({ data: { category: "brosur" } }),
  });
  const brosurDocs = (data?.documents ?? []) as SopDocument[];

  // Storage-only room-images assets
  const loadStorage = React.useCallback(async () => {
    setStorageLoading(true);
    const assets = await loadStorageAssets();
    setStorageAssets(assets);
    setStorageLoading(false);
  }, []);

  React.useEffect(() => { void loadStorage(); }, [loadStorage]);

  const refresh = () => { void refetch(); void loadStorage(); };

  // Build unified asset list
  const allAssets = React.useMemo<UnifiedAsset[]>(() => {
    const dbItems: UnifiedAsset[] = brosurDocs.map((doc) => {
      const ext = (doc.file_type ?? "").toLowerCase();
      const url = doc.file_path
        ? supabase.storage.from("sop-documents").getPublicUrl(doc.file_path).data.publicUrl
        : "";
      return { kind: "db", doc, url, ext } satisfies DbAsset;
    });
    const storageItems: UnifiedAsset[] = storageAssets.map((a) => a);
    return [...dbItems, ...storageItems];
  }, [brosurDocs, storageAssets]);

  // Filtered list
  const visible = React.useMemo<UnifiedAsset[]>(() => {
    let list = allAssets;
    if (source === "brosur")      list = list.filter((a) => a.kind === "db");
    if (source === "room-images") list = list.filter((a) => a.kind === "storage");
    if (filter !== "all")         list = list.filter((a) => extToFilter(assetExt(a)) === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => assetName(a).toLowerCase().includes(q));
    }
    return list;
  }, [allAssets, source, filter, search]);

  const isLoading = dbLoading || storageLoading;

  // Upload new files → sop-documents bucket (DB-backed, full features)
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const validFiles = files.filter((f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      if (!ALL_ALLOWED.includes(ext)) { toast.error(`Format tidak didukung: ${f.name}`); return false; }
      if (f.size > 50 * 1024 * 1024) { toast.error(`Maks 50 MB: ${f.name}`); return false; }
      return true;
    });
    if (!validFiles.length) return;

    setTotal(validFiles.length);
    setUploaded(0);
    let ok = 0;
    for (const rawFile of validFiles) {
      try {
        const file     = rawFile.type.startsWith("image/") ? await convertToWebP(rawFile) : rawFile;
        const ext      = (file.name.split(".").pop() ?? "bin").toLowerCase();
        const baseName = rawFile.name.replace(/\.[^.]+$/, "");
        const path     = `brosur/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("sop-documents").upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const createFn = (await import("@/admin/modules/ai-lab/sop.functions")).createSopDocument;
        await createFn({ data: { name: baseName, filePath: path, fileType: ext, content: "", docCategory: "brosur" } });
        ok++;
        setUploaded((n) => n + 1);
      } catch (err) {
        toast.error(`Gagal upload ${rawFile.name}: ${(err as Error).message}`);
      }
    }
    setTotal(0); setUploaded(0);
    if (ok > 0) { toast.success(`${ok} file berhasil diunggah`); refresh(); }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Content</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Media Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Semua gambar dan video — brosur, hero slider, foto kamar, dan branding.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onPick} />
            <Button className="gap-2 bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()} disabled={total > 0}>
              {total > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {total > 0 ? `Mengunggah ${uploaded}/${total}…` : "Upload Media"}
            </Button>
          </div>
        </header>

        <UploadBar progress={uploaded} total={total} />

        {/* Toolbar */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Type filter */}
          <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {FILTER_LABELS.map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                  filter === key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {label}
                {key !== "all" && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    ({allAssets.filter((a) => extToFilter(assetExt(a)) === key).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Source filter */}
          <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {SOURCE_LABELS.map(({ key, label }) => (
              <button key={key} onClick={() => setSource(key)}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                  source === key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari nama file…"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            {search && (
              <button type="button" onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">{visible.length} file</span>
        </div>

        {/* Legend */}
        <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-teal-700/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Brosur</span>
            Upload via Media Library — nama &amp; alt text bisa diedit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white">Hero / Kamar</span>
            Diupload via Page Builder / Room — bisa salin URL &amp; hapus
          </span>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />Memuat media…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border py-24 text-center">
            <Images className="h-14 w-14 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">
              {search || filter !== "all" || source !== "all"
                ? "Tidak ada file yang cocok dengan filter."
                : "Belum ada media. Klik Upload Media untuk memulai."}
            </p>
            {!search && filter === "all" && source === "all" && (
              <Button variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" />Pilih File
              </Button>
            )}
            {(search || filter !== "all" || source !== "all") && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilter("all"); setSource("all"); }}>
                Reset filter
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((asset) =>
              asset.kind === "db" ? (
                <DbCard key={assetId(asset)} doc={asset.doc} url={asset.url} ext={asset.ext}
                  onDelete={refresh} onChanged={refresh} />
              ) : (
                <StorageCard key={assetId(asset)} asset={asset} onDelete={() => {
                  setStorageAssets((prev) => prev.filter((a) => a.id !== asset.id));
                }} />
              )
            )}
          </div>
        )}

        {visible.length > 0 && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            JPG/PNG dikonversi ke WebP saat upload · Klik nama atau ikon tag untuk mengedit · Maks 50 MB per file
          </p>
        )}
      </div>
    </div>
  );
}
