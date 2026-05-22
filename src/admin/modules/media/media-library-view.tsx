/**
 * Media Library — unified view for ALL media in the system.
 *
 * Layout: folder sidebar (left) + file grid (right).
 *
 * Two data sources:
 *  1. sop_documents (doc_category='brosur') — DB-tracked, full features:
 *     rename, alt text, move to folder, copy URL, delete.
 *     storage_bucket tells which bucket holds the actual file:
 *       NULL / "sop-documents" → sop-documents bucket
 *       "room-images"          → room-images bucket
 *
 *  2. room-images bucket (prefixes media/, room-types/, branding/) that
 *     have NOT yet been registered in sop_documents. These show
 *     "Tambah nama & alt text"; clicking opens RegisterDialog which
 *     creates a sop_documents row and unlocks full editing.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload, Trash2, Loader2, Copy, Check, ExternalLink,
  Tag, Pencil, FileText, Images, Film, Search, X, Plus,
  FolderOpen, Folder, FolderPlus, ChevronRight,
} from "lucide-react";

import {
  listSopDocuments,
  createSopDocument,
  deleteSopDocument,
  renameSopDocument,
  updateMediaAltText,
  moveDocToFolder,
  listMediaFolders,
  createMediaFolder,
  renameMediaFolder,
  deleteMediaFolder,
  type SopDocument,
  type MediaFolder,
} from "@/admin/modules/ai-lab/sop.functions";
import { supabase } from "@/integrations/supabase/client";
import { convertToWebP } from "@/lib/image-webp";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
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

/** Folder name sentinel meaning "show all files regardless of folder". */
const ALL_FILES = "__all__";
/** Folder name sentinel meaning "show files with no folder assigned". */
const NO_FOLDER = "__none__";

const FILTER_TABS: { key: FilterType; label: string }[] = [
  { key: "all",   label: "Semua"   },
  { key: "image", label: "Gambar"  },
  { key: "video", label: "Video"   },
  { key: "doc",   label: "Dokumen" },
];

function extToFilter(ext: string): FilterType {
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (DOC_EXTS.includes(ext))   return "doc";
  return "all";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/* Storage listing helpers                                             */
/* ------------------------------------------------------------------ */

const ROOM_IMAGE_PREFIXES = [
  { prefix: "media",      label: "Hero Slider" },
  { prefix: "room-types", label: "Foto Kamar"  },
  { prefix: "branding",   label: "Branding"    },
];

function getAutoFolder(pathOrPrefix: string): string {
  const prefix = pathOrPrefix.split("/")[0];
  return ROOM_IMAGE_PREFIXES.find((p) => p.prefix === prefix)?.label ?? "Lainnya";
}

type StorageAsset = {
  id: string;
  bucket: string;
  path: string;
  name: string;
  displayName: string;
  ext: string;
  url: string;
  autoFolder: string;
  createdAt: string;
};

/** Resolve public URL from a SopDocument, respecting storage_bucket. */
function docPublicUrl(doc: SopDocument): string {
  if (!doc.file_path) return "";
  const bucket = doc.storage_bucket || "sop-documents";
  return supabase.storage.from(bucket).getPublicUrl(doc.file_path).data.publicUrl;
}

async function loadStorageAssets(registeredPaths: Set<string>): Promise<StorageAsset[]> {
  const all: StorageAsset[] = [];
  for (const { prefix, label } of ROOM_IMAGE_PREFIXES) {
    const { data, error } = await supabase.storage
      .from("room-images")
      .list(prefix, { limit: 500, sortBy: { column: "created_at", order: "desc" } });
    if (error) { console.warn(`[Media] list room-images/${prefix}:`, error.message); continue; }
    for (const f of data ?? []) {
      if (!f.name || f.name.startsWith(".")) continue;
      const path = `${prefix}/${f.name}`;
      if (registeredPaths.has(path)) continue;
      const url = supabase.storage.from("room-images").getPublicUrl(path).data.publicUrl;
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      all.push({
        id: `room-images:${path}`,
        bucket: "room-images",
        path,
        name: f.name,
        displayName: f.name.replace(/\.[^.]+$/, ""),
        ext,
        url,
        autoFolder: label,
        createdAt: (f as { created_at?: string }).created_at ?? "",
      });
    }
  }
  return all;
}

/* ------------------------------------------------------------------ */
/* Preview                                                              */
/* ------------------------------------------------------------------ */

function Preview({ url, ext, altText, name }: {
  url: string; ext: string; altText?: string | null; name: string;
}) {
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  return (
    <>
      {isImage ? (
        <img src={url} alt={altText || name}
          className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
      ) : isVideo ? (
        <video src={url} muted preload="metadata" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-stone-300">
          <FileText className="h-10 w-10" />
          <span className="text-xs font-medium uppercase">{ext}</span>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Inline editable field                                               */
/* ------------------------------------------------------------------ */

function InlineEdit({ value, placeholder, icon: Icon, onSave }: {
  value: string;
  placeholder: string;
  icon: React.ComponentType<{ className?: string }>;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft,   setDraft]   = React.useState(value);
  const [saving,  setSaving]  = React.useState(false);

  React.useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

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
        <input autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") { setEditing(false); setDraft(value); }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button type="button" disabled={saving} onClick={() => void commit()}
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
/* Folder move row (inside DbCard)                                     */
/* ------------------------------------------------------------------ */

function FolderMoveRow({ docId, currentFolder, folders, onMoved }: {
  docId: string;
  currentFolder: string | null;
  folders: MediaFolder[];
  onMoved: () => void;
}) {
  const moveFn  = useServerFn(moveDocToFolder);
  const [moving, setMoving] = React.useState(false);

  const handleChange = async (val: string) => {
    const next = val === "" ? null : val;
    if (next === currentFolder) return;
    setMoving(true);
    try {
      await moveFn({ data: { id: docId, folder: next } });
      toast.success(next ? `Dipindah ke "${next}"` : "Dihapus dari folder");
      onMoved();
    } catch (e) { toast.error((e as Error).message); }
    finally { setMoving(false); }
  };

  return (
    <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
      <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
      {moving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (
        <select
          value={currentFolder ?? ""}
          onChange={(e) => void handleChange(e.target.value)}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-[11px] text-muted-foreground focus:outline-none"
        >
          <option value="">— Tanpa folder —</option>
          {folders.map((f) => (
            <option key={f.id} value={f.name}>{f.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DB-backed card (full features)                                      */
/* ------------------------------------------------------------------ */

function DbCard({ doc, folders, onDelete, onChanged }: {
  doc: SopDocument;
  folders: MediaFolder[];
  onDelete: () => void;
  onChanged: () => void;
}) {
  const ext     = (doc.file_type ?? "").toLowerCase();
  const isImage = IMAGE_EXTS.includes(ext);
  const isVideo = VIDEO_EXTS.includes(ext);
  const url     = docPublicUrl(doc);
  const bucket  = doc.storage_bucket || "sop-documents";

  const badgeLabel = bucket === "room-images"
    ? (doc.file_path?.startsWith("media/")      ? "Hero Slider"
       : doc.file_path?.startsWith("room-types/") ? "Foto Kamar"
       : doc.file_path?.startsWith("branding/")   ? "Branding"
       : "Media")
    : "Brosur";
  const badgeCls = bucket === "room-images" ? "bg-indigo-600/80" : "bg-teal-700/80";

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
        <Preview url={url} ext={ext} altText={doc.content} name={doc.name} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          {ext}
        </span>
        <span className={cn("absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white", badgeCls)}>
          {badgeLabel}
        </span>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          {url && (
            <a href={url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs">
                <ExternalLink className="h-3.5 w-3.5" />Buka
              </Button>
            </a>
          )}
          <Button size="sm" variant="destructive" disabled={deleting} className="h-8 gap-1 text-xs" onClick={() => void handleDelete()}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Hapus
          </Button>
        </div>
      </div>

      {/* Rename */}
      <InlineEdit value={doc.name} placeholder="Nama file…" icon={Pencil}
        onSave={async (v) => { await renameFn({ data: { id: doc.id, name: v } }); toast.success("Nama diperbarui"); onChanged(); }} />

      {/* Alt text */}
      {(isImage || isVideo) && (
        <InlineEdit value={doc.content ?? ""} placeholder="Alt text untuk SEO…" icon={Tag}
          onSave={async (v) => { await altFn({ data: { id: doc.id, altText: v } }); toast.success("Alt text diperbarui"); onChanged(); }} />
      )}

      {/* Folder selector */}
      <FolderMoveRow
        docId={doc.id}
        currentFolder={doc.folder}
        folders={folders}
        onMoved={onChanged}
      />

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">{formatDate(doc.created_at)}</span>
        <Button size="sm" variant="outline" disabled={!url} className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl()}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Register dialog — converts a StorageAsset into a DB row             */
/* ------------------------------------------------------------------ */

function RegisterDialog({ asset, open, folders, onClose, onRegistered }: {
  asset: StorageAsset | null;
  open: boolean;
  folders: MediaFolder[];
  onClose: () => void;
  onRegistered: () => void;
}) {
  const createFn = useServerFn(createSopDocument);
  const [name,    setName]    = React.useState("");
  const [altText, setAltText] = React.useState("");
  const [folder,  setFolder]  = React.useState("");
  const [saving,  setSaving]  = React.useState(false);

  React.useEffect(() => {
    if (open && asset) {
      setName(asset.displayName);
      setAltText("");
      setFolder(asset.autoFolder); // pre-select the auto-detected folder
    }
  }, [open, asset]);

  const isImg = asset
    ? IMAGE_EXTS.includes(asset.ext) || VIDEO_EXTS.includes(asset.ext)
    : false;

  const handleSave = async () => {
    if (!asset || !name.trim()) return;
    setSaving(true);
    try {
      await createFn({
        data: {
          name: name.trim(),
          filePath: asset.path,
          fileType: asset.ext,
          content: altText.trim(),
          docCategory: "brosur",
          storageBucket: asset.bucket,
          folder: folder || asset.autoFolder,
        },
      });
      toast.success("Info media disimpan");
      onRegistered();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Tambah Info Media</DialogTitle>
          <DialogDescription>
            Atur nama, folder{isImg ? ", dan alt text" : ""} untuk file ini.
            Setelah disimpan, semua atribut bisa diedit langsung dari kartu.
          </DialogDescription>
        </DialogHeader>

        {asset && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border bg-muted/30">
            <div className="flex h-32 items-center justify-center bg-stone-100">
              <Preview url={asset.url} ext={asset.ext} name={asset.displayName} />
            </div>
            <p className="truncate px-3 py-1.5 text-[11px] text-muted-foreground">{asset.name}</p>
          </div>
        )}

        <div className="grid gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Nama Tampilan <span className="text-destructive">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama yang mudah dibaca"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Folder</label>
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— Tanpa folder —</option>
              {folders.map((f) => (
                <option key={f.id} value={f.name}>{f.name}</option>
              ))}
            </select>
          </div>

          {isImg && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Alt Text (SEO)</label>
              <input
                value={altText}
                onChange={(e) => setAltText(e.target.value)}
                placeholder="Deskripsi gambar untuk mesin pencari…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Contoh: "Kamar Deluxe dengan pemandangan taman"
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</>
              : "Simpan Info"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Storage-only card                                                    */
/* ------------------------------------------------------------------ */

function StorageCard({ asset, onDeleted, onRegister }: {
  asset: StorageAsset;
  onDeleted: () => void;
  onRegister: () => void;
}) {
  const isMedia = IMAGE_EXTS.includes(asset.ext) || VIDEO_EXTS.includes(asset.ext);
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
      onDeleted();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-white transition hover:border-stone-300 hover:shadow-sm">
      {/* Preview */}
      <div className="relative h-36 overflow-hidden bg-stone-100">
        <Preview url={asset.url} ext={asset.ext} name={asset.displayName} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          {asset.ext}
        </span>
        <span className="absolute right-2 top-2 rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          {asset.autoFolder}
        </span>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          <a href={asset.url} target="_blank" rel="noreferrer">
            <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs">
              <ExternalLink className="h-3.5 w-3.5" />Buka
            </Button>
          </a>
          <Button size="sm" variant="destructive" disabled={deleting} className="h-8 gap-1 text-xs" onClick={() => void handleDelete()}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Hapus
          </Button>
        </div>
      </div>

      {/* Filename */}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={asset.displayName}>
          {asset.displayName}
        </span>
      </div>

      {/* Add info button */}
      {isMedia && (
        <button type="button" onClick={onRegister}
          className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left transition hover:bg-teal-50 hover:text-teal-800">
          <Plus className="h-3 w-3 shrink-0 text-teal-600" />
          <span className="text-[11px] font-medium text-teal-700">Tambah nama &amp; alt text</span>
        </button>
      )}

      {/* Folder indicator (read-only for storage cards) */}
      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
        <Folder className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        <span className="text-[11px] italic text-muted-foreground">{asset.autoFolder}</span>
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">
          {asset.createdAt ? formatDate(asset.createdAt) : "—"}
        </span>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl()}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create folder dialog                                                 */
/* ------------------------------------------------------------------ */

function CreateFolderDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const createFn = useServerFn(createMediaFolder);
  const [name,   setName]   = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { if (open) setName(""); }, [open]);

  const handleSave = async () => {
    const t = name.trim();
    if (!t) return;
    setSaving(true);
    try {
      await createFn({ data: { name: t } });
      toast.success(`Folder "${t}" dibuat`);
      onCreated(t);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>Buat Folder Baru</DialogTitle>
          <DialogDescription>Beri nama folder untuk mengelompokkan file media.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
          placeholder="Nama folder, mis. Kamar Deluxe"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Membuat…</> : "Buat Folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Folder sidebar                                                       */
/* ------------------------------------------------------------------ */

type FolderCounts = Map<string, number>;

function FolderSidebar({ folders, counts, activeFolder, onSelect, onFolderCreated, onFolderRenamed, onFolderDeleted }: {
  folders: MediaFolder[];
  counts: FolderCounts;
  activeFolder: string;
  onSelect: (key: string) => void;
  onFolderCreated: (name: string) => void;
  onFolderRenamed: () => void;
  onFolderDeleted: (id: string) => void;
}) {
  const renameFn = useServerFn(renameMediaFolder);
  const deleteFn = useServerFn(deleteMediaFolder);

  const [createOpen,  setCreateOpen]  = React.useState(false);
  const [renamingId,  setRenamingId]  = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");

  const totalCount = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const noneCount  = counts.get(NO_FOLDER) ?? 0;

  const SidebarItem = ({ folderKey, label, icon: Icon, count, className }: {
    folderKey: string; label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number; className?: string;
  }) => (
    <button type="button"
      onClick={() => onSelect(folderKey)}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
        activeFolder === folderKey
          ? "bg-teal-50 font-medium text-teal-800"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        className,
      )}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          activeFolder === folderKey ? "bg-teal-200 text-teal-900" : "bg-muted text-muted-foreground")}>
          {count}
        </span>
      )}
    </button>
  );

  const handleRenameCommit = async (folder: MediaFolder) => {
    const t = renameDraft.trim();
    if (!t || t === folder.name) { setRenamingId(null); return; }
    try {
      await renameFn({ data: { id: folder.id, name: t } });
      toast.success("Folder diubah namanya");
      onFolderRenamed();
    } catch (e) { toast.error((e as Error).message); }
    setRenamingId(null);
  };

  const handleDelete = async (folder: MediaFolder) => {
    const count = counts.get(folder.name) ?? 0;
    const msg = count > 0
      ? `Hapus folder "${folder.name}"? ${count} file akan dikeluarkan dari folder ini (tidak dihapus).`
      : `Hapus folder "${folder.name}"?`;
    if (!confirm(msg)) return;
    try {
      await deleteFn({ data: { id: folder.id } });
      toast.success(`Folder "${folder.name}" dihapus`);
      onFolderDeleted(folder.id);
      if (activeFolder === folder.name) onSelect(ALL_FILES);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-1 pr-2">
      <SidebarItem folderKey={ALL_FILES} label="Semua File" icon={Images} count={totalCount} />
      {noneCount > 0 && (
        <SidebarItem folderKey={NO_FOLDER} label="Tanpa Folder" icon={FolderOpen} count={noneCount} />
      )}

      {folders.length > 0 && (
        <div className="my-1 border-t border-border" />
      )}

      {folders.map((f) => {
        if (renamingId === f.id) {
          return (
            <div key={f.id} className="flex items-center gap-1 rounded-lg border border-input bg-background px-2 py-1">
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input autoFocus value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleRenameCommit(f);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
              <button type="button" onClick={() => void handleRenameCommit(f)}
                className="text-emerald-600 hover:text-emerald-700">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setRenamingId(null)}
                className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }

        const count = counts.get(f.name) ?? 0;
        return (
          <div key={f.id} className="group/folder flex items-center">
            <button type="button"
              onClick={() => onSelect(f.name)}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                activeFolder === f.name
                  ? "bg-teal-50 font-medium text-teal-800"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}>
              <Folder className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {count > 0 && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  activeFolder === f.name ? "bg-teal-200 text-teal-900" : "bg-muted text-muted-foreground")}>
                  {count}
                </span>
              )}
            </button>
            {/* Rename + delete — visible on hover */}
            <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover/folder:opacity-100">
              <button type="button" title="Ubah nama"
                onClick={() => { setRenameDraft(f.name); setRenamingId(f.id); }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" title="Hapus folder"
                onClick={() => void handleDelete(f)}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}

      <div className="my-1 border-t border-border" />

      <button type="button" onClick={() => setCreateOpen(true)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/50 hover:text-foreground">
        <FolderPlus className="h-4 w-4 shrink-0" />
        Buat Folder
      </button>

      <CreateFolderDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => { onFolderCreated(name); onSelect(name); }}
      />
    </aside>
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
        <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${pct}%` }} />
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

  const [filter,        setFilter]        = React.useState<FilterType>("all");
  const [activeFolder,  setActiveFolder]  = React.useState<string>(ALL_FILES);
  const [search,        setSearch]        = React.useState("");
  const [uploaded,      setUploaded]      = React.useState(0);
  const [total,         setTotal]         = React.useState(0);
  const [storageAssets, setStorageAssets] = React.useState<StorageAsset[]>([]);
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [registerAsset, setRegisterAsset] = React.useState<StorageAsset | null>(null);

  /* DB brosur docs */
  const { data, isLoading: dbLoading, refetch } = useQuery({
    queryKey: ["media-library"],
    queryFn:  () => listFn({ data: { category: "brosur" } }),
  });
  const brosurDocs = (data?.documents ?? []) as SopDocument[];

  /* Folders */
  const folderListFn = useServerFn(listMediaFolders);
  const { data: folderData, refetch: refetchFolders } = useQuery({
    queryKey: ["media-folders"],
    queryFn:  () => folderListFn({ data: undefined }),
  });
  const folders = (folderData?.folders ?? []) as MediaFolder[];

  /* Registered paths (to exclude from raw storage listing) */
  const registeredPaths = React.useMemo(() => {
    const s = new Set<string>();
    for (const doc of brosurDocs) {
      if (doc.storage_bucket === "room-images" && doc.file_path) s.add(doc.file_path);
    }
    return s;
  }, [brosurDocs]);

  const loadStorage = React.useCallback(async (regPaths: Set<string>) => {
    setStorageLoading(true);
    setStorageAssets(await loadStorageAssets(regPaths));
    setStorageLoading(false);
  }, []);

  React.useEffect(() => {
    if (!dbLoading) void loadStorage(registeredPaths);
  }, [dbLoading, registeredPaths, loadStorage]);

  const refresh = () => { void refetch(); void refetchFolders(); };

  /* ---- Folder counts ---- */
  const folderCounts = React.useMemo<FolderCounts>(() => {
    const m = new Map<string, number>();
    const inc = (key: string) => m.set(key, (m.get(key) ?? 0) + 1);

    for (const doc of brosurDocs) {
      const key = doc.folder ?? NO_FOLDER;
      inc(key);
    }
    for (const asset of storageAssets) {
      inc(asset.autoFolder);
    }
    return m;
  }, [brosurDocs, storageAssets]);

  /* ---- Filtered lists ---- */
  const applyFilter = (ext: string, name: string): boolean => {
    if (filter !== "all" && extToFilter(ext) !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!name.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const visibleDb = React.useMemo<SopDocument[]>(() => {
    return brosurDocs.filter((doc) => {
      if (!applyFilter((doc.file_type ?? "").toLowerCase(), doc.name)) return false;
      if (activeFolder === ALL_FILES) return true;
      if (activeFolder === NO_FOLDER) return !doc.folder;
      return doc.folder === activeFolder;
    });
  }, [brosurDocs, activeFolder, filter, search]);

  const visibleStorage = React.useMemo<StorageAsset[]>(() => {
    return storageAssets.filter((asset) => {
      if (!applyFilter(asset.ext, asset.displayName)) return false;
      if (activeFolder === ALL_FILES) return true;
      if (activeFolder === NO_FOLDER) return false; // storage cards always have autoFolder
      return asset.autoFolder === activeFolder;
    });
  }, [storageAssets, activeFolder, filter, search]);

  const totalVisible = visibleDb.length + visibleStorage.length;
  const isLoading    = dbLoading || storageLoading;

  /* ---- Upload ---- */
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const valid = files.filter((f) => {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      if (!ALL_ALLOWED.includes(ext)) { toast.error(`Format tidak didukung: ${f.name}`); return false; }
      if (f.size > 50 * 1024 * 1024) { toast.error(`Maks 50 MB: ${f.name}`); return false; }
      return true;
    });
    if (!valid.length) return;
    setTotal(valid.length); setUploaded(0);
    let ok = 0;
    // Determine target folder for uploads
    const uploadFolder = activeFolder === ALL_FILES || activeFolder === NO_FOLDER
      ? "Brosur"
      : activeFolder;
    for (const rawFile of valid) {
      try {
        const file = rawFile.type.startsWith("image/") ? await convertToWebP(rawFile) : rawFile;
        const ext  = (file.name.split(".").pop() ?? "bin").toLowerCase();
        const base = rawFile.name.replace(/\.[^.]+$/, "");
        const path = `brosur/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("sop-documents")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const createFn = (await import("@/admin/modules/ai-lab/sop.functions")).createSopDocument;
        await createFn({
          data: {
            name: base, filePath: path, fileType: ext, content: "",
            docCategory: "brosur", folder: uploadFolder,
          },
        });
        ok++;
        setUploaded((n) => n + 1);
      } catch (err) {
        toast.error(`Gagal upload ${rawFile.name}: ${(err as Error).message}`);
      }
    }
    setTotal(0); setUploaded(0);
    if (ok > 0) { toast.success(`${ok} file diunggah`); refresh(); }
  };

  /* ---- Render ---- */
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-6 py-8">

        {/* Header */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Content</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Media Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Semua gambar dan video — brosur, hero slider, foto kamar, dan branding.
            </p>
          </div>
          <div className="shrink-0">
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void onPick(e)} />
            <Button
              className="gap-2 bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()}
              disabled={total > 0}>
              {total > 0
                ? <><Loader2 className="h-4 w-4 animate-spin" />{`Mengunggah ${uploaded}/${total}…`}</>
                : <><Upload className="h-4 w-4" />Upload Media</>}
            </Button>
          </div>
        </header>

        <UploadBar progress={uploaded} total={total} />

        {/* Body: sidebar + main */}
        <div className="flex gap-6">

          {/* Folder sidebar */}
          <FolderSidebar
            folders={folders}
            counts={folderCounts}
            activeFolder={activeFolder}
            onSelect={setActiveFolder}
            onFolderCreated={(name) => {
              void refetchFolders();
              setActiveFolder(name);
            }}
            onFolderRenamed={() => { void refetch(); void refetchFolders(); }}
            onFolderDeleted={() => { void refetch(); void refetchFolders(); }}
          />

          {/* Main content */}
          <div className="min-w-0 flex-1">

            {/* Toolbar */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {/* Active folder breadcrumb */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Images className="h-4 w-4" />
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">
                  {activeFolder === ALL_FILES ? "Semua File"
                   : activeFolder === NO_FOLDER ? "Tanpa Folder"
                   : activeFolder}
                </span>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* Type filter */}
                <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
                  {FILTER_TABS.map(({ key, label }) => (
                    <button key={key} onClick={() => setFilter(key)}
                      className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                        filter === key ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative min-w-[160px]">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama file…"
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  {search && (
                    <button type="button" onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <span className="text-xs text-muted-foreground">{totalVisible} file</span>
            </div>

            {/* Grid */}
            {isLoading ? (
              <div className="flex items-center justify-center py-24 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />Memuat media…
              </div>
            ) : totalVisible === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border py-24 text-center">
                <Images className="h-14 w-14 text-muted-foreground/30" />
                <p className="text-sm font-medium text-muted-foreground">
                  {search || filter !== "all"
                    ? "Tidak ada file yang cocok."
                    : activeFolder !== ALL_FILES
                    ? `Folder ini masih kosong. Upload atau pindahkan file ke sini.`
                    : "Belum ada media. Klik Upload Media untuk memulai."}
                </p>
                {!search && filter === "all" && (
                  <Button variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4" />Pilih File
                  </Button>
                )}
                {(search || filter !== "all") && (
                  <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilter("all"); }}>
                    Reset filter
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleDb.map((doc) => (
                  <DbCard key={`db:${doc.id}`} doc={doc} folders={folders} onDelete={refresh} onChanged={refresh} />
                ))}
                {visibleStorage.map((asset) => (
                  <StorageCard
                    key={asset.id}
                    asset={asset}
                    onDeleted={() => setStorageAssets((prev) => prev.filter((a) => a.id !== asset.id))}
                    onRegister={() => setRegisterAsset(asset)}
                  />
                ))}
              </div>
            )}

            {totalVisible > 0 && (
              <p className="mt-6 text-center text-xs text-muted-foreground">
                JPG/PNG dikonversi ke WebP saat upload · Klik nama atau ikon tag untuk mengedit · Maks 50 MB per file
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Register dialog */}
      <RegisterDialog
        asset={registerAsset}
        open={!!registerAsset}
        folders={folders}
        onClose={() => setRegisterAsset(null)}
        onRegistered={refresh}
      />
    </div>
  );
}
