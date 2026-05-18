/**
 * /admin/pages — Homepage Builder.
 *
 * A tabbed page that customises the public homepage: header, hero
 * slider, booking date-picker widget, room carousel, plus a media
 * library and a live preview. All settings persist into the property's
 * `homepage_config` JSONB document.
 */
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
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
  ArrowLeft,
  Type,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getHomepageConfig,
  updateHomepageConfig,
  DEFAULT_HOMEPAGE_CONFIG,
  type HomepageConfig,
  type HeroSlide,
} from "@/admin/modules/homepage/homepage.functions";
import { LAYER_MIN, LAYER_MAX } from "@/admin/modules/homepage/homepage.config";

export const Route = createFileRoute("/admin/pages")({
  component: HomepageBuilder,
});

const MEDIA_BUCKET = "room-images";
const MEDIA_PREFIX = "media";

type SectionKey = "header" | "hero" | "datepicker" | "story" | "carousel" | "media";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "header", label: "Header", icon: LayoutPanelTop },
  { key: "hero", label: "Hero Slider", icon: GalleryHorizontal },
  { key: "datepicker", label: "Date Picker", icon: CalendarCheck },
  { key: "story", label: "Teks", icon: Type },
  { key: "carousel", label: "Our Room", icon: RectangleHorizontal },
  { key: "media", label: "Media Library", icon: Images },
];

/**
 * Page Builder — a live preview canvas in the centre with a contextual
 * editor panel on the right. Pick a section to edit; the right panel
 * swaps to that section's controls.
 */
function HomepageBuilder() {
  const getFn = useServerFn(getHomepageConfig);
  const updateFn = useServerFn(updateHomepageConfig);

  const { data, isLoading } = useQuery({
    queryKey: ["homepage-config"],
    queryFn: () => getFn(),
    refetchOnWindowFocus: false,
  });

  const [section, setSection] = useState<SectionKey>("header");
  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data]);

  // Selecting an element inside the preview iframe.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.source === "pb" && typeof e.data.section === "string") {
        setSection(e.data.section as SectionKey);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Mirror the active section into the preview so it highlights there.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: "pb-host", section }, "*");
  }, [section, previewKey]);

  const save = async () => {
    if (!data?.id) {
      toast.error("Properti belum tersedia. Lengkapi data properti dulu.");
      return;
    }
    setSaving(true);
    try {
      await updateFn({ data: { id: data.id, config: cfg as unknown as Record<string, unknown> } });
      toast.success("Halaman depan tersimpan");
      setPreviewKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const active = SECTIONS.find((s) => s.key === section)!;

  return (
    <div className="flex h-full flex-col bg-stone-100">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/admin">
              <ArrowLeft className="h-4 w-4" />
              Keluar
            </Link>
          </Button>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Homepage Builder
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Page Builder</h1>
          </div>
        </div>
        <Button
          className="gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
          disabled={saving || isLoading}
          onClick={save}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Centre: live preview ── */}
        <div className="flex flex-1 items-start justify-center overflow-auto p-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-white shadow-lg">
            <iframe
              ref={iframeRef}
              key={previewKey}
              title="Preview Halaman Depan"
              src="/?builder=1"
              className="h-[calc(100vh-9rem)] w-full"
            />
          </div>
        </div>

        {/* ── Right: contextual editor ── */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Edit — {active.label}</p>
          </div>
          <div className="flex gap-1 border-b border-border p-2">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                title={s.label}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 rounded-md py-2 transition",
                  section === s.key
                    ? "bg-teal-50 text-teal-900"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <s.icon className="h-4 w-4" />
                <span className="text-[8px] font-medium uppercase tracking-wide">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">Memuat…</p>
            ) : section === "header" ? (
              <HeaderTab cfg={cfg} setCfg={setCfg} />
            ) : section === "hero" ? (
              <HeroTab cfg={cfg} setCfg={setCfg} />
            ) : section === "datepicker" ? (
              <DatePickerTab cfg={cfg} setCfg={setCfg} />
            ) : section === "story" ? (
              <StoryTab cfg={cfg} setCfg={setCfg} />
            ) : section === "carousel" ? (
              <CarouselTab cfg={cfg} setCfg={setCfg} />
            ) : (
              <MediaTab />
            )}
          </div>
        </aside>
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
    <div className="space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
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

/** Layer-arrange control — sets a section's CSS stacking order (z-index). */
function LayerArrange({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(LAYER_MIN, Math.min(v, LAYER_MAX));
  return (
    <FieldRow label={`Susunan layer (z-index: ${value})`}>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Paling depan", () => LAYER_MAX],
            ["Paling belakang", () => LAYER_MIN],
            ["Maju satu", () => value + 10],
            ["Mundur satu", () => value - 10],
          ] as const
        ).map(([label, next]) => (
          <Button
            key={label}
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => onChange(clamp(next()))}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Atur bagian ini berada di depan atau di belakang bagian lain.
      </p>
    </FieldRow>
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

function ImageField({
  value,
  onChange,
  kind = "image",
}: {
  value: string;
  onChange: (url: string) => void;
  kind?: "image" | "video";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isVideo = kind === "video";
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
        {value ? (
          isVideo ? (
            <video src={value} muted className="h-full w-full object-cover" />
          ) : (
            <img src={value} alt="" className="h-full w-full object-cover" />
          )
        ) : isVideo ? (
          <Film className="h-4 w-4 text-muted-foreground/50" />
        ) : (
          <Images className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex-1 space-y-1.5">
        <Input
          value={value}
          placeholder={isVideo ? "URL video" : "URL gambar"}
          className="font-mono text-xs"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          ref={ref}
          type="file"
          accept={isVideo ? "video/*" : "image/*"}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              onChange(await uploadToBucket(f));
              toast.success(isVideo ? "Video terupload" : "Gambar terupload");
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
/* Header                                                              */
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

      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Drop shadow</p>
          <p className="text-xs text-muted-foreground">Bayangan halus di bawah header.</p>
        </div>
        <Switch checked={header.dropShadow} onCheckedChange={(v) => set({ dropShadow: v })} />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Header transparan</p>
          <p className="text-xs text-muted-foreground">
            Header tembus pandang dan menumpuk di atas hero.
          </p>
        </div>
        <Switch checked={header.transparent} onCheckedChange={(v) => set({ transparent: v })} />
      </div>

      {header.transparent && (
        <FieldRow label={`Tingkat transparansi — opasitas latar ${header.opacity}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={header.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </FieldRow>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Blur latar belakang</p>
          <p className="text-xs text-muted-foreground">
            Konten yang lewat di belakang header tampak buram (efek frosted glass).
          </p>
        </div>
        <Switch checked={header.blur} onCheckedChange={(v) => set({ blur: v })} />
      </div>

      {header.blur && (
        <FieldRow label={`Kekuatan blur — ${header.blurAmount}px`}>
          <input
            type="range"
            min={2}
            max={24}
            value={header.blurAmount}
            onChange={(e) => set({ blurAmount: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </FieldRow>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-medium">Saat pengunjung scroll, header:</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["scroll", "Ikut scroll", "Header ikut tergulung ke atas."],
              ["freeze", "Diam (freeze)", "Header tetap menempel di atas."],
              ["disappear", "Menghilang", "Sembunyi saat scroll turun, muncul saat naik."],
              ["fade", "Memudar", "Header memudar saat halaman di-scroll."],
            ] as const
          ).map(([value, title, desc]) => (
            <button
              key={value}
              onClick={() => set({ scrollBehavior: value })}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                header.scrollBehavior === value
                  ? "border-teal-600 bg-teal-50"
                  : "border-border hover:bg-muted",
              )}
            >
              <p className="text-xs font-semibold">{title}</p>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <FieldRow label={`Ukuran logo — ${header.logoSize}px`}>
        <input
          type="range"
          min={24}
          max={96}
          value={header.logoSize}
          onChange={(e) => set({ logoSize: Number(e.target.value) })}
          className="w-full accent-teal-700"
        />
      </FieldRow>

      <FieldRow label="Posisi logo">
        <div className="flex gap-2">
          {(["left", "center", "right"] as const).map((pos) => (
            <button
              key={pos}
              onClick={() => set({ logoPosition: pos })}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-sm capitalize transition",
                header.logoPosition === pos
                  ? "border-teal-600 bg-teal-50 font-medium text-teal-900"
                  : "border-border hover:bg-muted",
              )}
            >
              {pos === "left" ? "Kiri" : pos === "center" ? "Tengah" : "Kanan"}
            </button>
          ))}
        </div>
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

      <FieldRow label="Animasi transisi antar slide">
        <select
          value={hero.transition}
          onChange={(e) =>
            set({ transition: e.target.value as HomepageConfig["hero"]["transition"] })
          }
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="fade">Fade — memudar</option>
          <option value="slide">Slide — menggeser</option>
          <option value="zoom">Zoom — membesar</option>
          <option value="none">Tanpa animasi</option>
        </select>
      </FieldRow>

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
            <Label className="text-[10px] text-muted-foreground">Gambar</Label>
            <ImageField value={slide.imageUrl} onChange={(url) => setSlide(i, { imageUrl: url })} />
            <Label className="text-[10px] text-muted-foreground">
              Video (opsional — diutamakan di atas gambar)
            </Label>
            <ImageField
              kind="video"
              value={slide.videoUrl}
              onChange={(url) => setSlide(i, { videoUrl: url })}
            />
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
            set({
              slides: [...hero.slides, { imageUrl: "", videoUrl: "", heading: "", subheading: "" }],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah slide
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-medium">Font judul</Label>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={hero.fontFamily}
            onChange={(e) =>
              set({ fontFamily: e.target.value as HomepageConfig["hero"]["fontFamily"] })
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
          <select
            value={hero.fontStyle}
            onChange={(e) =>
              set({ fontStyle: e.target.value as HomepageConfig["hero"]["fontStyle"] })
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="normal">Normal</option>
            <option value="bold">Tebal</option>
            <option value="italic">Miring</option>
          </select>
        </div>
        <FieldRow label={`Ukuran font — ${hero.fontSize}px`}>
          <input
            type="range"
            min={24}
            max={96}
            value={hero.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </FieldRow>
      </div>

      <LayerArrange value={hero.layer} onChange={(v) => set({ layer: v })} />
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

      <div className="space-y-2">
        <Label className="text-xs font-medium">Font judul</Label>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={dp.fontFamily}
            onChange={(e) =>
              set({ fontFamily: e.target.value as HomepageConfig["datePicker"]["fontFamily"] })
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
          <select
            value={dp.fontStyle}
            onChange={(e) =>
              set({ fontStyle: e.target.value as HomepageConfig["datePicker"]["fontStyle"] })
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="normal">Normal</option>
            <option value="bold">Tebal</option>
            <option value="italic">Miring</option>
          </select>
        </div>
        <FieldRow label={`Ukuran font — ${dp.fontSize}px`}>
          <input
            type="range"
            min={12}
            max={40}
            value={dp.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </FieldRow>
      </div>

      <LayerArrange value={dp.layer} onChange={(v) => set({ layer: v })} />
    </Section>
  );
}

/* ================================================================== */
/* 5. Room carousel                                                    */
/* ================================================================== */

function StoryTab({ cfg, setCfg }: TabProps) {
  const story = cfg.story;
  const set = (patch: Partial<HomepageConfig["story"]>) =>
    setCfg((c) => ({ ...c, story: { ...c.story, ...patch } }));
  return (
    <Section title="Konten Teks" desc="Judul (H1) dan blok teks bagian 'Your Perfect Stay'.">
      <FieldRow label="Judul (H1)">
        <Input value={story.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Blok teks</Label>
        {story.paragraphs.map((p, i) => (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Text {String(i + 1).padStart(2, "0")}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-destructive"
                onClick={() => set({ paragraphs: story.paragraphs.filter((_, x) => x !== i) })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              rows={4}
              value={p}
              onChange={(e) => {
                const ps = [...story.paragraphs];
                ps[i] = e.target.value;
                set({ paragraphs: ps });
              }}
            />
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => set({ paragraphs: [...story.paragraphs, ""] })}
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah teks
        </Button>
      </div>
    </Section>
  );
}

function CarouselTab({ cfg, setCfg }: TabProps) {
  const rc = cfg.roomCarousel;
  const set = (patch: Partial<HomepageConfig["roomCarousel"]>) =>
    setCfg((c) => ({ ...c, roomCarousel: { ...c.roomCarousel, ...patch } }));

  return (
    <Section title="Our Room" desc="Bagian kartu kamar yang bergeser otomatis di halaman depan.">
      <FieldRow label="Judul section">
        <Input value={rc.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <FieldRow label="Teks di bawah judul">
        <Textarea
          rows={2}
          value={rc.subheading}
          onChange={(e) => set({ subheading: e.target.value })}
        />
      </FieldRow>
      <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
        <div>
          <p className="text-sm font-medium">Geser otomatis</p>
          <p className="text-xs text-muted-foreground">Carousel berpindah sendiri.</p>
        </div>
        <Switch checked={rc.autoplay} onCheckedChange={(v) => set({ autoplay: v })} />
      </div>
      <FieldRow label={`Jumlah kartu kamar ditampilkan (${rc.cardsPerView})`}>
        <input
          type="range"
          min={1}
          max={4}
          value={rc.cardsPerView}
          onChange={(e) => set({ cardsPerView: Number(e.target.value) })}
          className="w-full accent-teal-700"
        />
      </FieldRow>
      <FieldRow label="Kecepatan slider — waktu antar slide (ms)">
        <Input
          type="number"
          value={rc.slideMs}
          onChange={(e) => set({ slideMs: Number(e.target.value) })}
        />
      </FieldRow>
      <LayerArrange value={rc.layer} onChange={(v) => set({ layer: v })} />
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
