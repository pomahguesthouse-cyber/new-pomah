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
import { Loader2, Upload } from "lucide-react";
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
  const [heroImageUrl, setHeroImageUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `room-types/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("room-images")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) throw error;
      setHeroImageUrl(supabase.storage.from("room-images").getPublicUrl(path).data.publicUrl);
      toast.success("Foto terupload");
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
      setHeroImageUrl(roomType.hero_image_url ?? "");
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
      setHeroImageUrl("");
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
        hero_image_url: heroImageUrl.trim() || null,
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
            <Label className="text-xs">Foto utama</Label>
            <div className="flex items-start gap-3">
              <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-input bg-muted">
                {heroImageUrl ? (
                  <img src={heroImageUrl} alt="Foto kamar" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">Belum ada</span>
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <Input
                  value={heroImageUrl}
                  placeholder="https://… atau upload"
                  className="font-mono"
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadPhoto(f);
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {uploading ? "Mengupload…" : "Upload foto"}
                  </Button>
                  {heroImageUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-destructive hover:text-destructive"
                      disabled={uploading}
                      onClick={() => setHeroImageUrl("")}
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              </div>
            </div>
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
