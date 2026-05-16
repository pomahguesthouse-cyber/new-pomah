import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BedDouble,
  Building2,
  ImageIcon,
  Loader2,
  Plus,
  Ruler,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { createRoom, updateRoom, updateRoomType } from "@/admin/functions/bookings.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

const STORAGE_BUCKET = "room-images";

const STATUSES = ["clean", "dirty", "maintenance", "out_of_order"] as const;
type RoomStatus = (typeof STATUSES)[number];

const STATUS_META: Record<RoomStatus, { label: string; dot: string; chip: string }> = {
  clean: {
    label: "Bersih",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  },
  dirty: {
    label: "Kotor",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  },
  maintenance: {
    label: "Perawatan",
    dot: "bg-blue-500",
    chip: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  },
  out_of_order: {
    label: "Tidak Aktif",
    dot: "bg-rose-500",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  },
};

const SUGGESTED_AMENITIES = [
  "Wi-Fi",
  "AC",
  "TV",
  "Kulkas Mini",
  "Air Panas",
  "Sarapan",
  "Balkon",
  "Brankas",
  "Meja Kerja",
  "Pengering Rambut",
  "Setrika",
  "Pemandangan Taman",
];

const BED_TYPES = ["Single", "Double", "Queen", "King", "Twin", "Bunk"];

export type RoomTypeOption = {
  id: string;
  name: string;
  slug?: string;
  base_rate?: number;
  capacity?: number;
  description?: string | null;
  bed_type?: string | null;
  size_sqm?: number | null;
  amenities?: string[] | null;
  hero_image_url?: string | null;
};

export type RoomDetailRow = {
  id: string;
  number: string;
  status: RoomStatus;
  notes: string | null;
  room_type_id?: string;
  room_types?: RoomTypeOption | null;
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", "Rp");

type Props = {
  mode: "create" | "edit";
  open: boolean;
  room?: RoomDetailRow | null;
  roomTypes: RoomTypeOption[];
  /**
   * Returns a suggested room number for a given room type id — based on
   * the type's prefix and the highest existing number. Used to prefill
   * the number field in create mode (the value stays freely editable).
   */
  suggestNumber?: (roomTypeId: string) => string;
  onClose: () => void;
  onSaved: () => void;
};

export function RoomDetailDialog({
  mode,
  open,
  room,
  roomTypes,
  suggestNumber,
  onClose,
  onSaved,
}: Props) {
  const fnCreate = useServerFn(createRoom);
  const fnUpdate = useServerFn(updateRoom);
  const fnUpdateType = useServerFn(updateRoomType);

  const [tab, setTab] = React.useState("info");

  // Room-level fields
  const [number, setNumber] = React.useState("");
  const [roomTypeId, setRoomTypeId] = React.useState("");
  const [status, setStatus] = React.useState<RoomStatus>("clean");
  const [notes, setNotes] = React.useState("");

  // Room type-level fields (shared across all rooms of same type)
  const [typeName, setTypeName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [capacity, setCapacity] = React.useState(2);
  const [baseRate, setBaseRate] = React.useState(0);
  const [bedType, setBedType] = React.useState("");
  const [sizeSqm, setSizeSqm] = React.useState<number | "">("");
  const [amenities, setAmenities] = React.useState<string[]>([]);
  const [heroImageUrl, setHeroImageUrl] = React.useState<string | null>(null);
  const [customAmenity, setCustomAmenity] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  // The last number we auto-suggested — lets us safely replace it when the
  // type changes, while never overwriting a number the user typed himself.
  const lastSuggestionRef = React.useRef("");

  const selectedType = React.useMemo(
    () => roomTypes.find((t) => t.id === roomTypeId) ?? null,
    [roomTypes, roomTypeId],
  );

  // Hydrate state from room/selected type
  React.useEffect(() => {
    if (!open) return;
    setTab("info");

    if (mode === "edit" && room) {
      setNumber(room.number);
      setRoomTypeId(room.room_type_id ?? room.room_types?.id ?? "");
      setStatus(room.status);
      setNotes(room.notes ?? "");
      const t = room.room_types ?? roomTypes.find((rt) => rt.id === room.room_type_id);
      hydrateTypeFields(t ?? null);
    } else {
      setNumber("");
      lastSuggestionRef.current = "";
      setStatus("clean");
      setNotes("");
      const first = roomTypes[0] ?? null;
      setRoomTypeId(first?.id ?? "");
      hydrateTypeFields(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, room?.id]);

  // When user switches type in CREATE mode: hydrate type fields and refresh
  // the suggested room number (unless the user already typed a custom one).
  React.useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      const t = roomTypes.find((rt) => rt.id === roomTypeId) ?? null;
      hydrateTypeFields(t);
      if (suggestNumber && roomTypeId) {
        const s = suggestNumber(roomTypeId);
        setNumber((prev) => (prev === "" || prev === lastSuggestionRef.current ? s : prev));
        lastSuggestionRef.current = s;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomTypeId]);

  function hydrateTypeFields(t: RoomTypeOption | null) {
    setTypeName(t?.name ?? "");
    setDescription(t?.description ?? "");
    setCapacity(t?.capacity ?? 2);
    setBaseRate(Number(t?.base_rate ?? 0));
    setBedType(t?.bed_type ?? "");
    setSizeSqm(t?.size_sqm ?? "");
    setAmenities(t?.amenities ?? []);
    setHeroImageUrl(t?.hero_image_url ?? null);
  }

  function toggleAmenity(label: string) {
    setAmenities((cur) => (cur.includes(label) ? cur.filter((a) => a !== label) : [...cur, label]));
  }

  function addCustomAmenity() {
    const v = customAmenity.trim();
    if (!v) return;
    if (amenities.includes(v)) {
      setCustomAmenity("");
      return;
    }
    setAmenities((cur) => [...cur, v]);
    setCustomAmenity("");
  }

  async function handleUpload(file: File) {
    if (!roomTypeId) {
      toast.error("Pilih tipe kamar dulu sebelum upload foto");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("File harus berupa gambar");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${roomTypeId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      setHeroImageUrl(pub.publicUrl);
      toast.success("Foto terupload");
    } catch (e) {
      toast.error(
        `Upload gagal: ${(e as Error).message}. Pastikan bucket "${STORAGE_BUCKET}" sudah dibuat (public) di Supabase Storage.`,
      );
    } finally {
      setUploading(false);
    }
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const trimmedNumber = number.trim();
      if (!roomTypeId) throw new Error("Tipe kamar wajib dipilih");
      if (!trimmedNumber) throw new Error("Nomor kamar wajib diisi");

      // 1. Save room
      if (mode === "edit" && room) {
        await fnUpdate({
          data: {
            id: room.id,
            room_type_id: roomTypeId,
            number: trimmedNumber,
            status,
            notes: notes.trim() || null,
          },
        });
      } else {
        await fnCreate({
          data: {
            room_type_id: roomTypeId,
            number: trimmedNumber,
            status,
            notes: notes.trim() || null,
          },
        });
      }

      // 2. Save room_type updates (only if user changed any type-level field
      //    relative to the source). We send unconditionally because the
      //    backend handles it idempotently — easier than diffing.
      if (roomTypeId) {
        const typeSlug =
          selectedType?.slug ||
          (typeName.trim() || selectedType?.name || "tipe-kamar")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        await fnUpdateType({
          data: {
            id: roomTypeId,
            name: typeName.trim() || selectedType?.name || "Untitled",
            slug: typeSlug,
            description: description.trim() || null,
            bed_type: bedType.trim() || null,
            size_sqm: sizeSqm === "" ? null : Number(sizeSqm),
            capacity: Number(capacity) || 1,
            base_rate: Number(baseRate) || 0,
            amenities: amenities.length ? amenities : null,
            hero_image_url: heroImageUrl ?? null,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success(mode === "edit" ? "Kamar diperbarui" : "Kamar ditambahkan");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSave = !!roomTypeId && number.trim().length > 0 && !saveMut.isPending && !uploading;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[760px] p-0 gap-0 overflow-hidden">
        {/* Hero header */}
        <div className="relative bg-gradient-to-br from-primary/15 via-accent/5 to-transparent px-6 pt-6 pb-4 border-b border-border">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <BedDouble className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  {mode === "edit" ? `Kamar #${room?.number ?? "—"}` : "Tambah Kamar Baru"}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {mode === "edit"
                    ? "Edit data kamar dan properti tipe kamar."
                    : "Lengkapi data kamar. Field tipe kamar akan diterapkan ke semua kamar dengan tipe yang sama."}
                </DialogDescription>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest",
                  STATUS_META[status].chip,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[status].dot)} />
                {STATUS_META[status].label}
              </span>
            </div>
          </DialogHeader>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col">
          <div className="border-b border-border bg-muted/30 px-6">
            <TabsList className="h-11 w-full justify-start gap-1 bg-transparent p-0">
              <TabTrigger
                value="info"
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Informasi"
              />
              <TabTrigger
                value="capacity"
                icon={<Wallet className="h-3.5 w-3.5" />}
                label="Kapasitas & Harga"
              />
              <TabTrigger
                value="amenities"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Fasilitas"
              />
              <TabTrigger value="photo" icon={<ImageIcon className="h-3.5 w-3.5" />} label="Foto" />
            </TabsList>
          </div>

          <ScrollArea className="max-h-[60vh]">
            <div className="p-6">
              {/* TAB: Informasi */}
              <TabsContent value="info" className="m-0 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Nomor Kamar" required>
                    <div className="flex gap-2">
                      <Input
                        value={number}
                        onChange={(e) => {
                          setNumber(e.target.value);
                          lastSuggestionRef.current = "";
                        }}
                        placeholder="mis. FS-101, 201"
                        maxLength={20}
                      />
                      {mode === "create" && suggestNumber && roomTypeId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            const s = suggestNumber(roomTypeId);
                            lastSuggestionRef.current = s;
                            setNumber(s);
                          }}
                        >
                          Saran
                        </Button>
                      )}
                    </div>
                  </FieldGroup>
                  <FieldGroup label="Tipe Kamar" required>
                    <Select value={roomTypeId} onValueChange={setRoomTypeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih tipe kamar" />
                      </SelectTrigger>
                      <SelectContent>
                        {roomTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldGroup>
                </div>

                <FieldGroup label="Nama Tipe (akan diterapkan ke seluruh tipe)">
                  <Input
                    value={typeName}
                    onChange={(e) => setTypeName(e.target.value)}
                    placeholder="mis. Deluxe Garden View"
                    maxLength={120}
                  />
                </FieldGroup>

                <FieldGroup label="Deskripsi Tipe Kamar">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Deskripsi yang ditampilkan ke tamu di halaman publik…"
                    rows={3}
                    maxLength={2000}
                  />
                </FieldGroup>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Status Kamar">
                    <Select value={status} onValueChange={(v) => setStatus(v as RoomStatus)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            <span className="flex items-center gap-2">
                              <span className={cn("h-2 w-2 rounded-full", STATUS_META[s].dot)} />
                              {STATUS_META[s].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldGroup>
                  <FieldGroup label="Catatan Internal">
                    <Input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Catatan untuk staff…"
                      maxLength={500}
                    />
                  </FieldGroup>
                </div>
              </TabsContent>

              {/* TAB: Kapasitas & Harga */}
              <TabsContent value="capacity" className="m-0 space-y-5">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    Tarif per Malam
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                    {formatIDR(Number(baseRate) || 0)}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="Tarif Dasar (IDR)" icon={<Wallet className="h-3.5 w-3.5" />}>
                    <Input
                      type="number"
                      min={0}
                      step={10000}
                      value={baseRate}
                      onChange={(e) => setBaseRate(Number(e.target.value))}
                    />
                  </FieldGroup>
                  <FieldGroup label="Kapasitas (orang)" icon={<Users className="h-3.5 w-3.5" />}>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={capacity}
                      onChange={(e) => setCapacity(Number(e.target.value))}
                    />
                  </FieldGroup>
                  <FieldGroup
                    label="Tipe Tempat Tidur"
                    icon={<BedDouble className="h-3.5 w-3.5" />}
                  >
                    <Select
                      value={bedType || "__none"}
                      onValueChange={(v) => setBedType(v === "__none" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">—</SelectItem>
                        {BED_TYPES.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldGroup>
                  <FieldGroup label="Luas (m²)" icon={<Ruler className="h-3.5 w-3.5" />}>
                    <Input
                      type="number"
                      min={0}
                      value={sizeSqm}
                      onChange={(e) =>
                        setSizeSqm(e.target.value === "" ? "" : Number(e.target.value))
                      }
                    />
                  </FieldGroup>
                </div>
              </TabsContent>

              {/* TAB: Fasilitas */}
              <TabsContent value="amenities" className="m-0 space-y-5">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
                    Fasilitas Umum — klik untuk pilih
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_AMENITIES.map((a) => {
                      const active = amenities.includes(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          onClick={() => toggleAmenity(a)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition-all",
                            active
                              ? "border-primary bg-primary text-primary-foreground shadow-sm"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          {a}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                    Tambah Fasilitas Lain
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={customAmenity}
                      onChange={(e) => setCustomAmenity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomAmenity();
                        }
                      }}
                      placeholder="Ketik fasilitas lalu Enter…"
                      maxLength={60}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addCustomAmenity}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Tambah
                    </Button>
                  </div>
                </div>

                {amenities.length > 0 && (
                  <div className="rounded-lg border border-border bg-card p-4">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">
                      Dipilih ({amenities.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {amenities.map((a) => (
                        <Badge key={a} variant="secondary" className="gap-1 pr-1 font-normal">
                          {a}
                          <button
                            type="button"
                            onClick={() => toggleAmenity(a)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-background/60"
                            aria-label={`Hapus ${a}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* TAB: Foto */}
              <TabsContent value="photo" className="m-0 space-y-4">
                <div
                  className={cn(
                    "relative aspect-[16/9] w-full overflow-hidden rounded-lg border-2 border-dashed transition-colors",
                    heroImageUrl ? "border-border" : "border-border bg-muted/30",
                  )}
                >
                  {heroImageUrl ? (
                    <>
                      <img
                        src={heroImageUrl}
                        alt="Foto kamar"
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setHeroImageUrl(null)}
                        className="absolute right-3 top-3 rounded-full bg-background/90 p-2 text-destructive shadow-md backdrop-blur transition-colors hover:bg-background"
                        aria-label="Hapus foto"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  ) : (
                    <label className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50">
                      {uploading ? (
                        <Loader2 className="h-8 w-8 animate-spin" />
                      ) : (
                        <ImageIcon className="h-8 w-8" />
                      )}
                      <p className="text-sm font-medium">
                        {uploading ? "Mengupload…" : "Klik atau jatuhkan foto di sini"}
                      </p>
                      <p className="text-xs">PNG, JPG, atau WebP · maks 5 MB</p>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(f);
                        }}
                      />
                    </label>
                  )}
                </div>

                {heroImageUrl && (
                  <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                    <p className="truncate text-xs text-muted-foreground">{heroImageUrl}</p>
                    <label className="shrink-0">
                      <Button asChild variant="outline" size="sm" className="gap-1.5">
                        <span className="cursor-pointer">
                          <Upload className="h-3.5 w-3.5" />
                          Ganti
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={uploading}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUpload(f);
                            }}
                          />
                        </span>
                      </Button>
                    </label>
                  </div>
                )}

                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Foto disimpan di Supabase Storage bucket{" "}
                  <code className="rounded bg-background px-1 py-0.5 font-mono text-[11px]">
                    {STORAGE_BUCKET}
                  </code>
                  . Pastikan bucket sudah dibuat dan bersifat <strong>public</strong>.
                </p>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="border-t border-border bg-muted/30 px-6 py-3">
          <Button variant="outline" onClick={onClose} disabled={saveMut.isPending}>
            Batal
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={!canSave} className="gap-1.5">
            {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {saveMut.isPending ? "Menyimpan…" : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabTrigger({
  value,
  icon,
  label,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 text-xs font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </TabsTrigger>
  );
}

function FieldGroup({
  label,
  required,
  icon,
  children,
}: {
  label: string;
  required?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}
