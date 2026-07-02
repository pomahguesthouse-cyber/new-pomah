/**
 * Create / edit dialog for a room type.
 *
 * Room types carry the shared, type-level details of a room category
 * (name, bed, capacity, base rate, amenities). Individual rooms are
 * managed separately on the same page.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { convertToWebP } from "@/lib/image-webp";
import { MediaPicker } from "@/admin/components/media-picker";
import {
  Loader2,
  Upload,
  Trash2,
  Star,
  X,
  FileText,
  Banknote,
  ListChecks,
  Image as ImageIcon,
} from "lucide-react";
import {
  createRoomType,
  updateRoomType,
  listRoomNumbers,
  setRoomNumbers as setRoomNumbersFn,
} from "@/admin/functions/bookings.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type RoomTab = "general" | "pricing" | "features" | "media";
const TABS: { key: RoomTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "general", label: "General", icon: FileText },
  { key: "pricing", label: "Pricing", icon: Banknote },
  { key: "features", label: "Features", icon: ListChecks },
  { key: "media", label: "Media", icon: ImageIcon },
];

/** A room type as managed in this dialog. */
export type ManagedRoomType = {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  bed_type?: string | null;
  bed_size?: string | null;
  floor_info?: string | null;
  size_sqm?: number | null;
  capacity?: number | null;
  extrabed_capacity?: number | null;
  extrabed_rate?: number | null;
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
  const fnListNumbers = useServerFn(listRoomNumbers);
  const fnSetNumbers = useServerFn(setRoomNumbersFn);

  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [bedType, setBedType] = React.useState("");
  const [bedSize, setBedSize] = React.useState("");
  const [floorInfo, setFloorInfo] = React.useState("");
  const [capacity, setCapacity] = React.useState(2);
  const [extrabedCapacity, setExtrabedCapacity] = React.useState(0);
  const [extrabedRate, setExtrabedRate] = React.useState(0);
  const [baseRate, setBaseRate] = React.useState(0);
  const [sizeSqm, setSizeSqm] = React.useState<number | "">("");
  const [description, setDescription] = React.useState("");
  const [amenities, setAmenities] = React.useState("");
  const [images, setImages] = React.useState<string[]>([]);
  const [roomNumbers, setRoomNumbers] = React.useState<string[]>([]);
  const [roomNumberInput, setRoomNumberInput] = React.useState("");
  const [tab, setTab] = React.useState<RoomTab>("general");

  // Existing room numbers for the edited type.
  const { data: numbersData } = useQuery({
    queryKey: ["room-numbers", roomType?.id],
    queryFn: () => fnListNumbers({ data: { room_type_id: roomType!.id } }),
    enabled: open && mode === "edit" && !!roomType?.id,
  });
  React.useEffect(() => {
    if (numbersData?.numbers) setRoomNumbers(numbersData.numbers);
  }, [numbersData]);

  const addRoomNumber = () => {
    const n = roomNumberInput.trim();
    if (!n) return;
    if (!roomNumbers.includes(n)) setRoomNumbers([...roomNumbers, n]);
    setRoomNumberInput("");
  };
  const [uploading,        setUploading]        = React.useState(false);
  const [mediaPickerOpen,  setMediaPickerOpen]  = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function uploadPhotos(files: FileList) {
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const rawFile of Array.from(files)) {
        if (!rawFile.type.startsWith("image/")) continue;
        // Convert to WebP for smaller size and better SEO performance
        const file = await convertToWebP(rawFile);
        const ext = (file.name.split(".").pop() ?? "webp").toLowerCase();
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
    setTab("general");
    if (mode === "edit" && roomType) {
      setName(roomType.name ?? "");
      setSlug(roomType.slug ?? "");
      setSlugTouched(true);
      setBedType(roomType.bed_type ?? "");
      setBedSize(roomType.bed_size ?? "");
      setFloorInfo(roomType.floor_info ?? "");
      setCapacity(roomType.capacity ?? 2);
      setExtrabedCapacity(roomType.extrabed_capacity ?? 0);
      setExtrabedRate(Number(roomType.extrabed_rate ?? 0));
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
      setRoomNumberInput("");
      // roomNumbers is filled by the listRoomNumbers query.
    } else {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setBedType("");
      setBedSize("");
      setFloorInfo("");
      setCapacity(2);
      setExtrabedCapacity(0);
      setExtrabedRate(0);
      setBaseRate(0);
      setSizeSqm("");
      setDescription("");
      setAmenities("");
      setImages([]);
      setRoomNumbers([]);
      setRoomNumberInput("");
    }
  }, [open, mode, roomType?.id]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        description: description.trim() || null,
        bed_type: bedType.trim() || null,
        bed_size: bedSize.trim() || null,
        floor_info: floorInfo.trim() || null,
        size_sqm: sizeSqm === "" ? null : Number(sizeSqm),
        capacity: Number(capacity) || 1,
        extrabed_capacity: Number(extrabedCapacity) || 0,
        extrabed_rate: Number(extrabedRate) || 0,
        base_rate: Number(baseRate) || 0,
        amenities: amenities
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        images,
      };
      let typeId: string | undefined = roomType?.id;
      if (mode === "edit" && roomType) {
        await fnUpdate({ data: { id: roomType.id, ...payload } });
      } else {
        const res = await fnCreate({ data: payload });
        typeId = res?.id;
      }
      if (typeId) {
        await fnSetNumbers({ data: { room_type_id: typeId, numbers: roomNumbers } });
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
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 text-left">
          <DialogTitle>{mode === "edit" ? "Edit tipe kamar" : "Tambah tipe kamar"}</DialogTitle>
          <DialogDescription>
            Detail ini berlaku untuk semua kamar dengan tipe yang sama.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-muted/40 px-4 py-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition",
                tab === t.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "general" && (
            <div className="grid gap-4">
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

              <div className="grid gap-1.5">
                <Label className="text-xs">Deskripsi</Label>
                <Textarea
                  rows={4}
                  value={description}
                  placeholder="Kamar tenang menghadap taman, dengan kamar mandi dalam."
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Kapasitas (tamu)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Extrabed</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={extrabedCapacity}
                    onChange={(e) => setExtrabedCapacity(Number(e.target.value))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Luas (m²)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={sizeSqm}
                    onChange={(e) =>
                      setSizeSqm(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Lokasi / Lantai</Label>
                  <Input
                    value={floorInfo}
                    placeholder="mis. Lantai 2"
                    maxLength={120}
                    onChange={(e) => setFloorInfo(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Nomor kamar</Label>
                  <span className="text-[10px] text-muted-foreground">
                    Total: {roomNumbers.length} kamar
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input p-2">
                  {roomNumbers.map((num) => (
                    <span
                      key={num}
                      className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium"
                    >
                      {num}
                      <button
                        type="button"
                        title="Hapus"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setRoomNumbers(roomNumbers.filter((n) => n !== num))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={roomNumberInput}
                    placeholder="Ketik nomor lalu Enter"
                    className="min-w-[140px] flex-1 bg-transparent text-xs outline-none"
                    onChange={(e) => setRoomNumberInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addRoomNumber();
                      }
                    }}
                    onBlur={addRoomNumber}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Satu tipe kamar bisa punya beberapa nomor kamar (mis. FS100, FS222).
                </p>
              </div>
            </div>
          )}

          {tab === "pricing" && (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Tarif dasar (per malam, Rp)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={baseRate}
                  onChange={(e) => setBaseRate(Number(e.target.value))}
                />
                <p className="text-[10px] text-muted-foreground">
                  Harga acuan per malam untuk tipe kamar ini.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="mb-3 text-sm font-medium">Add-ons</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Harga Extra Bed (per malam, Rp)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={extrabedRate}
                      onChange={(e) => setExtrabedRate(Number(e.target.value))}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Biaya tambahan per malam jika tamu menambah extra bed.
                      Isi 0 jika gratis atau tidak tersedia.
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Maks Extra Bed</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={extrabedCapacity}
                      onChange={(e) => setExtrabedCapacity(Number(e.target.value))}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Jumlah maksimal extra bed yang bisa ditambahkan ke kamar ini.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "features" && (
            <div className="grid gap-4">
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
                <Label className="text-xs">Ukuran tempat tidur</Label>
                <Input
                  value={bedSize}
                  placeholder="mis. 180x200 cm (King) atau 120x200 cm"
                  maxLength={60}
                  onChange={(e) => setBedSize(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Dipakai chatbot untuk menjawab pertanyaan ukuran/dimensi tempat tidur.
                </p>
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
            </div>
          )}

          {tab === "media" && (
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
                className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input bg-muted/40 py-8 text-center transition hover:border-primary"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                ) : (
                  <Upload className="h-6 w-6 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {uploading ? "Mengupload…" : "Tarik foto ke sini atau klik untuk pilih"}
                </p>
                <p className="text-[10px] text-muted-foreground">JPG/PNG otomatis dikonversi ke WebP · bisa banyak</p>
              </div>

              {/* Pick from Media Library */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setMediaPickerOpen(true); }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                Pilih dari Media Library
              </button>
              <MediaPicker
                open={mediaPickerOpen}
                kind="image"
                onPick={(url) => { setImages((prev) => [...prev, url]); setMediaPickerOpen(false); }}
                onClose={() => setMediaPickerOpen(false)}
              />

              {images.length > 0 && (
                <>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Foto pertama menjadi cover. {images.length} foto.
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {images.map((url, i) => (
                      <div
                        key={url}
                        className="group relative overflow-hidden rounded-md border border-input"
                      >
                        <img src={url} alt={name || "Foto kamar"} className="aspect-video w-full object-cover" />
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
          )}
        </div>

        {/* Pinned footer — always visible */}
        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
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
