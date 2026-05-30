/**
 * Media Library — unified view for ALL media in the system.
 *
 * Layout: nested folder sidebar (left) + file grid (right).
 *
 * Folder system:
 *   • media_folders table stores folders with optional parent_id for nesting.
 *   • sop_documents.folder_id (uuid FK) references media_folders.
 *   • Clicking a parent folder shows files in that folder AND all sub-folders.
 *   • Storage-only assets (room-images bucket) show in the folder matching
 *     their path prefix. They cannot be moved to a sub-folder until registered.
 *
 * Two data sources:
 *   1. sop_documents (doc_category='brosur') — DB-tracked, full editing.
 *   2. room-images bucket paths not yet tracked → "Tambah nama & alt text"
 *      button registers them and assigns them to a folder.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload, Trash2, Loader2, Copy, Check, ExternalLink,
  Tag, Pencil, FileText, Images, Search, X, Plus,
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
  moveMediaFolder,
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
/* Constants & types                                                    */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "ogg"];
const DOC_EXTS   = ["pdf"];
const ALL_ALLOWED = [...IMAGE_EXTS, ...VIDEO_EXTS, ...DOC_EXTS];
const ACCEPT      = ALL_ALLOWED.map((e) => `.${e}`).join(",");

type FilterType = "all" | "image" | "video" | "doc";

/** Sentinel: show all files regardless of folder. */
const ALL_FILES = "__all__";
/** Sentinel: show files with no folder_id assigned. */
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
/* Folder tree helpers                                                  */
/* ------------------------------------------------------------------ */

/** Returns the set of IDs containing folderId and all its descendants. */
function getDescendantIds(folderId: string, folders: MediaFolder[]): Set<string> {
  const result = new Set<string>([folderId]);
  const queue  = [folderId];
  while (queue.length > 0) {
    const parentId = queue.pop()!;
    for (const f of folders) {
      if (f.parent_id === parentId && !result.has(f.id)) {
        result.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Storage listing helpers                                             */
/* ------------------------------------------------------------------ */

/** Maps storage path prefixes to their auto-folder names. */
const ROOM_IMAGE_PREFIXES = [
  { prefix: "media",      folderName: "Hero Slider" },
  { prefix: "room-types", folderName: "Foto Kamar"  },
  { prefix: "branding",   folderName: "Branding"    },
];

type StorageAsset = {
  id: string;
  bucket: string;
  path: string;
  name: string;
  displayName: string;
  ext: string;
  url: string;
  autoFolderName: string;   // matched media_folder name (e.g. "Foto Kamar")
  createdAt: string;
};

function docPublicUrl(doc: SopDocument): string {
  if (!doc.file_path) return "";
  const bucket = doc.storage_bucket || "sop-documents";
  return supabase.storage.from(bucket).getPublicUrl(doc.file_path).data.publicUrl;
}

async function loadStorageAssets(registeredPaths: Set<string>): Promise<StorageAsset[]> {
  const all: StorageAsset[] = [];
  for (const { prefix, folderName } of ROOM_IMAGE_PREFIXES) {
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
        autoFolderName: folderName,
        createdAt: (f as { created_at?: string }).created_at ?? "",
      });
    }
  }
  return all;
}

/* ------------------------------------------------------------------ */
/* Shared UI: Preview                                                   */
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
/* Shared UI: InlineEdit                                               */
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
      className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left transition hover:bg-muted/30">
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
/* FolderMoveRow — folder <select> inside a DbCard                    */
/* ------------------------------------------------------------------ */

/** Build a flat, visually-indented options list from a nested folder tree. */
function buildFolderOptions(folders: MediaFolder[]): { id: string; label: string }[] {
  const roots    = folders.filter((f) => !f.parent_id);
  const result: { id: string; label: string }[] = [];
  const append = (f: MediaFolder, depth: number) => {
    result.push({ id: f.id, label: "    ".repeat(depth) + f.name });
    folders.filter((c) => c.parent_id === f.id).forEach((c) => append(c, depth + 1));
  };
  roots.forEach((r) => append(r, 0));
  return result;
}

function FolderMoveRow({ docId, currentFolderId, folders, onMoved }: {
  docId: string;
  currentFolderId: string | null;
  folders: MediaFolder[];
  onMoved: () => void;
}) {
  const moveFn  = useServerFn(moveDocToFolder);
  const [moving, setMoving] = React.useState(false);
  const options = React.useMemo(() => buildFolderOptions(folders), [folders]);

  const handleChange = async (val: string) => {
    const next = val === "" ? null : val;
    if (next === currentFolderId) return;
    setMoving(true);
    try {
      await moveFn({ data: { id: docId, folderId: next } });
      const name = folders.find((f) => f.id === next)?.name;
      toast.success(name ? `Dipindah ke "${name}"` : "Dihapus dari folder");
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
          value={currentFolderId ?? ""}
          onChange={(e) => void handleChange(e.target.value)}
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-[11px] text-muted-foreground focus:outline-none"
        >
          <option value="">— Tanpa folder —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DbCard — fully editable media card                                  */
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
    ? (doc.file_path?.startsWith("media/")       ? "Hero Slider"
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
      <div className="relative h-36 overflow-hidden bg-stone-100">
        <Preview url={url} ext={ext} altText={doc.content} name={doc.name} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{ext}</span>
        <span className={cn("absolute right-2 top-2 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white", badgeCls)}>{badgeLabel}</span>
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

      <InlineEdit value={doc.name} placeholder="Nama file…" icon={Pencil}
        onSave={async (v) => { await renameFn({ data: { id: doc.id, name: v } }); toast.success("Nama diperbarui"); onChanged(); }} />

      {(isImage || isVideo) && (
        <InlineEdit value={doc.content ?? ""} placeholder="Alt text untuk SEO…" icon={Tag}
          onSave={async (v) => { await altFn({ data: { id: doc.id, altText: v } }); toast.success("Alt text diperbarui"); onChanged(); }} />
      )}

      <FolderMoveRow docId={doc.id} currentFolderId={doc.folder_id} folders={folders} onMoved={onChanged} />

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
/* Register dialog                                                      */
/* ------------------------------------------------------------------ */

function RegisterDialog({ asset, open, folders, defaultFolderId, onClose, onRegistered }: {
  asset: StorageAsset | null;
  open: boolean;
  folders: MediaFolder[];
  defaultFolderId: string;   // pre-selected folder id
  onClose: () => void;
  onRegistered: () => void;
}) {
  const createFn = useServerFn(createSopDocument);
  const [name,     setName]     = React.useState("");
  const [altText,  setAltText]  = React.useState("");
  const [folderId, setFolderId] = React.useState(defaultFolderId);
  const [saving,   setSaving]   = React.useState(false);
  const options = React.useMemo(() => buildFolderOptions(folders), [folders]);

  React.useEffect(() => {
    if (open && asset) {
      setName(asset.displayName);
      setAltText("");
      setFolderId(defaultFolderId);
    }
  }, [open, asset, defaultFolderId]);

  const isMedia = asset
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
          folderId: folderId || null,
        },
      });
      toast.success("Info media disimpan");
      onRegistered();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Tambah Info Media</DialogTitle>
          <DialogDescription>
            Atur nama, folder{isMedia ? ", dan alt text" : ""} untuk file ini.
          </DialogDescription>
        </DialogHeader>

        {asset && (
          <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
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
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Nama yang mudah dibaca"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Folder</label>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">— Tanpa folder —</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          {isMedia && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Alt Text (SEO)</label>
              <input value={altText} onChange={(e) => setAltText(e.target.value)}
                placeholder="Deskripsi gambar untuk mesin pencari…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Contoh: "Kamar Deluxe dengan pemandangan taman"
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Menyimpan…</> : "Simpan Info"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* StorageCard — unregistered storage file                             */
/* ------------------------------------------------------------------ */

function StorageCard({ asset, onDeleted, onRegister }: {
  asset: StorageAsset;
  onDeleted: () => void;
  onRegister: () => void;
}) {
  const isMedia = IMAGE_EXTS.includes(asset.ext) || VIDEO_EXTS.includes(asset.ext);
  const [copied, setCopied]     = React.useState(false);
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
      <div className="relative h-36 overflow-hidden bg-stone-100">
        <Preview url={asset.url} ext={asset.ext} name={asset.displayName} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{asset.ext}</span>
        <span className="absolute right-2 top-2 rounded bg-indigo-600/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">{asset.autoFolderName}</span>
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition group-hover:opacity-100">
          <a href={asset.url} target="_blank" rel="noreferrer">
            <Button size="sm" variant="secondary" className="h-8 gap-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />Buka</Button>
          </a>
          <Button size="sm" variant="destructive" disabled={deleting} className="h-8 gap-1 text-xs" onClick={() => void handleDelete()}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Hapus
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
        <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/40" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{asset.displayName}</span>
      </div>

      {isMedia && (
        <button type="button" onClick={onRegister}
          className="flex w-full items-center gap-1.5 border-t border-border px-3 py-1.5 text-left transition hover:bg-teal-50">
          <Plus className="h-3 w-3 shrink-0 text-teal-600" />
          <span className="text-[11px] font-medium text-teal-700">Tambah nama &amp; alt text</span>
        </button>
      )}

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5">
        <Folder className="h-3 w-3 shrink-0 text-muted-foreground/50" />
        <span className="text-[11px] italic text-muted-foreground">{asset.autoFolderName}</span>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[11px] text-muted-foreground">{asset.createdAt ? formatDate(asset.createdAt) : "—"}</span>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyUrl()}>
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Disalin" : "Salin URL"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / rename folder dialogs                                       */
/* ------------------------------------------------------------------ */

function CreateFolderDialog({ open, parentId, parentName, onClose, onCreated }: {
  open: boolean;
  parentId: string | null;       // null = root folder
  parentName: string | null;     // for display
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
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
      const res = await createFn({ data: { name: t, parentId } });
      toast.success(`Folder "${t}" dibuat`);
      onCreated((res as { id: string }).id, t);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[360px]">
        <DialogHeader>
          <DialogTitle>{parentId ? `Buat Sub Folder` : "Buat Folder Baru"}</DialogTitle>
          <DialogDescription>
            {parentId
              ? `Sub folder di dalam "${parentName}".`
              : "Folder utama untuk mengelompokkan file media."}
          </DialogDescription>
        </DialogHeader>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
          placeholder={parentId ? "Nama kamar, mis. Deluxe" : "Nama folder, mis. Foto Kamar"}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
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
/* Folder sidebar with nested tree                                      */
/* ------------------------------------------------------------------ */

type FolderCounts = Map<string, number>;

function FolderSidebar({ folders, counts, activeFolder, onSelect, onRefresh }: {
  folders: MediaFolder[];
  counts: FolderCounts;
  activeFolder: string;
  onSelect: (key: string) => void;
  onRefresh: () => void;
}) {
  const renameFn = useServerFn(renameMediaFolder);
  const deleteFn = useServerFn(deleteMediaFolder);
  const moveFolderFn = useServerFn(moveMediaFolder);

  const [createParentId,   setCreateParentId]   = React.useState<string | null>(null);
  const [createParentName, setCreateParentName] = React.useState<string | null>(null);
  const [createOpen,       setCreateOpen]       = React.useState(false);

  /* ── Drag & drop folder re-parenting ────────────────────────── */
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = React.useState<string | null>(null);

  /** True if `targetId` is `sourceId` or any descendant — invalid drop target. */
  const isDescendantOrSelf = React.useCallback(
    (sourceId: string, targetId: string): boolean => {
      if (sourceId === targetId) return true;
      const queue = [sourceId];
      const visited = new Set<string>();
      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        for (const f of folders) {
          if (f.parent_id === cur) {
            if (f.id === targetId) return true;
            queue.push(f.id);
          }
        }
      }
      return false;
    },
    [folders],
  );

  const handleMoveFolder = async (sourceId: string, newParentId: string | null) => {
    try {
      await moveFolderFn({ data: { id: sourceId, parentId: newParentId } });
      const movedName = folders.find((f) => f.id === sourceId)?.name ?? "Folder";
      const targetName =
        newParentId === null
          ? "root"
          : folders.find((f) => f.id === newParentId)?.name ?? "folder";
      toast.success(`"${movedName}" dipindahkan ke ${targetName}`);
      onRefresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const [renamingId,       setRenamingId]       = React.useState<string | null>(null);
  const [renameDraft,      setRenameDraft]      = React.useState("");

  const totalCount = counts.get(ALL_FILES) ?? 0;
  const noneCount  = counts.get(NO_FOLDER) ?? 0;

  const rootFolders = folders.filter((f) => !f.parent_id);

  const openCreate = (parentId: string | null, parentName: string | null) => {
    setCreateParentId(parentId);
    setCreateParentName(parentName);
    setCreateOpen(true);
  };

  const handleRenameCommit = async (folder: MediaFolder) => {
    const t = renameDraft.trim();
    if (!t || t === folder.name) { setRenamingId(null); return; }
    try {
      await renameFn({ data: { id: folder.id, name: t } });
      toast.success("Folder diubah namanya");
      onRefresh();
    } catch (e) { toast.error((e as Error).message); }
    setRenamingId(null);
  };

  const handleDelete = async (folder: MediaFolder) => {
    const count    = counts.get(folder.id) ?? 0;
    const children = folders.filter((f) => f.parent_id === folder.id);
    const parts: string[] = [];
    if (children.length > 0) parts.push(`${children.length} sub folder`);
    if (count > 0) parts.push(`${count} file akan dikeluarkan dari folder ini`);
    const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
    if (!confirm(`Hapus folder "${folder.name}"?${detail}`)) return;
    try {
      await deleteFn({ data: { id: folder.id } });
      toast.success(`Folder "${folder.name}" dihapus`);
      if (activeFolder === folder.id || folders.some((f) => f.id === activeFolder && f.parent_id === folder.id)) {
        onSelect(ALL_FILES);
      }
      onRefresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  /** Renders a single folder row (with rename / delete / add-sub-folder buttons). */
  const renderFolderRow = (folder: MediaFolder, indent: number): React.ReactNode => {
    const count = counts.get(folder.id) ?? 0;
    const isActive = activeFolder === folder.id;
    const childFolders = folders.filter((f) => f.parent_id === folder.id);

    if (renamingId === folder.id) {
      return (
        <div key={folder.id} style={{ paddingLeft: `${indent * 16}px` }}
          className="flex items-center gap-1 rounded-lg border border-input bg-background px-2 py-1">
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input autoFocus value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleRenameCommit(folder);
              if (e.key === "Escape") setRenamingId(null);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
          <button type="button" onClick={() => void handleRenameCommit(folder)}
            className="text-emerald-600 hover:text-emerald-700"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setRenamingId(null)}
            className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>
      );
    }

    const isDropTarget = dropTargetId === folder.id;
    const isBeingDragged = draggingId === folder.id;

    return (
      <React.Fragment key={folder.id}>
        <div
          className={cn(
            "group/row flex items-center rounded-lg transition",
            isDropTarget && "bg-teal-100/60 ring-2 ring-teal-400 ring-inset",
            isBeingDragged && "opacity-40",
          )}
          style={{ paddingLeft: `${indent * 12}px` }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-media-folder-id", folder.id);
            setDraggingId(folder.id);
          }}
          onDragEnd={() => {
            setDraggingId(null);
            setDropTargetId(null);
          }}
          onDragOver={(e) => {
            const src = draggingId;
            if (!src || src === folder.id) return;
            if (isDescendantOrSelf(src, folder.id)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dropTargetId !== folder.id) setDropTargetId(folder.id);
          }}
          onDragLeave={(e) => {
            // Only clear if leaving the row entirely
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            if (dropTargetId === folder.id) setDropTargetId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const src = e.dataTransfer.getData("application/x-media-folder-id");
            setDropTargetId(null);
            setDraggingId(null);
            if (!src || src === folder.id) return;
            if (isDescendantOrSelf(src, folder.id)) {
              toast.error("Tidak bisa memindahkan folder ke sub-foldernya sendiri.");
              return;
            }
            void handleMoveFolder(src, folder.id);
          }}
        >
          <button type="button" onClick={() => onSelect(folder.id)}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition cursor-grab active:cursor-grabbing",
              isActive
                ? "bg-teal-50 font-medium text-teal-800"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}>
            {indent > 0
              ? <Folder className="h-3.5 w-3.5 shrink-0" />
              : <FolderOpen className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {count > 0 && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                isActive ? "bg-teal-200 text-teal-900" : "bg-muted text-muted-foreground")}>
                {count}
              </span>
            )}
          </button>
          {/* Hover actions */}
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
            <button type="button" title="Buat sub folder" onClick={() => openCreate(folder.id, folder.name)}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-teal-700">
              <FolderPlus className="h-3 w-3" />
            </button>
            <button type="button" title="Ubah nama" onClick={() => { setRenameDraft(folder.name); setRenamingId(folder.id); }}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Pencil className="h-3 w-3" />
            </button>
            <button type="button" title="Hapus folder" onClick={() => void handleDelete(folder)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
        {/* Sub-folders rendered recursively */}
        {childFolders.map((child) => renderFolderRow(child, indent + 1))}
      </React.Fragment>
    );
  };

  const ROOT_DROP_ID = "__root__";
  const isRootDrop = dropTargetId === ROOT_DROP_ID;

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-0.5">
      {/* Static entries — also a drop target to move a folder to root */}
      <button
        type="button"
        onClick={() => onSelect(ALL_FILES)}
        onDragOver={(e) => {
          if (!draggingId) return;
          // Only show root indicator if the dragged folder isn't already root
          const dragged = folders.find((f) => f.id === draggingId);
          if (!dragged || dragged.parent_id === null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTargetId !== ROOT_DROP_ID) setDropTargetId(ROOT_DROP_ID);
        }}
        onDragLeave={() => {
          if (dropTargetId === ROOT_DROP_ID) setDropTargetId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const src = e.dataTransfer.getData("application/x-media-folder-id");
          setDropTargetId(null);
          setDraggingId(null);
          if (!src) return;
          const dragged = folders.find((f) => f.id === src);
          if (!dragged || dragged.parent_id === null) return;
          void handleMoveFolder(src, null);
        }}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
          activeFolder === ALL_FILES
            ? "bg-teal-50 font-medium text-teal-800"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          isRootDrop && "bg-teal-100/60 ring-2 ring-teal-400 ring-inset",
        )}>
        <Images className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          {isRootDrop ? "Lepas di sini → root" : "Semua File"}
        </span>
        {!isRootDrop && totalCount > 0 && (
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            activeFolder === ALL_FILES ? "bg-teal-200 text-teal-900" : "bg-muted text-muted-foreground")}>
            {totalCount}
          </span>
        )}
      </button>

      {folders.length > 0 && <div className="my-1 border-t border-border" />}

      {/* Nested folder tree */}
      {rootFolders.map((f) => renderFolderRow(f, 0))}

      {/* Tanpa Folder (only shown when there are unassigned files) */}
      {noneCount > 0 && (
        <>
          <div className="my-1 border-t border-border" />
          <button type="button" onClick={() => onSelect(NO_FOLDER)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
              activeFolder === NO_FOLDER
                ? "bg-teal-50 font-medium text-teal-800"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}>
            <Folder className="h-4 w-4 shrink-0 opacity-40" />
            <span className="flex-1">Tanpa Folder</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{noneCount}</span>
          </button>
        </>
      )}

      <div className="my-1 border-t border-border" />

      {/* Create root folder */}
      <button type="button" onClick={() => openCreate(null, null)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/50 hover:text-foreground">
        <FolderPlus className="h-4 w-4 shrink-0" />
        Buat Folder
      </button>

      <CreateFolderDialog
        open={createOpen}
        parentId={createParentId}
        parentName={createParentName}
        onClose={() => setCreateOpen(false)}
        onCreated={(id, _name) => { onRefresh(); onSelect(id); }}
      />
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Upload progress                                                      */
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
/* MediaLibraryView                                                     */
/* ------------------------------------------------------------------ */

export function MediaLibraryView() {
  const listFn  = useServerFn(listSopDocuments);
  const createDocFn = useServerFn(createSopDocument);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [filter,        setFilter]        = React.useState<FilterType>("all");
  const [activeFolder,  setActiveFolder]  = React.useState<string>(ALL_FILES);
  const [search,        setSearch]        = React.useState("");
  const [uploaded,      setUploaded]      = React.useState(0);
  const [total,         setTotal]         = React.useState(0);
  const [storageAssets, setStorageAssets] = React.useState<StorageAsset[]>([]);
  const [storageLoading, setStorageLoading] = React.useState(true);
  const [registerAsset,  setRegisterAsset]  = React.useState<StorageAsset | null>(null);

  /* DB brosur docs */
  const { data, isLoading: dbLoading, refetch } = useQuery({
    queryKey: ["media-library"],
    queryFn:  () => listFn({ data: { category: "brosur" } }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  // Exclude WhatsApp brochures (dedicated `brosur` bucket) — those are managed
  // in the Brosur tab under Knowledge & SOP, not the Media Library.
  const brosurDocs = ((data?.documents ?? []) as SopDocument[]).filter(
    (d) => (d.storage_bucket ?? "").toLowerCase() !== "brosur",
  );

  /* Folders */
  const folderListFn = useServerFn(listMediaFolders);
  const { data: folderData, refetch: refetchFolders } = useQuery({
    queryKey: ["media-folders"],
    queryFn:  () => folderListFn({ data: undefined }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const folders = (folderData?.folders ?? []) as MediaFolder[];

  /* Registered paths (exclude from raw storage listing) */
  const registeredPaths = React.useMemo(() => {
    const s = new Set<string>();
    for (const doc of brosurDocs) {
      if (doc.storage_bucket === "room-images" && doc.file_path) s.add(doc.file_path);
    }
    return s;
  }, [brosurDocs]);

  // Track whether storage has been loaded at least once
  const storageLoadedRef = React.useRef(false);

  const loadStorage = React.useCallback(async (regPaths: Set<string>, showSpinner = false) => {
    if (showSpinner) setStorageLoading(true);
    const assets = await loadStorageAssets(regPaths);
    setStorageAssets(assets);
    storageLoadedRef.current = true;
    setStorageLoading(false);
  }, []);

  React.useEffect(() => {
    if (!dbLoading) {
      // Only show the spinner on the very first load
      void loadStorage(registeredPaths, !storageLoadedRef.current);
    }
  }, [dbLoading, registeredPaths, loadStorage]);

  const refresh = () => { void refetch(); void refetchFolders(); };

  /* ---- Folder counts (inclusive of sub-folders) ---- */
  const folderCounts = React.useMemo<FolderCounts>(() => {
    const m = new Map<string, number>();
    let allCount = 0;
    let noneCount = 0;

    // Bubble a count up to folderId and all its ancestors
    const bubbleUp = (folderId: string) => {
      let id: string | null = folderId;
      while (id) {
        m.set(id, (m.get(id) ?? 0) + 1);
        const parent = folders.find((f) => f.id === id);
        id = parent?.parent_id ?? null;
      }
    };

    for (const doc of brosurDocs) {
      allCount++;
      if (!doc.folder_id) { noneCount++; }
      else { bubbleUp(doc.folder_id); }
    }

    for (const asset of storageAssets) {
      allCount++;
      const matched = folders.find((f) => f.name === asset.autoFolderName && !f.parent_id);
      if (matched) bubbleUp(matched.id);
    }

    m.set(ALL_FILES, allCount);
    m.set(NO_FOLDER, noneCount);
    return m;
  }, [folders, brosurDocs, storageAssets]);

  /* ---- Active folder descendant IDs (for filtering) ---- */
  const activeFolderDescendants = React.useMemo<Set<string> | null>(() => {
    if (activeFolder === ALL_FILES || activeFolder === NO_FOLDER) return null;
    return getDescendantIds(activeFolder, folders);
  }, [activeFolder, folders]);

  /* ---- Filtering helpers ---- */
  const passesTypeAndSearch = (ext: string, name: string) => {
    if (filter !== "all" && extToFilter(ext) !== filter) return false;
    if (search.trim() && !name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  };

  const dbMatchesFolder = (doc: SopDocument) => {
    if (activeFolder === ALL_FILES) return true;
    if (activeFolder === NO_FOLDER) return !doc.folder_id;
    if (!doc.folder_id) return false;
    return activeFolderDescendants?.has(doc.folder_id) ?? false;
  };

  const storageMatchesFolder = (asset: StorageAsset) => {
    if (activeFolder === ALL_FILES) return true;
    if (activeFolder === NO_FOLDER) return false;
    // Storage assets live at the root-level auto-folder (e.g. "Foto Kamar").
    // They appear when that folder or a parent of it is active.
    const matchedFolder = folders.find((f) => f.name === asset.autoFolderName && !f.parent_id);
    if (!matchedFolder) return false;
    return activeFolder === matchedFolder.id;
  };

  const visibleDb = React.useMemo<SopDocument[]>(() =>
    brosurDocs.filter((doc) =>
      dbMatchesFolder(doc) &&
      passesTypeAndSearch((doc.file_type ?? "").toLowerCase(), doc.name),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brosurDocs, activeFolder, activeFolderDescendants, filter, search],
  );

  const visibleStorage = React.useMemo<StorageAsset[]>(() =>
    storageAssets.filter((asset) =>
      storageMatchesFolder(asset) &&
      passesTypeAndSearch(asset.ext, asset.displayName),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageAssets, activeFolder, folders, filter, search],
  );

  const totalVisible = visibleDb.length + visibleStorage.length;
  const isLoading    = dbLoading || storageLoading;

  /* ---- Active folder info for breadcrumb and defaults ---- */
  const activeFolderObj = React.useMemo(
    () => folders.find((f) => f.id === activeFolder) ?? null,
    [folders, activeFolder],
  );

  /* ---- Default folder id for new uploads / register ---- */
  const defaultUploadFolderId = React.useMemo(() => {
    if (activeFolder === ALL_FILES || activeFolder === NO_FOLDER) {
      // Use "Brosur" folder if it exists
      return folders.find((f) => f.name === "Brosur" && !f.parent_id)?.id ?? "";
    }
    return activeFolder;
  }, [activeFolder, folders]);

  /* ---- Default folder id for RegisterDialog ---- */
  const registerDefaultFolderId = React.useMemo(() => {
    if (!registerAsset) return defaultUploadFolderId;
    // Pre-select the folder matching the asset's autoFolderName
    const matched = folders.find((f) => f.name === registerAsset.autoFolderName && !f.parent_id);
    return matched?.id ?? defaultUploadFolderId;
  }, [registerAsset, folders, defaultUploadFolderId]);

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
    for (const rawFile of valid) {
      try {
        const file = rawFile.type.startsWith("image/") ? await convertToWebP(rawFile) : rawFile;
        const ext  = (file.name.split(".").pop() ?? "bin").toLowerCase();
        const base = rawFile.name.replace(/\.[^.]+$/, "");

        const folder = folders.find((f) => f.id === defaultUploadFolderId);
        let prefix = "brosur";
        if (folder) {
          let curr: MediaFolder | undefined = folder;
          let matched = false;
          while (curr) {
            const auto = ROOM_IMAGE_PREFIXES.find((p) => p.folderName === curr!.name);
            if (auto) { prefix = auto.prefix; matched = true; break; }
            curr = folders.find(f => f.id === curr!.parent_id);
          }
          if (!matched) {
            prefix = folder.name.toLowerCase().replace(/[^a-z0-9]/g, "-") || "brosur";
          }
        }

        const path = `${prefix}/${base.replace(/[^a-zA-Z0-9_-]/g, "")}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
        const targetBucket = "room-images";

        const { error: upErr } = await supabase.storage.from(targetBucket).upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        await createDocFn({
          data: {
            name: base, filePath: path, fileType: ext, content: "",
            docCategory: "brosur",
            storageBucket: targetBucket,
            folderId: defaultUploadFolderId || null,
          },
        });
        ok++;
        setUploaded((n) => n + 1);
      } catch (err) {
        toast.error(`Gagal upload ${rawFile.name}: ${(err as Error).message}`);
      }
    }
    setTotal(0); setUploaded(0);
    if (ok > 0) {
      toast.success(`${ok} file diunggah`);
      refresh();
      void loadStorage(registeredPaths, false);
    }
  };

  /* ---- Breadcrumb label ---- */
  const breadcrumbLabel = (() => {
    if (activeFolder === ALL_FILES) return "Semua File";
    if (activeFolder === NO_FOLDER) return "Tanpa Folder";
    if (!activeFolderObj) return "—";
    // Build path: parent / child
    const parent = activeFolderObj.parent_id
      ? folders.find((f) => f.id === activeFolderObj.parent_id)
      : null;
    return parent ? `${parent.name} / ${activeFolderObj.name}` : activeFolderObj.name;
  })();

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
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={(e) => void onPick(e)} />
            <Button className="gap-2 bg-teal-700 text-white hover:bg-teal-800"
              onClick={() => fileRef.current?.click()} disabled={total > 0}>
              {total > 0
                ? <><Loader2 className="h-4 w-4 animate-spin" />{`Mengunggah ${uploaded}/${total}…`}</>
                : <><Upload className="h-4 w-4" />Upload Media</>}
            </Button>
          </div>
        </header>

        <UploadBar progress={uploaded} total={total} />

        <div className="flex gap-6">
          {/* Folder sidebar */}
          <FolderSidebar
            folders={folders}
            counts={folderCounts}
            activeFolder={activeFolder}
            onSelect={setActiveFolder}
            onRefresh={refresh}
          />

          {/* Main content */}
          <div className="min-w-0 flex-1">
            {/* Toolbar */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Images className="h-4 w-4 shrink-0" />
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground">{breadcrumbLabel}</span>
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
                    ? "Folder ini kosong. Upload atau pindahkan file ke sini."
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
                  <StorageCard key={asset.id} asset={asset}
                    onDeleted={() => setStorageAssets((p) => p.filter((a) => a.id !== asset.id))}
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
        defaultFolderId={registerDefaultFolderId}
        onClose={() => setRegisterAsset(null)}
        onRegistered={refresh}
      />
    </div>
  );
}
