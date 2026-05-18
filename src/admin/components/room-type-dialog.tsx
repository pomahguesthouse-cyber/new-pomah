/**
 * Create / edit dialog for a room type.
 *
 * Room types carry the shared, type-level details of a room category
 * (name, bed, capacity, base rate, amenities). Individual rooms are
 * managed separately on the same page.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Upload, Trash2, Star } from "lucide-react";
import { createRoomType, updateRoomType } from "@/admin/functions/bookings.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A room type as managed in this dialog. */
export type ManagedRoomType = {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  bed_type?: string | null;
  size_sqm?: number | null;
  capacity?: number | null;
  base_rate?: number | null;
  amenities?: string[] | null;
  hero_image_url?: string | null;
  images?: string[] | null;
};

const BED_TYPES = ["Single", "Double", "Queen", "King", "Twin", "Bunk"];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Props = {
  mode: "create" | "edit";
  open: boolean;
  roomType?: ManagedRoomType | null;
  onClose: () => void;
  onSaved: () => void;
};

export function RoomTypeDialog({ mode, open, roomType, onClose, onSaved }: Props) {
  const fnCreate = useServerFn(createRoomType);
  const fnUpdate = useServerFn(updateRoomType);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [bedType, setBedType] = React.useState("");
  const [capacity, setCapacity] = React.useState(2);
  const [baseRate, setBaseRate] = React.useState(0);
  const [sizeSqm, setSizeSqm] = React.useState<number | "">("");
  const [description, setDescription] = React.useState("");
  const [amenities, setAmenities] = React.useState("");
  const [images, setImages] = React.useState<string[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function uploadPhotos(files: FileList) {
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const ext = file.name.split(".").pop() ?? "jpg";
        const path = `room-types/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await supabase.storage
          .from("room-images")
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (error) throw error;
        urls.push(supabase.storage.from("room-images").getPublicUrl(path).data.publicUrl);
      }
      if (urls.length) {
        setImages((cur) => [...cur, ...urls]);
        toast.success(`${urls.length} foto terupload`);
      }
    } catch (e) {
      toast.error(`Upload gagal: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Initialise the form when the dialog opens or the edited room
  // changes. Depending on `roomType.id` (not the object) prevents
  // background refetches — which produce a new object reference — from
  // re-running this effect and wiping what the user is typing.
  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && roomType) {
      setName(roomType.name ?? "");
      setSlug(roomType.slug ?? "");
      setSlugTouched(true);
      setBedType(roomType.bed_type ?? "");
      setCapacity(roomType.capacity ?? 2);
      setBaseRate(Number(roomType.base_rate ?? 0));
      setSizeSqm(roomType.size_sqm ?? "");
      setDescription(roomType.description ?? "");
      setAmenities((roomType.amenities ?? []).join(", "));
      setImages(
        roomType.images?.length
          ? roomType.images
          : roomType.hero_image_url
            ? [roomType.hero_image_url]
            : [],
      );
    } else {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setBedType("");
      setCapacity(2);
      setBaseRate(0);
      setSizeSqm("");
      setDescription("");
      setAmenities("");
      setImages([]);
    }
  }, [open, mode, roomType?.id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        description: description.trim() || null,
        bed_type: bedType.trim() || null,
        size_sqm: sizeSqm === "" ? null : Number(sizeSqm),
        capacity: Number(capacity) || 1,
        base_rate: Number(baseRate) || 0,
        amenities: amenities
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        images,
      };
      if (mode === "edit" && roomType) {
        await fnUpdate({ data: { id: roomType.id, ...payload } });
      } else {
        await fnCreate({ data: payload });
      }
    },
    onSuccess: () => {
      toast.success(mode === "edit" ? "Tipe kamar diperbarui" : "Tipe kamar ditambahkan");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSave = name.trim().length > 0 && !saveMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit tipe kamar" : "Tambah tipe kamar"}</DialogTitle>
          <DialogDescription>
            Detail ini berlaku untuk semua kamar dengan tipe yang sama.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Nama tipe</Label>
            <Input
              autoFocus
              value={name}
              placeholder="Garden Room"
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Slug</Label>
            <Input
              value={slug}
              placeholder="garden-room"
              className="font-mono"
              onChange={(e) => {
                setSlug(slugify(e.target.value));
                setSlugTouched(true);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Dipakai di URL kamar publik. Huruf kecil, angka, dan tanda hubung.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Tipe kasur</Label>
              <select
                value={bedType}
                onChange={(e) => setBedType(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">—</option>
                {BED_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Kapasitas</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Luas (m²)</Label>
              <Input
                type="number"
                min={0}
                value={sizeSqm}
                onChange={(e) => setSizeSqm(e.target.value === "" ? "" : Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Tarif dasar (per malam, Rp)</Label>
            <Input
              type="number"
              min={0}
              step={1000}
              value={baseRate}
              onChange={(e) => setBaseRate(Number(e.target.value))}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Deskripsi</Label>
            <Textarea
              rows={3}
              value={description}
              placeholder="Kamar tenang menghadap taman, dengan kamar mandi dalam."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Fasilitas</Label>
            <Input
              value={amenities}
              placeholder="WiFi, AC, Sarapan, TV"
              onChange={(e) => setAmenities(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Pisahkan dengan koma.</p>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-xs">Foto kamar</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void uploadPhotos(e.target.files);
              }}
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) void uploadPhotos(e.dataTransfer.files);
              }}
              onClick={() => !uploading && fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input bg-muted/40 py-6 text-center transition hover:border-primary"
            >
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="h-5 w-5 text-muted-foreground" />
              )}
              <p className="text-xs font-medium">
                {uploading ? "Mengupload…" : "Tarik foto ke sini atau klik untuk pilih"}
              </p>
              <p className="text-[10px] text-muted-foreground">JPG, PNG, WEBP — bisa banyak</p>
            </div>

            {images.length > 0 && (
              <>
                <p className="text-[10px] text-muted-foreground">
                  Foto pertama menjadi cover. {images.length} foto.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {images.map((url, i) => (
                    <div
                      key={url}
                      className="group relative overflow-hidden rounded-md border border-input"
                    >
                      <img src={url} alt="" className="aspect-video w-full object-cover" />
                      {i === 0 && (
                        <span className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
                          Cover
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-black/55 p-1 opacity-0 transition group-hover:opacity-100">
                        {i !== 0 && (
                          <button
                            type="button"
                            title="Jadikan cover"
                            className="mr-auto flex items-center gap-0.5 text-[9px] font-medium text-white"
                            onClick={() => setImages([url, ...images.filter((x) => x !== url)])}
                          >
                            <Star className="h-3 w-3" />
                            Cover
                          </button>
                        )}
                        <button
                          type="button"
                          title="Hapus foto"
                          className="text-white hover:text-red-300"
                          onClick={() => setImages(images.filter((x) => x !== url))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={!canSave} onClick={() => saveMut.mutate()}>
            {saveMut.isPending
              ? "Menyimpan…"
              : mode === "edit"
                ? "Simpan perubahan"
                : "Tambah tipe kamar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
