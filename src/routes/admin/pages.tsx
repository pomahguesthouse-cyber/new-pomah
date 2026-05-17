/**
 * /admin/pages — Homepage Builder.
 *
 * A tabbed page that customises the public homepage: header, hero
 * slider, booking date-picker widget, room carousel, plus a media
 * library and a live preview. All settings persist into the property's
 * `homepage_config` JSONB document.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Monitor,
  LayoutPanelTop,
  GalleryHorizontal,
  CalendarCheck,
  RectangleHorizontal,
  Images,
  Plus,
  Trash2,
  Upload,
  Loader2,
  Save,
  Film,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getHomepageConfig,
  updateHomepageConfig,
  DEFAULT_HOMEPAGE_CONFIG,
  type HomepageConfig,
  type HeroSlide,
} from "@/admin/modules/homepage/homepage.functions";

export const Route = createFileRoute("/admin/pages")({
  component: HomepageBuilder,
});

const MEDIA_BUCKET = "room-images";
const MEDIA_PREFIX = "media";

type TabKey = "preview" | "header" | "hero" | "datepicker" | "carousel" | "media";

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "preview", label: "Preview Halaman Depan", icon: Monitor },
  { key: "header", label: "Desain Header", icon: LayoutPanelTop },
  { key: "hero", label: "Desain Hero Slider", icon: GalleryHorizontal },
  { key: "datepicker", label: "Widget Date Picker", icon: CalendarCheck },
  { key: "carousel", label: "Carousel Kamar", icon: RectangleHorizontal },
  { key: "media", label: "Media Library", icon: Images },
];

function HomepageBuilder() {
  const getFn = useServerFn(getHomepageConfig);
  const updateFn = useServerFn(updateHomepageConfig);

  const { data, isLoading } = useQuery({
    queryKey: ["homepage-config"],
    queryFn: () => getFn(),
    refetchOnWindowFocus: false,
  });

  const [tab, setTab] = useState<TabKey>("preview");
  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data]);

  const save = async () => {
    if (!data?.id) {
      toast.error("Properti belum tersedia. Lengkapi data properti dulu.");
      return;
    }
    setSaving(true);
    try {
      await updateFn({ data: { id: data.id, config: cfg as unknown as Record<string, unknown> } });
      toast.success("Halaman depan tersimpan");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 md:px-10">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Homepage Builder
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Halaman Depan</h1>
        </div>
        {tab !== "preview" && tab !== "media" && (
          <Button
            className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
            disabled={saving || isLoading}
            onClick={save}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-60 shrink-0 space-y-1 border-r border-border p-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition",
                tab === t.key
                  ? "bg-teal-50 font-medium text-teal-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <t.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-8 text-sm text-muted-foreground">Memuat…</p>
          ) : tab === "preview" ? (
            <PreviewTab />
          ) : tab === "header" ? (
            <HeaderTab cfg={cfg} setCfg={setCfg} />
          ) : tab === "hero" ? (
            <HeroTab cfg={cfg} setCfg={setCfg} />
          ) : tab === "datepicker" ? (
            <DatePickerTab cfg={cfg} setCfg={setCfg} />
          ) : tab === "carousel" ? (
            <CarouselTab cfg={cfg} setCfg={setCfg} />
          ) : (
            <MediaTab />
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Shared building blocks                                             */
/* ================================================================== */

type TabProps = {
  cfg: HomepageConfig;
  setCfg: React.Dispatch<React.SetStateAction<HomepageConfig>>;
};

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl space-y-4 p-6 md:p-8">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border"
      />
      <Input
        value={value}
        className="font-mono text-sm"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Upload a file to the media bucket and return its public URL. */
async function uploadToBucket(file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${MEDIA_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) throw error;
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function ImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <Images className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex-1 space-y-1.5">
        <Input
          value={value}
          placeholder="URL gambar"
          className="font-mono text-xs"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              onChange(await uploadToBucket(f));
              toast.success("Gambar terupload");
            } catch (err) {
              toast.error(`Upload gagal: ${(err as Error).message}`);
            } finally {
              setBusy(false);
              if (ref.current) ref.current.value = "";
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {busy ? "Mengupload…" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 1. Preview                                                          */
/* ================================================================== */

function PreviewTab() {
  return (
    <div className="flex h-full flex-col p-6 md:p-8">
      <p className="mb-3 text-sm text-muted-foreground">
        Tampilan langsung halaman depan. Simpan perubahan di tab lain lalu refresh preview ini.
      </p>
      <div className="flex-1 overflow-hidden rounded-xl border border-border shadow-sm">
        <iframe title="Preview Halaman Depan" src="/" className="h-full min-h-[600px] w-full" />
      </div>
    </div>
  );
}

/* ================================================================== */
/* 2. Header                                                           */
/* ================================================================== */

function HeaderTab({ cfg, setCfg }: TabProps) {
  const header = cfg.header;
  const set = (patch: Partial<HomepageConfig["header"]>) =>
    setCfg((c) => ({ ...c, header: { ...c.header, ...patch } }));

  return (
    <Section
      title="Desain Header"
      desc="Warna, tombol, dan menu navigasi pada bagian atas halaman."
    >
      <FieldRow label="Warna latar header">
        <ColorField value={header.bgColor} onChange={(v) => set({ bgColor: v })} />
      </FieldRow>
      <FieldRow label="Teks tombol pesan">
        <Input value={header.bookLabel} onChange={(e) => set({ bookLabel: e.target.value })} />
      </FieldRow>

      <div className="space-y-2">
        <Label className="text-xs font-medium">Menu navigasi</Label>
        {header.links.map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={link.label}
              placeholder="Label"
              onChange={(e) => {
                const links = [...header.links];
                links[i] = { ...links[i], label: e.target.value };
                set({ links });
              }}
            />
            <Input
              value={link.href}
              placeholder="/path atau #anchor"
              className="font-mono text-xs"
              onChange={(e) => {
                const links = [...header.links];
                links[i] = { ...links[i], href: e.target.value };
                set({ links });
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0 text-destructive"
              onClick={() => set({ links: header.links.filter((_, x) => x !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => set({ links: [...header.links, { label: "Menu", href: "/" }] })}
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah menu
        </Button>
      </div>
    </Section>
  );
}

/* ================================================================== */
/* 3. Hero slider                                                      */
/* ================================================================== */

function HeroTab({ cfg, setCfg }: TabProps) {
  const hero = cfg.hero;
  const set = (patch: Partial<HomepageConfig["hero"]>) =>
    setCfg((c) => ({ ...c, hero: { ...c.hero, ...patch } }));
  const setSlide = (i: number, patch: Partial<HeroSlide>) => {
    const slides = [...hero.slides];
    slides[i] = { ...slides[i], ...patch };
    set({ slides });
  };

  return (
    <Section
      title="Desain Hero Slider"
      desc="Banner berganti otomatis di bagian paling atas halaman."
    >
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Kecepatan slide (ms)">
          <Input
            type="number"
            value={hero.autoplayMs}
            onChange={(e) => set({ autoplayMs: Number(e.target.value) })}
          />
        </FieldRow>
        <FieldRow label="Tinggi banner (px)">
          <Input
            type="number"
            value={hero.height}
            onChange={(e) => set({ height: Number(e.target.value) })}
          />
        </FieldRow>
      </div>

      <div className="space-y-3">
        <Label className="text-xs font-medium">Slide ({hero.slides.length})</Label>
        {hero.slides.map((slide, i) => (
          <Card key={i} className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">Slide {i + 1}</p>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive"
                onClick={() => set({ slides: hero.slides.filter((_, x) => x !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ImageField value={slide.imageUrl} onChange={(url) => setSlide(i, { imageUrl: url })} />
            <Input
              value={slide.heading}
              placeholder="Judul"
              onChange={(e) => setSlide(i, { heading: e.target.value })}
            />
            <Input
              value={slide.subheading}
              placeholder="Subjudul"
              onChange={(e) => setSlide(i, { subheading: e.target.value })}
            />
          </Card>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            set({ slides: [...hero.slides, { imageUrl: "", heading: "", subheading: "" }] })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah slide
        </Button>
      </div>
    </Section>
  );
}

/* ================================================================== */
/* 4. Date picker                                                      */
/* ================================================================== */

function DatePickerTab({ cfg, setCfg }: TabProps) {
  const dp = cfg.datePicker;
  const set = (patch: Partial<HomepageConfig["datePicker"]>) =>
    setCfg((c) => ({ ...c, datePicker: { ...c.datePicker, ...patch } }));

  return (
    <Section
      title="Widget Date Picker"
      desc="Kotak pilih tanggal check-in / check-out untuk memulai pemesanan."
    >
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Tampilkan widget</p>
          <p className="text-xs text-muted-foreground">Muncul tepat di bawah hero.</p>
        </div>
        <Switch checked={dp.enabled} onCheckedChange={(v) => set({ enabled: v })} />
      </div>
      <FieldRow label="Judul widget">
        <Input value={dp.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <FieldRow label="Teks tombol">
        <Input value={dp.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
      </FieldRow>
    </Section>
  );
}

/* ================================================================== */
/* 5. Room carousel                                                    */
/* ================================================================== */

function CarouselTab({ cfg, setCfg }: TabProps) {
  const rc = cfg.roomCarousel;
  const set = (patch: Partial<HomepageConfig["roomCarousel"]>) =>
    setCfg((c) => ({ ...c, roomCarousel: { ...c.roomCarousel, ...patch } }));

  return (
    <Section
      title="Carousel Kamar"
      desc="Kartu kamar tampil sebagai carousel yang bergeser otomatis."
    >
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Geser otomatis</p>
          <p className="text-xs text-muted-foreground">Carousel berpindah sendiri.</p>
        </div>
        <Switch checked={rc.autoplay} onCheckedChange={(v) => set({ autoplay: v })} />
      </div>
      <FieldRow label={`Jumlah kartu sekali tampil (${rc.cardsPerView})`}>
        <input
          type="range"
          min={1}
          max={4}
          value={rc.cardsPerView}
          onChange={(e) => set({ cardsPerView: Number(e.target.value) })}
          className="w-full accent-teal-700"
        />
      </FieldRow>
      <FieldRow label="Waktu slide (ms)">
        <Input
          type="number"
          value={rc.slideMs}
          onChange={(e) => set({ slideMs: Number(e.target.value) })}
        />
      </FieldRow>
    </Section>
  );
}

/* ================================================================== */
/* 6. Media library                                                    */
/* ================================================================== */

interface MediaItem {
  name: string;
  url: string;
  isVideo: boolean;
}

function MediaTab() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .list(MEDIA_PREFIX, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      setItems(
        (data ?? [])
          .filter((f) => f.name && !f.name.startsWith("."))
          .map((f) => {
            const url = supabase.storage
              .from(MEDIA_BUCKET)
              .getPublicUrl(`${MEDIA_PREFIX}/${f.name}`).data.publicUrl;
            return { name: f.name, url, isVideo: /\.(mp4|webm|mov|ogg)$/i.test(f.name) };
          }),
      );
    } catch (e) {
      toast.error(`Gagal memuat media: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const file of Array.from(files)) await uploadToBucket(file);
      toast.success(`${files.length} file terupload`);
      await load();
    } catch (e) {
      toast.error(`Upload gagal: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Hapus "${name}"?`)) return;
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([`${MEDIA_PREFIX}/${name}`]);
    if (error) return toast.error(error.message);
    toast.success("File dihapus");
    void load();
  };

  return (
    <div className="space-y-4 p-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Media Library</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gambar dan video untuk halaman depan.
          </p>
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <Button
          className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Mengupload…" : "Upload"}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat media…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Belum ada media. Upload gambar atau video untuk memulai.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <div
              key={m.name}
              className="group relative overflow-hidden rounded-lg border border-border"
            >
              <div className="flex aspect-video items-center justify-center bg-muted">
                {m.isVideo ? (
                  <video src={m.url} className="h-full w-full object-cover" muted />
                ) : (
                  <img src={m.url} alt={m.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex items-center gap-1 px-2 py-1.5">
                {m.isVideo && <Film className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="flex-1 truncate text-[10px] text-muted-foreground">{m.name}</span>
                <button
                  onClick={() => remove(m.name)}
                  className="text-muted-foreground hover:text-destructive"
                  title="Hapus"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
