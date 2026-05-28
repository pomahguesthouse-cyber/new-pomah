/**
 * MediaPicker — reusable dialog for selecting a media URL from the
 * unified Media Library. Shows files from both the `sop-documents`
 * bucket (brosur/custom uploads) and the `room-images` bucket
 * (hero slider, room photos).
 *
 * Usage:
 *   <MediaPicker
 *     open={open}
 *     kind="image"          // "image" | "video" | "any"
 *     onPick={(url) => ...} // called when the user clicks a file
 *     onClose={() => ...}
 *   />
 */
import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Search, X, Film, FileText, Images } from "lucide-react";

import { listSopDocuments } from "@/admin/modules/ai-lab/sop.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type MediaKind = "image" | "video" | "any";

export type MediaAsset = {
  id: string;         // unique key
  name: string;       // display name
  url: string;        // public URL
  ext: string;        // lowercase extension
  isImage: boolean;
  isVideo: boolean;
  source: "brosur" | "room-images";
  category: string;   // "brosur" | "hero" | "room" | "branding"
};

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "ogg"];

function extOf(name: string) {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Storage bucket helpers                                               */
/* ------------------------------------------------------------------ */

const ROOM_IMAGES_PREFIXES = [
  { prefix: "media",       category: "hero"    },
  { prefix: "room-types",  category: "room"    },
  { prefix: "branding",    category: "branding"},
];

async function listRoomImagesBucket(): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  for (const { prefix, category } of ROOM_IMAGES_PREFIXES) {
    const { data, error } = await supabase.storage
      .from("room-images")
      .list(prefix, { limit: 500, sortBy: { column: "created_at", order: "desc" } });
    if (error) { console.warn("[MediaPicker] Storage list error:", error.message); continue; }
    for (const f of data ?? []) {
      if (!f.name || f.name.startsWith(".")) continue;
      const url = supabase.storage.from("room-images").getPublicUrl(`${prefix}/${f.name}`).data.publicUrl;
      const ext = extOf(f.name);
      assets.push({
        id: `room-images:${prefix}/${f.name}`,
        name: f.name,
        url,
        ext,
        isImage: IMAGE_EXTS.includes(ext),
        isVideo: VIDEO_EXTS.includes(ext),
        source: "room-images",
        category,
      });
    }
  }
  return assets;
}

/* ------------------------------------------------------------------ */
/* Category label                                                       */
/* ------------------------------------------------------------------ */

const CATEGORY_LABELS: Record<string, string> = {
  brosur:   "Brosur",
  hero:     "Hero Slider",
  room:     "Foto Kamar",
  branding: "Branding",
};

/* ------------------------------------------------------------------ */
/* Mini thumb                                                           */
/* ------------------------------------------------------------------ */

function Thumb({ asset, selected, onClick }: { asset: MediaAsset; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border transition",
        selected
          ? "border-teal-500 ring-2 ring-teal-400"
          : "border-border hover:border-stone-400",
      )}
    >
      {/* Preview */}
      <div className="flex aspect-video items-center justify-center bg-stone-100 overflow-hidden">
        {asset.isImage ? (
          <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
        ) : asset.isVideo ? (
          <video src={asset.url} muted className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-8 w-8 text-stone-300" />
        )}
      </div>
      {/* Label */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {asset.isVideo && <Film className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="flex-1 truncate text-[10px] text-muted-foreground">{asset.name}</span>
      </div>
      {/* Category badge */}
      <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
        {CATEGORY_LABELS[asset.category] ?? asset.category}
      </span>
      {/* Selected check */}
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-white">
          ✓
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* MediaPicker dialog                                                   */
/* ------------------------------------------------------------------ */

export function MediaPicker({
  open,
  kind = "any",
  onPick,
  onClose,
}: {
  open: boolean;
  kind?: MediaKind;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const listFn = useServerFn(listSopDocuments);

  const [assets,   setAssets]   = React.useState<MediaAsset[]>([]);
  const [loading,  setLoading]  = React.useState(false);
  const [search,   setSearch]   = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);

  // Load all media when dialog opens
  React.useEffect(() => {
    if (!open) { setSelected(null); setSearch(""); return; }
    setLoading(true);
    Promise.all([
      // Brosur from sop_documents
      listFn({ data: { category: "brosur" } }).then((res) =>
        (res.documents ?? []).map((doc) => {
          const ext = (doc.file_type ?? "").toLowerCase();
          const bucket = doc.storage_bucket || "sop-documents";
          const url = doc.file_path
            ? supabase.storage.from(bucket).getPublicUrl(doc.file_path).data.publicUrl
            : "";
          return {
            id: `brosur:${doc.id}`,
            name: doc.name,
            url,
            ext,
            isImage: IMAGE_EXTS.includes(ext),
            isVideo: VIDEO_EXTS.includes(ext),
            source: "brosur" as const,
            category: "brosur",
          } satisfies MediaAsset;
        }),
      ),
      // room-images bucket
      listRoomImagesBucket(),
    ])
      .then(([brosur, roomImages]) => setAssets([...brosur, ...roomImages]))
      .catch((e) => toast.error(`Gagal memuat media: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, [open]);

  // Filter by kind and search
  const visible = React.useMemo(() => {
    let list = assets;
    if (kind === "image") list = list.filter((a) => a.isImage);
    if (kind === "video") list = list.filter((a) => a.isVideo);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q));
    }
    return list;
  }, [assets, kind, search]);

  const confirm = () => {
    const asset = assets.find((a) => a.id === selected);
    if (!asset) return;
    onPick(asset.url);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4">
          <DialogTitle>Pilih dari Media Library</DialogTitle>
          <DialogDescription>
            {kind === "image" && "Pilih gambar dari library."}
            {kind === "video" && "Pilih video dari library."}
            {kind === "any"   && "Pilih gambar atau video dari library."}
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="shrink-0 border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama file…"
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Memuat media…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-20 text-center text-muted-foreground">
              <Images className="h-10 w-10 opacity-30" />
              <p className="text-sm">
                {search ? "Tidak ada file yang cocok." : "Belum ada media. Upload dulu di halaman Media Library."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {visible.map((asset) => (
                <Thumb
                  key={asset.id}
                  asset={asset}
                  selected={selected === asset.id}
                  onClick={() => setSelected(asset.id === selected ? null : asset.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {visible.length} file tersedia
            {selected ? " · 1 dipilih" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Batal</Button>
            <Button disabled={!selected} onClick={confirm}>
              Pilih
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
