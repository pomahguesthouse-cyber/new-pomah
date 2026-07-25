/**
 * WalkthroughBuilderView — admin page to build a per-room-type 360° virtual
 * tour: upload equirectangular photos as scenes, connect them with navigation
 * hotspots (click the panorama to place one), pick a starting scene, and
 * publish. Reads/writes go through the browser Supabase client guarded by RLS
 * (authenticated staff have full access). Custom tables aren't in the generated
 * types, so table calls use an untyped `sb` view — same approach as the
 * server-side `db()` helper elsewhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  Star,
  StarOff,
  ArrowUp,
  ArrowDown,
  MapPin,
  Link2,
  Info,
  Globe,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Pannellum360Viewer, type WalkScene } from "./pannellum-viewer";

const BUCKET = "walkthrough-360";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type RoomType = { id: string; name: string; slug: string | null };
type Tour = {
  id: string;
  room_type_id: string;
  title: string | null;
  slug: string | null;
  is_published: boolean;
  default_scene_id: string | null;
};
type SceneRow = {
  id: string;
  tour_id: string;
  title: string | null;
  image_path: string;
  image_url: string;
  order_index: number;
};
type HotspotRow = {
  id: string;
  scene_id: string;
  target_scene_id: string | null;
  type: "scene" | "info";
  label: string | null;
  label_mode: "hover" | "always";
  pitch: number;
  yaw: number;
};

function ext(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "jpg";
}

/** Normalize free text into a URL-safe slug. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Extract a human message from an Error or a Supabase PostgrestError object. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return (
      (o.message as string) ||
      (o.details as string) ||
      (o.hint as string) ||
      JSON.stringify(o)
    );
  }
  return String(e ?? "unknown");
}

export function WalkthroughBuilderView() {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [roomTypeId, setRoomTypeId] = useState<string>("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [hotspots, setHotspots] = useState<HotspotRow[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slugInput, setSlugInput] = useState("");

  // Pending hotspot placement (after clicking the panorama in edit mode).
  const [pick, setPick] = useState<{ pitch: number; yaw: number } | null>(null);
  const [pickType, setPickType] = useState<"scene" | "info">("scene");
  const [pickTarget, setPickTarget] = useState<string>("");
  const [pickLabel, setPickLabel] = useState<string>("");
  const [pickLabelMode, setPickLabelMode] = useState<"hover" | "always">("hover");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Initial load: room types + property ────────────────────────────────────
  useEffect(() => {
    void (async () => {
      const [{ data: rts }, { data: props }] = await Promise.all([
        sb.from("room_types").select("id, name, slug").order("name"),
        sb.from("properties").select("id").limit(1),
      ]);
      setRoomTypes((rts ?? []) as RoomType[]);
      setPropertyId((props?.[0]?.id as string) ?? null);
      if (rts && rts.length > 0) setRoomTypeId(rts[0].id as string);
    })();
  }, []);

  // ── Load tour + scenes + hotspots for the selected room type ───────────────
  const reload = useCallback(async (rtId: string) => {
    if (!rtId) return;
    setLoading(true);
    try {
      const { data: tourRow } = await sb
        .from("walkthrough_tours")
        .select("id, room_type_id, title, slug, is_published, default_scene_id")
        .eq("room_type_id", rtId)
        .maybeSingle();

      if (!tourRow) {
        setTour(null);
        setScenes([]);
        setHotspots([]);
        setSelectedSceneId(null);
        return;
      }
      setTour(tourRow as Tour);

      const { data: sceneRows } = await sb
        .from("walkthrough_scenes")
        .select("id, tour_id, title, image_path, image_url, order_index")
        .eq("tour_id", tourRow.id)
        .order("order_index", { ascending: true });
      const sList = (sceneRows ?? []) as SceneRow[];
      setScenes(sList);

      const ids = sList.map((s) => s.id);
      if (ids.length > 0) {
        const { data: hsRows } = await sb
          .from("walkthrough_hotspots")
          .select("id, scene_id, target_scene_id, type, label, label_mode, pitch, yaw")
          .in("scene_id", ids);
        setHotspots((hsRows ?? []) as HotspotRow[]);
      } else {
        setHotspots([]);
      }

      setSelectedSceneId((prev) =>
        prev && sList.some((s) => s.id === prev) ? prev : (sList[0]?.id ?? null),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (roomTypeId) void reload(roomTypeId);
  }, [roomTypeId, reload]);

  // Keep the slug input in sync with the loaded tour.
  useEffect(() => {
    setSlugInput(tour?.slug ?? "");
  }, [tour?.id, tour?.slug]);

  // ── Derived: scenes shaped for the viewer ──────────────────────────────────
  const viewerScenes: WalkScene[] = useMemo(
    () =>
      scenes.map((s) => ({
        id: s.id,
        title: s.title,
        imageUrl: s.image_url,
        hotspots: hotspots
          .filter((h) => h.scene_id === s.id)
          .map((h) => ({
            id: h.id,
            pitch: Number(h.pitch),
            yaw: Number(h.yaw),
            type: h.type,
            label: h.label,
            labelMode: h.label_mode,
            targetSceneId: h.target_scene_id,
          })),
      })),
    [scenes, hotspots],
  );

  const selectedScene = scenes.find((s) => s.id === selectedSceneId) ?? null;
  const sceneHotspots = hotspots.filter((h) => h.scene_id === selectedSceneId);
  const publicSlug = roomTypes.find((r) => r.id === roomTypeId)?.slug ?? "";
  const effectiveSlug = tour?.slug || publicSlug;

  // ── Actions ────────────────────────────────────────────────────────────────
  async function createTour() {
    if (!roomTypeId) return;
    setBusy(true);
    try {
      const rt = roomTypes.find((r) => r.id === roomTypeId);
      const title = rt?.name ?? "Virtual Tour";
      const defaultSlug = rt?.slug ? slugify(rt.slug) : slugify(title);
      const { data, error } = await sb
        .from("walkthrough_tours")
        .insert({ room_type_id: roomTypeId, property_id: propertyId, title, slug: defaultSlug || null })
        .select("id, room_type_id, title, slug, is_published, default_scene_id")
        .single();
      if (error) throw error;
      setTour(data as Tour);
      toast.success("Tour dibuat. Upload foto 360 untuk memulai.");
    } catch (e) {
      toast.error(`Gagal membuat tour: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadScenes(files: FileList) {
    if (!tour) return;
    setUploading(true);
    try {
      let added = 0;
      let order = scenes.length;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const path = `${tour.id}/${crypto.randomUUID()}.${ext(file.name)}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { cacheControl: "3600", upsert: false });
        if (upErr) {
          toast.error(`Upload gagal: ${upErr.message}`);
          continue;
        }
        const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        const title = file.name.replace(/\.[a-z0-9]+$/i, "");
        const { error: insErr } = await sb.from("walkthrough_scenes").insert({
          tour_id: tour.id,
          title,
          image_path: path,
          image_url: url,
          order_index: order++,
        });
        if (insErr) {
          toast.error(`Simpan scene gagal: ${insErr.message}`);
          continue;
        }
        added++;
      }
      if (added > 0) toast.success(`${added} scene 360 ditambahkan`);
      await reload(roomTypeId);
    } finally {
      setUploading(false);
    }
  }

  async function deleteScene(s: SceneRow) {
    if (!confirm(`Hapus scene "${s.title ?? "Tanpa nama"}"? Hotspot terkait juga terhapus.`)) return;
    setBusy(true);
    try {
      await supabase.storage.from(BUCKET).remove([s.image_path]);
      const { error } = await sb.from("walkthrough_scenes").delete().eq("id", s.id);
      if (error) throw error;
      toast.success("Scene dihapus");
      await reload(roomTypeId);
    } catch (e) {
      toast.error(`Gagal hapus: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setDefaultScene(sceneId: string) {
    if (!tour) return;
    const { error } = await sb
      .from("walkthrough_tours")
      .update({ default_scene_id: sceneId, updated_at: new Date().toISOString() })
      .eq("id", tour.id);
    if (error) {
      toast.error("Gagal set scene awal");
      return;
    }
    setTour({ ...tour, default_scene_id: sceneId });
    toast.success("Scene awal diperbarui");
  }

  async function moveScene(s: SceneRow, dir: -1 | 1) {
    const idx = scenes.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= scenes.length) return;
    const other = scenes[swapIdx];
    setBusy(true);
    try {
      await Promise.all([
        sb.from("walkthrough_scenes").update({ order_index: other.order_index }).eq("id", s.id),
        sb.from("walkthrough_scenes").update({ order_index: s.order_index }).eq("id", other.id),
      ]);
      await reload(roomTypeId);
    } finally {
      setBusy(false);
    }
  }

  async function addHotspot() {
    if (!pick || !selectedSceneId) return;
    if (pickType === "scene" && !pickTarget) {
      toast.error("Pilih ruangan tujuan untuk hotspot navigasi");
      return;
    }
    setBusy(true);
    try {
      const { error } = await sb.from("walkthrough_hotspots").insert({
        scene_id: selectedSceneId,
        type: pickType,
        target_scene_id: pickType === "scene" ? pickTarget : null,
        label: pickLabel.trim() || null,
        label_mode: pickLabelMode,
        pitch: pick.pitch,
        yaw: pick.yaw,
      });
      if (error) throw error;
      setPick(null);
      setPickLabel("");
      setPickTarget("");
      setPickLabelMode("hover");
      toast.success("Hotspot ditambahkan");
      await reload(roomTypeId);
    } catch (e) {
      toast.error(`Gagal tambah hotspot: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteHotspot(id: string) {
    setBusy(true);
    try {
      await sb.from("walkthrough_hotspots").delete().eq("id", id);
      await reload(roomTypeId);
    } finally {
      setBusy(false);
    }
  }

  // Persist a dragged hotspot's new position. Optimistic local update — the
  // viewer already moved it live and its rebuild key ignores pitch/yaw, so no
  // camera reset. No full reload needed.
  async function moveHotspot(id: string, pitch: number, yaw: number) {
    setHotspots((prev) => prev.map((h) => (h.id === id ? { ...h, pitch, yaw } : h)));
    const { error } = await sb.from("walkthrough_hotspots").update({ pitch, yaw }).eq("id", id);
    if (error) {
      toast.error("Gagal menyimpan posisi hotspot");
      void reload(roomTypeId);
    }
  }

  async function toggleHotspotLabelMode(h: HotspotRow) {
    const next = h.label_mode === "always" ? "hover" : "always";
    setHotspots((prev) => prev.map((x) => (x.id === h.id ? { ...x, label_mode: next } : x)));
    const { error } = await sb
      .from("walkthrough_hotspots")
      .update({ label_mode: next })
      .eq("id", h.id);
    if (error) {
      toast.error("Gagal mengubah mode label");
      void reload(roomTypeId);
    }
  }

  async function togglePublish(next: boolean) {
    if (!tour) return;
    if (next && scenes.length === 0) {
      toast.error("Tambahkan minimal satu scene sebelum publish");
      return;
    }
    const { error } = await sb
      .from("walkthrough_tours")
      .update({ is_published: next, updated_at: new Date().toISOString() })
      .eq("id", tour.id);
    if (error) {
      toast.error("Gagal mengubah status publish");
      return;
    }
    setTour({ ...tour, is_published: next });
    toast.success(next ? "Tour dipublish" : "Tour disembunyikan");
  }

  async function saveSlug() {
    if (!tour) return;
    const clean = slugify(slugInput);
    if (!clean) {
      toast.error("Slug tidak boleh kosong");
      setSlugInput(tour.slug ?? "");
      return;
    }
    if (clean === tour.slug) return;
    setBusy(true);
    try {
      const { error } = await sb
        .from("walkthrough_tours")
        .update({ slug: clean, updated_at: new Date().toISOString() })
        .eq("id", tour.id);
      if (error) {
        // 23505 = unique violation → slug already used by another tour.
        const dup = (error as { code?: string })?.code === "23505";
        toast.error(dup ? `Slug "${clean}" sudah dipakai tour lain` : `Gagal simpan slug: ${errMsg(error)}`);
        return;
      }
      setTour({ ...tour, slug: clean });
      setSlugInput(clean);
      toast.success("Slug diperbarui");
    } finally {
      setBusy(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">360° Virtual Tour</h1>
          <p className="text-sm text-muted-foreground">
            Bangun walkthrough 360 per tipe kamar: upload foto, hubungkan dengan hotspot, lalu publish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Tipe kamar</Label>
          <Select value={roomTypeId} onValueChange={setRoomTypeId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Pilih tipe kamar" />
            </SelectTrigger>
            <SelectContent>
              {roomTypes.map((rt) => (
                <SelectItem key={rt.id} value={rt.id}>
                  {rt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
        </div>
      ) : !tour ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
          <Globe className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Belum ada tour untuk tipe kamar ini.
          </p>
          <Button onClick={createTour} disabled={busy}>
            Buat Virtual Tour
          </Button>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          {/* ── Left: scenes + publish ── */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={tour.is_published}
                  onCheckedChange={togglePublish}
                  id="publish"
                />
                <Label htmlFor="publish" className="text-sm">
                  {tour.is_published ? "Publish (tampil ke publik)" : "Draft"}
                </Label>
              </div>
            </div>

            {/* Editable public slug for /tour/<slug> */}
            <div className="rounded-lg border p-3">
              <Label className="text-xs text-muted-foreground">Slug halaman publik</Label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">/tour/</span>
                <Input
                  className="h-8"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value)}
                  onBlur={(e) => setSlugInput(slugify(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveSlug();
                  }}
                  placeholder={publicSlug || "deluxe-360"}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !slugInput.trim() || slugify(slugInput) === (tour.slug ?? "")}
                  onClick={saveSlug}
                >
                  Simpan
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Alamat: /tour/{slugify(slugInput) || effectiveSlug || "…"}
              </p>
            </div>

            {tour.is_published && effectiveSlug && (
              <a
                href={`/tour/${effectiveSlug}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs text-primary hover:bg-accent/10"
              >
                <Link2 className="h-3.5 w-3.5" /> /tour/{effectiveSlug}
              </a>
            )}

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) void uploadScenes(e.dataTransfer.files);
              }}
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center"
            >
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Tarik & letakkan foto 360 (equirectangular), atau
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void uploadScenes(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Mengupload…
                  </>
                ) : (
                  "Pilih foto 360"
                )}
              </Button>
            </div>

            <div className="flex flex-col gap-2">
              {scenes.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">Belum ada scene.</p>
              )}
              {scenes.map((s, i) => {
                const isDefault = tour.default_scene_id === s.id;
                const active = selectedSceneId === s.id;
                const count = hotspots.filter((h) => h.scene_id === s.id).length;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2",
                      active && "border-primary bg-accent/10",
                    )}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setSelectedSceneId(s.id)}
                    >
                      <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-muted">
                        <img
                          src={s.image_url}
                          alt={s.title ?? "scene"}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{s.title ?? "Tanpa nama"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {count} hotspot{isDefault ? " · awal" : ""}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Jadikan scene awal"
                        onClick={() => setDefaultScene(s.id)}
                      >
                        {isDefault ? (
                          <Star className="h-3.5 w-3.5 text-amber-500" />
                        ) : (
                          <StarOff className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={i === 0 || busy}
                        onClick={() => moveScene(s, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        disabled={i === scenes.length - 1 || busy}
                        onClick={() => moveScene(s, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        disabled={busy}
                        onClick={() => deleteScene(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Right: viewer + hotspot editor ── */}
          <div className="flex min-h-[400px] flex-col gap-3">
            {selectedScene ? (
              <>
                <div className="relative h-[52vh] overflow-hidden rounded-lg border bg-black">
                  <Pannellum360Viewer
                    scenes={viewerScenes}
                    firstSceneId={selectedSceneId}
                    editable
                    onPick={(c) => setPick(c)}
                    onSceneChange={(id) => setSelectedSceneId(id)}
                    onHotspotDragEnd={moveHotspot}
                  />
                  <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
                    <MapPin className="mr-1 inline h-3 w-3" />
                    Klik untuk menaruh hotspot · seret hotspot untuk memindahkan
                  </div>
                </div>

                {pick && (
                  <div className="rounded-lg border bg-card p-3">
                    <p className="mb-2 text-xs font-medium">
                      Hotspot baru di pitch {pick.pitch.toFixed(1)}°, yaw {pick.yaw.toFixed(1)}°
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Jenis</Label>
                        <Select value={pickType} onValueChange={(v) => setPickType(v as "scene" | "info")}>
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="scene">Pindah ruangan</SelectItem>
                            <SelectItem value="info">Info / catatan</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {pickType === "scene" && (
                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px]">Ruangan tujuan</Label>
                          <Select value={pickTarget} onValueChange={setPickTarget}>
                            <SelectTrigger className="h-8 w-44">
                              <SelectValue placeholder="Pilih scene" />
                            </SelectTrigger>
                            <SelectContent>
                              {scenes
                                .filter((s) => s.id !== selectedSceneId)
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.title ?? "Tanpa nama"}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-1">
                        <Label className="text-[10px]">Label (opsional)</Label>
                        <Input
                          className="h-8"
                          value={pickLabel}
                          onChange={(e) => setPickLabel(e.target.value)}
                          placeholder={pickType === "scene" ? "mis. Ke kamar mandi" : "mis. Smart TV 43\""}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-[10px]">Tampilan label</Label>
                        <Select
                          value={pickLabelMode}
                          onValueChange={(v) => setPickLabelMode(v as "hover" | "always")}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hover">Saat hover</SelectItem>
                            <SelectItem value="always">Selalu tampil</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button size="sm" onClick={addHotspot} disabled={busy}>
                        Tambah
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPick(null)}>
                        Batal
                      </Button>
                    </div>
                  </div>
                )}

                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-medium">
                    Hotspot di scene ini ({sceneHotspots.length})
                  </p>
                  {sceneHotspots.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Belum ada. Klik panorama di atas untuk menambah.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {sceneHotspots.map((h) => (
                        <li
                          key={h.id}
                          className="flex items-center gap-2 rounded border px-2 py-1.5 text-xs"
                        >
                          {h.type === "scene" ? (
                            <Link2 className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Info className="h-3.5 w-3.5 text-amber-500" />
                          )}
                          <span className="flex-1 truncate">
                            {h.type === "scene"
                              ? `→ ${scenes.find((s) => s.id === h.target_scene_id)?.title ?? "?"}`
                              : h.label || "Info"}
                            {h.label && h.type === "scene" ? ` · ${h.label}` : ""}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("h-6 w-6", h.label_mode === "always" && "text-primary")}
                            title={
                              h.label_mode === "always"
                                ? "Label selalu tampil — klik untuk hanya saat hover"
                                : "Label saat hover — klik untuk selalu tampil"
                            }
                            onClick={() => toggleHotspotLabelMode(h)}
                          >
                            {h.label_mode === "always" ? (
                              <Eye className="h-3.5 w-3.5" />
                            ) : (
                              <EyeOff className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            onClick={() => deleteHotspot(h.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground">
                <ImageIcon className="h-8 w-8" />
                <p className="text-sm">Upload foto 360 lalu pilih scene untuk mengedit.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default WalkthroughBuilderView;
