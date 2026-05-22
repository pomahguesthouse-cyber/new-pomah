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
// ↓ duplicate removed — useQuery + useMutation added in the landing-pages import block below
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
  FolderOpen,
  Search,
  Globe,
  Check,
  X,
  ExternalLink,
  Settings2,
  Home,
} from "lucide-react";
// useQuery already imported above; useMutation available if needed
import {
  listSeoLandingPages,
  createSeoLandingPage,
  updateSeoLandingPage,
  deleteSeoLandingPage,
  type SeoLandingPage,
  type LPSection,
} from "@/admin/modules/seo/landing-page.functions";
import { LpPageBuilder } from "@/admin/modules/seo/lp-page-builder";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MediaPicker } from "@/admin/components/media-picker";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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

type SectionKey = "header" | "hero" | "datepicker" | "story" | "carousel";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "header",        label: "Header",       icon: LayoutPanelTop     },
  { key: "hero",          label: "Hero Slider",   icon: GalleryHorizontal  },
  { key: "datepicker",    label: "Date Picker",   icon: CalendarCheck      },
  { key: "story",         label: "Teks",          icon: Type               },
  { key: "carousel",      label: "Our Room",      icon: RectangleHorizontal},
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

  // Landing pages — drive the "Site Menu" page list.
  const lpQuery = useQuery({
    queryKey: ["lp-list-builder"],
    queryFn: () => listSeoLandingPages(),
  });
  const pages = lpQuery.data?.pages ?? [];

  const [section, setSection] = useState<SectionKey>("header");
  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Active page in the Site Menu: "home" or a landing-page id.
  const [activePageId, setActivePageId] = useState<string>("home");
  const activeLp = activePageId === "home" ? null : pages.find((p) => p.id === activePageId) ?? null;

  // Sections of the active landing page (edited in the right panel).
  const [lpSections, setLpSections] = useState<LPSection[]>([]);
  useEffect(() => {
    if (activeLp) setLpSections((activeLp.sections ?? []) as LPSection[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLp?.id]);

  // SEO settings popup target (a landing page) — null = closed.
  const [seoTarget, setSeoTarget] = useState<SeoLandingPage | null>(null);

  // If the active LP vanished (deleted), fall back to home.
  useEffect(() => {
    if (activePageId !== "home" && !lpQuery.isLoading && !activeLp) setActivePageId("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpQuery.isLoading, activeLp, activePageId]);

  const previewSrc = activeLp ? `/lp/${activeLp.slug}` : "/?builder=1";

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data]);

  // Selecting an element inside the preview iframe (home only).
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
    if (!activeLp) {
      iframeRef.current?.contentWindow?.postMessage({ source: "pb-host", section }, "*");
    }
  }, [section, previewKey, activeLp]);

  const save = async () => {
    setSaving(true);
    try {
      if (activeLp) {
        await updateSeoLandingPage({
          data: { id: activeLp.id, sections: lpSections.length > 0 ? lpSections : null },
        });
        toast.success("Landing page tersimpan");
        await lpQuery.refetch();
        setPreviewKey((k) => k + 1);
      } else {
        if (!data?.id) {
          toast.error("Properti belum tersedia. Lengkapi data properti dulu.");
          return;
        }
        await updateFn({ data: { id: data.id, config: cfg as unknown as Record<string, unknown> } });
        toast.success("Halaman depan tersimpan");
        setPreviewKey((k) => k + 1);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddPage = async () => {
    const title = window.prompt("Judul halaman baru:", "Halaman Baru");
    if (!title || !title.trim()) return;
    const slug = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
    try {
      const res = await createSeoLandingPage({
        data: { title: title.trim(), slug, hero_cta_text: "Pesan Sekarang", hero_cta_url: "/book", published: false },
      });
      await lpQuery.refetch();
      setActivePageId(res.id);
      toast.success("Halaman dibuat");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDeletePage = async (p: SeoLandingPage) => {
    if (!confirm(`Hapus halaman "${p.title}"?`)) return;
    try {
      await deleteSeoLandingPage({ data: { id: p.id } });
      if (activePageId === p.id) setActivePageId("home");
      await lpQuery.refetch();
      toast.success("Halaman dihapus");
    } catch (e) {
      toast.error((e as Error).message);
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
          {/* Page selector — mirrors the Site Menu */}
          <div className="ml-4 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Page:</span>
            <select
              value={activePageId}
              onChange={(e) => setActivePageId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="home">Home</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
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
        {/* ── Left: Site Menu ── */}
        <SiteMenu
          pages={pages}
          activePageId={activePageId}
          onSelect={setActivePageId}
          onAdd={handleAddPage}
          onDelete={handleDeletePage}
          onSeo={(p) => setSeoTarget(p)}
        />

        {/* ── Centre: live preview ── */}
        <div className="flex flex-1 items-start justify-center overflow-auto p-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-white shadow-lg">
            <iframe
              ref={iframeRef}
              key={`${previewKey}-${previewSrc}`}
              title="Preview"
              src={previewSrc}
              className="h-[calc(100vh-9rem)] w-full"
            />
          </div>
        </div>

        {/* ── Right: contextual editor ── */}
        <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card">
          {activeLp ? (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="truncate text-sm font-semibold">Edit — {activeLp.title}</p>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                  onClick={() => setSeoTarget(activeLp)}>
                  <Settings2 className="h-3.5 w-3.5" /> SEO
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <LpPageBuilder sections={lpSections} onChange={setLpSections} />
              </div>
            </>
          ) : (
            <>
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
                ) : (
                  <CarouselTab cfg={cfg} setCfg={setCfg} />
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* SEO settings popup (landing pages) */}
      <SeoPopup
        page={seoTarget}
        onClose={() => setSeoTarget(null)}
        onSaved={() => lpQuery.refetch()}
      />
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

function FontStyleFields({
  family,
  style,
  size,
  minSize = 12,
  maxSize = 96,
  onFamilyChange,
  onStyleChange,
  onSizeChange,
}: {
  family: "sans" | "serif" | "mono";
  style: "normal" | "bold" | "italic";
  size: number;
  minSize?: number;
  maxSize?: number;
  onFamilyChange: (f: "sans" | "serif" | "mono") => void;
  onStyleChange: (s: "normal" | "bold" | "italic") => void;
  onSizeChange: (s: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Font judul</Label>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={family}
          onChange={(e) => onFamilyChange(e.target.value as any)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="sans">Sans-serif</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
        <select
          value={style}
          onChange={(e) => onStyleChange(e.target.value as any)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="normal">Normal</option>
          <option value="bold">Tebal</option>
          <option value="italic">Miring</option>
        </select>
      </div>
      <FieldRow label={`Ukuran font — ${size}px`}>
        <input
          type="range"
          min={minSize}
          max={maxSize}
          value={size}
          onChange={(e) => onSizeChange(Number(e.target.value))}
          className="w-full accent-teal-700"
        />
      </FieldRow>
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
  const [busy,        setBusy]        = useState(false);
  const [pickerOpen,  setPickerOpen]  = useState(false);
  const isVideo = kind === "video";

  return (
    <div className="flex items-start gap-3">
      {/* Thumbnail */}
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
        {/* Upload + Pick buttons */}
        <div className="flex gap-1.5">
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
          <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy}
            onClick={() => ref.current?.click()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {busy ? "Mengupload…" : "Upload"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setPickerOpen(true)}>
            <FolderOpen className="h-3 w-3" />
            Pilih
          </Button>
        </div>
      </div>

      {/* Media picker dialog */}
      <MediaPicker
        open={pickerOpen}
        kind={isVideo ? "video" : "image"}
        onPick={(url) => { onChange(url); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
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

      <FontStyleFields
        family={hero.fontFamily}
        style={hero.fontStyle}
        size={hero.fontSize}
        minSize={24}
        maxSize={96}
        onFamilyChange={(v) => set({ fontFamily: v })}
        onStyleChange={(v) => set({ fontStyle: v })}
        onSizeChange={(v) => set({ fontSize: v })}
      />

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

      <FontStyleFields
        family={dp.fontFamily}
        style={dp.fontStyle}
        size={dp.fontSize}
        minSize={12}
        maxSize={40}
        onFamilyChange={(v) => set({ fontFamily: v })}
        onStyleChange={(v) => set({ fontStyle: v })}
        onSizeChange={(v) => set({ fontSize: v })}
      />

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
      <div className="border-t border-border my-4 pt-4">
        <FontStyleFields
          family={story.fontFamily ?? "serif"}
          style={story.fontStyle ?? "bold"}
          size={story.fontSize ?? 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
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
      <FieldRow label="Warna latar belakang">
        <ColorField value={rc.bgColor ?? "#f3ece0"} onChange={(v) => set({ bgColor: v })} />
      </FieldRow>
      <FieldRow label="Gambar latar belakang (opsional)">
        <ImageField value={rc.bgImageUrl ?? ""} onChange={(url) => set({ bgImageUrl: url })} />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4">
        <FontStyleFields
          family={rc.fontFamily ?? "serif"}
          style={rc.fontStyle ?? "bold"}
          size={rc.fontSize ?? 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
      </div>
      <LayerArrange value={rc.layer} onChange={(v) => set({ layer: v })} />
    </Section>
  );
}

/* ================================================================== */
/* 6. Landing Pages Tab                                                */
/* ================================================================== */

/**
 * Site Menu — Wix-style left sidebar listing all editable pages
 * (Home + landing pages). Each landing page row has a SEO gear and a
 * delete control on hover; "+ Add Page" creates a new landing page.
 */
function SiteMenu({
  pages,
  activePageId,
  onSelect,
  onAdd,
  onDelete,
  onSeo,
}: {
  pages: SeoLandingPage[];
  activePageId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (p: SeoLandingPage) => void;
  onSeo: (p: SeoLandingPage) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = pages.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-semibold">Site Menu</p>
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900">
          <Plus className="h-3.5 w-3.5" /> Add Page
        </button>
      </div>

      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari halaman…" className="h-7 pl-7 text-xs" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Home — always present */}
        <button type="button" onClick={() => onSelect("home")}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
            activePageId === "home" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
          )}>
          <Home className="h-3.5 w-3.5 shrink-0 text-stone-500" />
          <span className="flex-1 truncate text-xs font-medium text-stone-700">Home</span>
        </button>

        {filtered.map((p) => (
          <div key={p.id}
            className={cn(
              "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition",
              activePageId === p.id ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
            )}
            onClick={() => onSelect(p.id)}>
            <Globe className={cn("h-3.5 w-3.5 shrink-0", p.published ? "text-emerald-500" : "text-stone-300")} />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">{p.title}</span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
              <button type="button" title="Pengaturan SEO"
                onClick={(e) => { e.stopPropagation(); onSeo(p); }}
                className="rounded p-0.5 text-stone-400 hover:text-teal-600">
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <a href={`/lp/${p.slug}`} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-0.5 text-stone-400 hover:text-teal-600">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button type="button" title="Hapus halaman"
                onClick={(e) => { e.stopPropagation(); onDelete(p); }}
                className="rounded p-0.5 text-stone-400 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {pages.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground italic">
            Belum ada halaman tambahan.
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * SEO settings popup — Wix-style modal with three tabs:
 * SEO Basics · Advanced SEO · Social Share. Operates on a single
 * landing page; saves only the SEO/meta fields.
 */
type SeoPopupTab = "basics" | "advanced" | "social";

function SeoPopup({
  page,
  onClose,
  onSaved,
}: {
  page: SeoLandingPage | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<SeoPopupTab>("basics");
  const [saving, setSaving] = useState(false);

  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc]   = useState("");
  const [targetKw, setTargetKw]   = useState("");
  const [ogImage, setOgImage]     = useState("");
  const [indexable, setIndexable] = useState(true);

  useEffect(() => {
    if (!page) return;
    setTab("basics");
    setMetaTitle(page.meta_title ?? "");
    setMetaDesc(page.meta_description ?? "");
    setTargetKw(page.target_keyword ?? "");
    setOgImage(page.og_image_url ?? "");
    setIndexable(page.published);
  }, [page?.id]);

  if (!page) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSeoLandingPage({
        data: {
          id: page.id,
          meta_title:       metaTitle || null,
          meta_description: metaDesc  || null,
          target_keyword:   targetKw  || null,
          og_image_url:     ogImage   || null,
          published:        indexable,
        },
      });
      toast.success("Pengaturan SEO tersimpan");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: SeoPopupTab; label: string }[] = [
    { key: "basics",   label: "SEO Basics"   },
    { key: "advanced", label: "Advanced SEO" },
    { key: "social",   label: "Social Share" },
  ];

  return (
    <Dialog open={!!page} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-teal-600" />
            Pengaturan SEO — {page.title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Kelola bagaimana halaman ini tampil di mesin pencari dan media sosial.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-stone-200">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn(
                "px-3 py-2 text-xs font-medium transition",
                tab === t.key
                  ? "border-b-2 border-teal-600 text-teal-700"
                  : "text-muted-foreground hover:text-foreground",
              )}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto py-1">
          {/* ── SEO Basics ── */}
          {tab === "basics" && (
            <div className="space-y-4">
              {/* Google search preview */}
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <p className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">
                  Pratinjau Hasil Pencarian
                </p>
                <p className="text-[12px] text-stone-500">pomahguesthouse.com › lp › {page.slug}</p>
                <p className="text-[15px] font-medium text-blue-700 hover:underline cursor-pointer leading-snug">
                  {metaTitle || page.title || "Title tag belum diisi"}
                </p>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {metaDesc || <span className="italic text-stone-400">Meta description belum diisi…</span>}
                </p>
              </div>

              <FieldRow label={`Title tag (${metaTitle.length}/60)`}>
                <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="Judul yang tampil di hasil pencarian" />
                <p className={cn("mt-0.5 text-[10px]", metaTitle.length >= 50 && metaTitle.length <= 60 ? "text-emerald-600" : "text-muted-foreground")}>
                  Idealnya 50–60 karakter
                </p>
              </FieldRow>

              <FieldRow label={`Meta description (${metaDesc.length}/160)`}>
                <Textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} rows={3}
                  placeholder="Deskripsi singkat yang muncul di hasil pencarian." />
                <p className={cn("mt-0.5 text-[10px]", metaDesc.length >= 120 && metaDesc.length <= 160 ? "text-emerald-600" : "text-muted-foreground")}>
                  Idealnya 120–160 karakter
                </p>
              </FieldRow>

              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium">Izinkan mesin pencari mengindeks halaman ini</p>
                  <p className="text-[10px] text-muted-foreground">Halaman dipublikasikan & terlihat di Google.</p>
                </div>
                <Switch checked={indexable} onCheckedChange={setIndexable} />
              </div>
            </div>
          )}

          {/* ── Advanced SEO ── */}
          {tab === "advanced" && (
            <div className="space-y-4">
              <FieldRow label="Kata kunci target">
                <Input value={targetKw} onChange={(e) => setTargetKw(e.target.value)}
                  placeholder="mis. penginapan wisuda unnes semarang" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Kata kunci utama yang ingin dirangking di Google.
                </p>
              </FieldRow>

              <FieldRow label="URL kanonik">
                <div className="flex items-center gap-1 rounded-md border border-input bg-muted px-3 py-2 text-sm">
                  <span className="text-muted-foreground">pomahguesthouse.com/lp/</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-stone-700">{page.slug}</span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  URL publik halaman ini (otomatis dari slug).
                </p>
              </FieldRow>

              {/* SEO checklist */}
              <div className="space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-stone-400">Checklist SEO</p>
                {[
                  { label: "Kata kunci di title tag",   ok: !!targetKw && metaTitle.toLowerCase().includes(targetKw.toLowerCase()) },
                  { label: "Kata kunci di meta desc",   ok: !!targetKw && metaDesc.toLowerCase().includes(targetKw.toLowerCase()) },
                  { label: "Title 50–60 karakter",      ok: metaTitle.length >= 50 && metaTitle.length <= 60 },
                  { label: "Meta desc 120–160 karakter",ok: metaDesc.length >= 120 && metaDesc.length <= 160 },
                  { label: "OG Image ada",              ok: !!ogImage },
                ].map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    {c.ok
                      ? <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                      : <X className="h-3 w-3 text-stone-300 shrink-0" />}
                    <span className={c.ok ? "text-stone-700" : "text-stone-400"}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Social Share ── */}
          {tab === "social" && (
            <div className="space-y-4">
              <FieldRow label="Gambar share (OG Image)">
                <ImageField value={ogImage} onChange={setOgImage} kind="image" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Gambar yang muncul saat halaman dibagikan di media sosial. Pilih dari Media Library.
                </p>
              </FieldRow>

              {/* Social card preview */}
              <div className="overflow-hidden rounded-lg border border-stone-200">
                <div className="flex h-36 items-center justify-center bg-stone-100">
                  {ogImage
                    ? <img src={ogImage} alt="" className="h-full w-full object-cover" />
                    : <Images className="h-6 w-6 text-stone-300" />}
                </div>
                <div className="bg-white px-3 py-2">
                  <p className="text-[10px] uppercase text-stone-400">pomahguesthouse.com</p>
                  <p className="truncate text-sm font-semibold text-stone-800">{metaTitle || page.title}</p>
                  <p className="line-clamp-2 text-xs text-stone-500">{metaDesc || "Meta description belum diisi…"}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Batal</Button>
          <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" disabled={saving} onClick={handleSave}>
            {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Menyimpan…</> : <><Save className="mr-1.5 h-3.5 w-3.5" />Simpan</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
