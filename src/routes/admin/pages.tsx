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
  MapPin,
  ListOrdered,
  GripVertical,
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
  Star,
  ExternalLink,
  Settings2,
  Home,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FileText,
  MessageSquare,
  Play,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
// useQuery already imported above; useMutation available if needed
import {
  listSeoLandingPages,
  createSeoLandingPage,
  updateSeoLandingPage,
  deleteSeoLandingPage,
  duplicateSeoLandingPage,
  duplicateSystemPageToLandingPage,
  type SeoLandingPage,
  type LPSection,
  type LPSectionsData,
} from "@/admin/modules/seo/landing-page.functions";
import { GlobalSettingsEditor } from "@/admin/modules/global/global-editor";
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
import { LAYER_MIN, LAYER_MAX, HOME_SECTION_LABELS } from "@/admin/modules/homepage/homepage.config";

export const Route = createFileRoute("/admin/pages")({
  component: HomepageBuilder,
});

const MEDIA_BUCKET = "room-images";
const MEDIA_PREFIX = "media";

type SectionKey = "header" | "hero" | "bookingHero" | "datepicker" | "badges" | "story" | "reviews" | "carousel" | "facilities" | "lokasi" | "news" | "cta" | "order";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "header",        label: "Header",       icon: LayoutPanelTop     },
  { key: "hero",          label: "Hero Slider",   icon: GalleryHorizontal  },
  { key: "bookingHero",   label: "Booking Hero",  icon: GalleryHorizontal  },
  { key: "datepicker",    label: "Date Picker",   icon: CalendarCheck      },
  { key: "badges",        label: "Ikon Fitur",    icon: Star               },
  { key: "story",         label: "Teks",          icon: Type               },
  { key: "reviews",       label: "Google Rating", icon: MessageSquare      },
  { key: "carousel",      label: "Our Room",      icon: RectangleHorizontal},
  { key: "facilities",    label: "Fasilitas",     icon: LayoutPanelTop     },
  { key: "lokasi",        label: "Lokasi",        icon: MapPin             },
  { key: "news",          label: "Berita",        icon: FileText           },
  { key: "cta",           label: "CTA Banner",    icon: Play               },
  { key: "order",         label: "Urutan",        icon: ListOrdered        },
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
  const pages = (lpQuery.data as { pages?: SeoLandingPage[] } | undefined)?.pages ?? [];

  const [section, setSection] = useState<SectionKey>("header");
  const [cfg, setCfg] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [activeMode, setActiveMode] = useState<"desktop" | "mobile">("desktop");

  // Active page in the Site Menu: "home" or a landing-page id.
  const [activePageId, setActivePageId] = useState<string>("home");
  const [activeMenuTab, setActiveMenuTab] = useState<"PAGES" | "GLOBAL">("PAGES");
  const activeLp = activePageId === "home" ? null : pages.find((p) => p.id === activePageId) ?? null;

  // Duplicate / Rename state
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SeoLandingPage | null>(null);

  // Sections of the active landing page (edited in the right panel).
  const [lpSections, setLpSections] = useState<LPSectionsData>([]);
  useEffect(() => {
    if (activeLp) setLpSections((activeLp.sections ?? []) as LPSectionsData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLp?.id]);

  // "Site Pages and Menu" modal (Wix-style).
  const [pagesOpen, setPagesOpen] = useState(false);
  const openPageSettings = (id: string) => { setActivePageId(id); setPagesOpen(true); };
  
  const activeName = activePageId === "home" ? "Home" : activePageId === "book" ? "Booking Page" : (activeLp?.title ?? "Home");
  const previewSrc = activeLp ? `/lp/${activeLp.slug}?builder=1` : activePageId === "book" ? "/book?builder=1" : "/?builder=1";

  // If the active LP vanished (deleted), fall back to home.
  useEffect(() => {
    if (activePageId !== "home" && activePageId !== "book" && !lpQuery.isLoading && !activeLp) setActivePageId("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpQuery.isLoading, activeLp, activePageId]);

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

  useEffect(() => {
    if (activePageId === "book" && !["header", "bookingHero"].includes(section)) {
      setSection("bookingHero");
    } else if (activePageId === "home" && section === "bookingHero") {
      setSection("hero");
    }
  }, [activePageId, section]);

  const save = async () => {
    setSaving(true);
    try {
      if (activeLp) {
        await updateSeoLandingPage({
          data: {
            id: activeLp.id,
            sections: lpSections ? (
              Array.isArray(lpSections) ? (lpSections.length > 0 ? lpSections : null) : lpSections
            ) : null
          },
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

  const handleDuplicatePage = async (p: SeoLandingPage) => {
    if (!confirm(`Duplikasi halaman "${p.title}"?`)) return;
    setDuplicating(p.id);
    try {
      const res = await duplicateSeoLandingPage({ data: { id: p.id } });
      await lpQuery.refetch();
      setActivePageId(res.id);
      toast.success("Halaman berhasil diduplikasi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDuplicating(null);
    }
  };

  const handleDuplicateSystemPage = async (type: "home" | "book") => {
    const label = type === "home" ? "Home" : "Booking Page";
    if (!confirm(`Duplikasi halaman "${label}" menghasilkan landing page baru?`)) return;
    setDuplicating(type);
    try {
      const res = await duplicateSystemPageToLandingPage({ data: { type } });
      await lpQuery.refetch();
      setActivePageId(res.id);
      toast.success("Halaman berhasil diduplikasi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDuplicating(null);
    }
  };

  const handleRenamePage = async (p: SeoLandingPage, newTitle: string, newSlug: string) => {
    try {
      await updateSeoLandingPage({ data: { id: p.id, title: newTitle, slug: newSlug } });
      await lpQuery.refetch();
      toast.success("Halaman diperbarui.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const visibleSections = activePageId === "book" 
    ? SECTIONS.filter(s => ["header", "bookingHero"].includes(s.key))
    : SECTIONS.filter(s => s.key !== "bookingHero");

  const active = visibleSections.find((s) => s.key === section) || visibleSections[0];

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
          {/* Page selector — opens the "Site Pages and Menu" modal */}
          <div className="ml-4 flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Page:</span>
            <button
              type="button"
              onClick={() => { setPagesOpen(true); }}
              className="flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              {activeName}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* View Mode Toggle (Desktop / Mobile) */}
          <div className="ml-4 flex items-center rounded-md border border-input bg-background p-0.5">
            <button
              type="button"
              onClick={() => setActiveMode("desktop")}
              className={cn(
                "rounded-sm px-3 py-1.5 text-xs font-medium transition",
                activeMode === "desktop" ? "bg-stone-200 text-stone-900 shadow-sm" : "text-muted-foreground hover:bg-stone-100 hover:text-foreground"
              )}
            >
              Desktop
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("mobile")}
              className={cn(
                "rounded-sm px-3 py-1.5 text-xs font-medium transition",
                activeMode === "mobile" ? "bg-stone-200 text-stone-900 shadow-sm" : "text-muted-foreground hover:bg-stone-100 hover:text-foreground"
              )}
            >
              Mobile
            </button>
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
          activeMenuTab={activeMenuTab}
          onMenuTabChange={setActiveMenuTab}
          pages={pages}
          activePageId={activePageId}
          onSelect={setActivePageId}
          onAdd={handleAddPage}
          onDelete={handleDeletePage}
          onDuplicate={handleDuplicatePage}
          onDuplicateSystem={handleDuplicateSystemPage}
          onRename={(p) => setRenameTarget(p)}
          onSeo={(id) => openPageSettings(id)}
          duplicatingId={duplicating}
        />

        {/* ── Centre: live preview ── */}
        <div className="flex flex-1 items-center justify-center overflow-auto p-6 bg-stone-100">
          <div
            className={cn(
              "transition-all duration-300 overflow-hidden shadow-xl border border-border bg-white relative",
              activeMode === "mobile"
                ? "w-[390px] h-[800px] border-[12px] border-stone-850 rounded-[36px]"
                : "w-full max-w-5xl rounded-xl"
            )}
          >
            {activeMode === "mobile" && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-6 bg-stone-850 rounded-full z-50 flex items-center justify-center">
                <div className="w-12 h-1 bg-stone-700 rounded-full" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              key={`${previewKey}-${previewSrc}-${activeMode}`}
              title="Preview"
              src={previewSrc}
              className={cn(
                "w-full transition-all duration-300",
                activeMode === "mobile" 
                  ? "h-[776px] pt-4" 
                  : "h-[calc(100vh-9rem)]"
              )}
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
                  onClick={() => openPageSettings(activeLp.id)}>
                  <Settings2 className="h-3.5 w-3.5" /> SEO
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <LpPageBuilder sections={lpSections} onChange={setLpSections} activeMode={activeMode} setActiveMode={setActiveMode} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Edit — {active.label}</p>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
                  onClick={() => openPageSettings(activePageId === "book" ? "book" : "home")}>
                  <Settings2 className="h-3.5 w-3.5" /> SEO
                </Button>
              </div>
              <SectionSlider
                sections={visibleSections}
                active={section}
                onSelect={(k) => setSection(k)}
              />
              {sectionSupportsLayout(section) && (
                <SectionLayoutControls section={section} cfg={cfg} setCfg={setCfg} />
              )}
              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <p className="p-6 text-sm text-muted-foreground">Memuat…</p>
                ) : section === "header" ? (
                  <HeaderTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "hero" ? (
                  <HeroTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "bookingHero" ? (
                  <HeroTab cfg={cfg} setCfg={setCfg} isBooking activeMode={activeMode} />
                ) : section === "datepicker" ? (
                  <DatePickerTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "badges" ? (
                  <BadgesTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "story" ? (
                  <StoryTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "reviews" ? (
                  <ReviewsTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "facilities" ? (
                  <FacilitiesTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "lokasi" ? (
                  <LokasiTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "news" ? (
                  <NewsTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "cta" ? (
                  <CtaTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : section === "order" ? (
                  <OrderTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                ) : (
                  <CarouselTab cfg={cfg} setCfg={setCfg} activeMode={activeMode} />
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* "Site Pages and Menu" modal (Wix-style) */}
      <SitePagesModal
        open={pagesOpen}
        onClose={() => setPagesOpen(false)}
        pages={pages}
        activePageId={activePageId}
        settingsPageId={null}
        onSettingsPage={() => {}}
        onSelect={(id) => { setActivePageId(id); setPreviewKey((k) => k + 1); }}
        onAdd={handleAddPage}
        onDelete={handleDeletePage}
        onDuplicate={handleDuplicatePage}
        onDuplicateSystem={handleDuplicateSystemPage}
        onRename={(p) => setRenameTarget(p)}
        onSaved={() => { lpQuery.refetch(); setPreviewKey((k) => k + 1); }}
        homeCfg={cfg}
        propertyId={data?.id ?? null}
        duplicatingId={duplicating}
      />

      {/* Rename Dialog */}
      {renameTarget && (
        <RenamePageDialog
          page={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSave={async (title, slug) => {
            await handleRenamePage(renameTarget, title, slug);
            setRenameTarget(null);
          }}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* Shared building blocks                                             */
/* ================================================================== */

type TabProps = {
  cfg: HomepageConfig;
  setCfg: React.Dispatch<React.SetStateAction<HomepageConfig>>;
  activeMode?: "desktop" | "mobile";
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
  family: "sans" | "serif" | "mono" | "brother-signature";
  style: "normal" | "bold" | "italic";
  size: number;
  minSize?: number;
  maxSize?: number;
  onFamilyChange: (f: "sans" | "serif" | "mono" | "brother-signature") => void;
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
          <option value="brother-signature">Brother Signature ✍️</option>
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
/* Section navigator (horizontal scroll/slider, no longer stacks)      */
/* ================================================================== */

function SectionSlider({
  sections,
  active,
  onSelect,
}: {
  sections: { key: SectionKey; label: string; icon: React.ComponentType<{ className?: string }> }[];
  active: SectionKey;
  onSelect: (k: SectionKey) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scroll = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };

  // Keep the active tab visible after a programmatic change.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLButtonElement>(
      `button[data-section="${active}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [active]);

  return (
    <div className="relative flex items-center border-b border-border bg-background">
      <button
        type="button"
        aria-label="Geser kiri"
        onClick={() => scroll(-1)}
        className="z-10 flex h-9 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={scrollRef}
        className="flex flex-1 gap-1 overflow-x-auto scroll-smooth py-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <style>{`.pb-section-row::-webkit-scrollbar { display: none; }`}</style>
        {sections.map((s) => (
          <button
            key={s.key}
            data-section={s.key}
            onClick={() => onSelect(s.key)}
            title={s.label}
            className={cn(
              "shrink-0 flex w-[64px] flex-col items-center gap-1 rounded-md py-2 px-1 transition",
              active === s.key
                ? "bg-teal-50 text-teal-900"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <s.icon className="h-4 w-4" />
            <span className="text-[8px] font-medium uppercase tracking-wide leading-tight text-center">
              {s.label}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="Geser kanan"
        onClick={() => scroll(1)}
        className="z-10 flex h-9 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ================================================================== */
/* Per-section layout controls (text-align + paddings)                 */
/* ================================================================== */

/** Sections that get the inline layout controls panel. Excludes "order"
 *  (it's the section-order editor, not a content section). */
function sectionSupportsLayout(key: SectionKey): boolean {
  return key !== "order";
}

function SectionLayoutControls({
  section,
  cfg,
  setCfg,
}: {
  section: SectionKey;
  cfg: HomepageConfig;
  setCfg: React.Dispatch<React.SetStateAction<HomepageConfig>>;
}) {
  const id = section as string;
  const layout = (cfg.sectionLayouts ?? {})[id] ?? {};
  const update = (patch: Partial<NonNullable<HomepageConfig["sectionLayouts"]>[string]>) => {
    setCfg((c) => ({
      ...c,
      sectionLayouts: {
        ...(c.sectionLayouts ?? {}),
        [id]: { ...((c.sectionLayouts ?? {})[id] ?? {}), ...patch },
      },
    }));
  };

  const Align = ({
    val,
    icon: Icon,
    label,
  }: {
    val: "left" | "center" | "right";
    icon: React.ComponentType<{ className?: string }>;
    label: string;
  }) => (
    <button
      type="button"
      title={label}
      onClick={() => update({ textAlign: val })}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md border transition",
        layout.textAlign === val
          ? "border-teal-600 bg-teal-50 text-teal-800"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );

  return (
    <div className="border-b border-border bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Align
          </span>
          <Align val="left" icon={AlignLeft} label="Kiri" />
          <Align val="center" icon={AlignCenter} label="Tengah" />
          <Align val="right" icon={AlignRight} label="Kanan" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Padding atas
          </label>
          <input
            type="number"
            min={0}
            max={400}
            value={layout.paddingTop ?? ""}
            placeholder="auto"
            onChange={(e) =>
              update({
                paddingTop: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
              })
            }
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
          />
          <span className="text-[10px] text-muted-foreground">px</span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Padding bawah
          </label>
          <input
            type="number"
            min={0}
            max={400}
            value={layout.paddingBottom ?? ""}
            placeholder="auto"
            onChange={(e) =>
              update({
                paddingBottom:
                  e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
              })
            }
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
          />
          <span className="text-[10px] text-muted-foreground">px</span>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Background
          </label>
          <input
            type="color"
            value={layout.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(layout.backgroundColor)
              ? layout.backgroundColor
              : "#ffffff"}
            onChange={(e) => update({ backgroundColor: e.target.value })}
            className="h-8 w-8 cursor-pointer rounded-md border border-input bg-background p-0.5"
            title="Pilih warna"
          />
          <input
            type="text"
            value={layout.backgroundColor ?? ""}
            placeholder="auto"
            onChange={(e) =>
              update({ backgroundColor: e.target.value.trim() || undefined })
            }
            className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs font-mono"
          />
          {layout.backgroundColor && (
            <button
              type="button"
              onClick={() => update({ backgroundColor: undefined })}
              className="text-[11px] text-muted-foreground hover:text-foreground"
              title="Hapus warna"
            >
              ×
            </button>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={layout.uppercase === true}
            onChange={(e) => update({ uppercase: e.target.checked ? true : undefined })}
            className="h-4 w-4 cursor-pointer accent-teal-700"
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            CAPSLOCK
          </span>
        </label>
        {(layout.textAlign ||
          layout.paddingTop != null ||
          layout.paddingBottom != null ||
          layout.backgroundColor ||
          layout.uppercase) && (
          <button
            type="button"
            onClick={() =>
              setCfg((c) => {
                const next = { ...(c.sectionLayouts ?? {}) };
                delete next[id];
                return { ...c, sectionLayouts: next };
              })
            }
            className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset
          </button>
        )}
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
      desc="Pilih gaya header, lalu sesuaikan warna, tombol, dan menu navigasi."
    >
      <div className="space-y-2">
        <Label className="text-xs font-medium">Gaya header</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "pill", label: "Pill mengambang", desc: "Kapsul putih di atas hero" },
              { key: "transparent", label: "Transparan", desc: "Menyatu di atas hero" },
              { key: "solid", label: "Bar solid", desc: "Bar berwarna, tidak menumpuk" },
              { key: "minimal", label: "Minimal", desc: "Bar putih, teks gelap" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => set({ style: opt.key })}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                (header.style ?? "pill") === opt.key
                  ? "border-teal-500 bg-teal-50 ring-1 ring-teal-500"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <p className="text-sm font-semibold">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Pill &amp; Transparan menumpuk di atas hero; Solid &amp; Minimal mengambil ruang sendiri.
        </p>
      </div>

      <FieldRow label="Warna latar header (untuk gaya Bar solid)">
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

function HeroTab({ cfg, setCfg, isBooking, activeMode }: TabProps & { isBooking?: boolean }) {
  const heroKey = isBooking ? "bookingHero" : "hero";
  const hero = cfg[heroKey];
  const set = (patch: Partial<HomepageConfig["hero"]>) =>
    setCfg((c) => ({ ...c, [heroKey]: { ...c[heroKey], ...patch } }));
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

      {!isBooking && (
        <FieldRow label="Aksen judul (script emas di bawah judul)">
          <Input
            value={hero.accent}
            placeholder='mis. "di Semarang"'
            onChange={(e) => set({ accent: e.target.value })}
          />
        </FieldRow>
      )}

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

      <FieldRow label="Perataan teks (justify)">
        <div className="grid grid-cols-3 gap-2">
          {(["left", "center", "right"] as const).map((al) => (
            <button
              key={al}
              type="button"
              onClick={() => set({ textAlign: al })}
              className={cn(
                "rounded-md border px-3 py-2 text-xs font-medium capitalize transition",
                hero.textAlign === al
                  ? "border-teal-500 bg-teal-50 text-teal-800"
                  : "border-input bg-background hover:bg-muted",
              )}
            >
              {al === "left" ? "Kiri" : al === "center" ? "Tengah" : "Kanan"}
            </button>
          ))}
        </div>
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
        size={activeMode === "mobile" ? (hero.fontSizeMobile ?? 32) : hero.fontSize}
        minSize={16}
        maxSize={96}
        onFamilyChange={(v) => set({ fontFamily: v })}
        onStyleChange={(v) => set({ fontStyle: v })}
        onSizeChange={(v) => activeMode === "mobile" ? set({ fontSizeMobile: v }) : set({ fontSize: v })}
      />

      <FieldRow label="Warna Judul">
        <ColorField value={hero.color || "#ffffff"} onChange={(v) => set({ color: v })} />
      </FieldRow>

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
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Logo (opsional)</Label>
        <ImageField value={dp.logoUrl ?? ""} onChange={(url) => set({ logoUrl: url })} />
      </div>

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

      <FieldRow label="Warna Judul">
        <ColorField value={dp.color || "#7c4a21"} onChange={(v) => set({ color: v })} />
      </FieldRow>

      <LayerArrange value={dp.layer} onChange={(v) => set({ layer: v })} />
    </Section>
  );
}

function BadgesTab({ cfg, setCfg }: TabProps) {
  const badges = cfg.badges;
  const set = (patch: Partial<HomepageConfig["badges"]>) =>
    setCfg((c) => ({ ...c, badges: { ...c.badges, ...patch } }));

  const setItems = (items: HomepageConfig["badges"]["items"]) => set({ items });

  return (
    <Section title="Ikon Fitur" desc="Judul dan daftar ikon fitur (trust badges).">
      <FieldRow label="Judul Section">
        <Input value={badges.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>

      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={badges.fontFamily}
          style={badges.fontStyle}
          size={badges.fontSize}
          minSize={16}
          maxSize={48}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={badges.color || "#7c4a21"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>

      <div className="space-y-4 pt-2 border-t border-border mt-4">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Daftar Fitur</Label>
        {badges.items.map((item, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Fitur {String(i + 1).padStart(2, "0")}
              </span>
              {badges.items.length > 1 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive"
                  onClick={() => setItems(badges.items.filter((_, x) => x !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            
            <FieldRow label="Pilih Ikon">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={item.iconName}
                onChange={(e) =>
                  setItems(
                    badges.items.map((x, j) => (j === i ? { ...x, iconName: e.target.value } : x))
                  )
                }
              >
                <option value="Star">Bintang (Star)</option>
                <option value="BedDouble">Kamar Tidur (BedDouble)</option>
                <option value="Users">Keluarga/Grup (Users)</option>
                <option value="MapPin">Peta (MapPin)</option>
                <option value="Headphones">Layanan Pelanggan (Headphones)</option>
                <option value="Wifi">Wifi</option>
                <option value="Coffee">Cafe (Coffee)</option>
                <option value="Car">Parkir (Car)</option>
                <option value="custom">Kustom dari Media Library</option>
              </select>
            </FieldRow>

            {item.iconName === "custom" && (
              <FieldRow label="Gambar Ikon (Media Library)">
                <ImageField
                  value={item.iconUrl || ""}
                  onChange={(url) =>
                    setItems(
                      badges.items.map((x, j) => (j === i ? { ...x, iconUrl: url } : x))
                    )
                  }
                />
              </FieldRow>
            )}

            <FieldRow label="Nama Fitur">
              <Input
                value={item.title}
                onChange={(e) =>
                  setItems(
                    badges.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                  )
                }
              />
            </FieldRow>

            <FieldRow label="Deskripsi">
              <Input
                value={item.desc}
                onChange={(e) =>
                  setItems(
                    badges.items.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x))
                  )
                }
              />
            </FieldRow>
          </div>
        ))}

        {badges.items.length < 10 && (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
            onClick={() =>
              setItems([...badges.items, { iconName: "Star", title: "Fitur Baru", desc: "Deskripsi singkat" }])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah Fitur
          </Button>
        )}
      </div>
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
      <div className="border-t border-border my-4 pt-4 space-y-4">
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
        <FieldRow label="Warna Judul">
          <ColorField value={story.color || "#1c1917"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
    </Section>
  );
}

function OrderTab({ cfg, setCfg }: TabProps) {
  const order = cfg.sectionOrder;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCfg((c) => ({ ...c, sectionOrder: next }));
  };

  return (
    <Section
      title="Urutan Section"
      desc="Seret kartu untuk mengubah urutan tampil di halaman depan. Hero, date picker, dan footer tetap di posisinya."
    >
      <div className="space-y-2">
        {order.map((key, i) => (
          <div
            key={key}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (overIdx !== i) setOverIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null) reorder(dragIdx, i);
              setDragIdx(null);
              setOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setOverIdx(null);
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2.5 transition cursor-grab active:cursor-grabbing",
              dragIdx === i
                ? "border-teal-400 bg-teal-50/60 opacity-60"
                : overIdx === i
                  ? "border-teal-400 bg-teal-50/40"
                  : "border-border bg-background",
            )}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {i + 1}. {HOME_SECTION_LABELS[key]}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function LokasiTab({ cfg, setCfg }: TabProps) {
  const lok = cfg.lokasi;
  const set = (patch: Partial<HomepageConfig["lokasi"]>) =>
    setCfg((c) => ({ ...c, lokasi: { ...c.lokasi, ...patch } }));
  const setNearby = (nearby: HomepageConfig["lokasi"]["nearby"]) => set({ nearby });

  return (
    <Section title="Lokasi Kami" desc="Judul, deskripsi, dan daftar lokasi terdekat. Peta mengikuti alamat properti.">
      <FieldRow label="Judul section">
        <Input value={lok.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={lok.fontFamily || "serif"}
          style={lok.fontStyle || "bold"}
          size={lok.fontSize || 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={lok.color || "#7c4a21"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
      <FieldRow label="Teks di bawah judul">
        <Textarea
          rows={2}
          value={lok.subheading}
          onChange={(e) => set({ subheading: e.target.value })}
        />
      </FieldRow>
      <FieldRow label="Judul kartu lokasi terdekat">
        <Input value={lok.nearbyTitle} onChange={(e) => set({ nearbyTitle: e.target.value })} />
      </FieldRow>

      <div className="space-y-3">
        <Label className="text-xs font-medium">Daftar lokasi terdekat</Label>
        {lok.nearby.map((n, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Lokasi {String(i + 1).padStart(2, "0")}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-destructive"
                onClick={() => setNearby(lok.nearby.filter((_, x) => x !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Nama lokasi"
                value={n.name}
                onChange={(e) => setNearby(lok.nearby.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                placeholder="Tipe (mis. Universitas)"
                value={n.type}
                onChange={(e) => setNearby(lok.nearby.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Jarak (mis. 8 km)"
                value={n.distance}
                onChange={(e) => setNearby(lok.nearby.map((x, j) => (j === i ? { ...x, distance: e.target.value } : x)))}
              />
              <Input
                placeholder="Waktu (mis. ~13 menit)"
                value={n.time}
                onChange={(e) => setNearby(lok.nearby.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
              />
            </div>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setNearby([...lok.nearby, { name: "", type: "", distance: "", time: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Tambah lokasi
        </Button>
      </div>
    </Section>
  );
}

function FacilitiesTab({ cfg, setCfg }: TabProps) {
  const fac = cfg.facilities;
  const set = (patch: Partial<HomepageConfig["facilities"]>) =>
    setCfg((c) => ({ ...c, facilities: { ...c.facilities, ...patch } }));
  return (
    <Section title="Fasilitas" desc="Ubah judul dan teks penjelasan bagian fasilitas.">
      <FieldRow label="Judul Section">
        <Input value={fac.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <FieldRow label="Deskripsi">
        <Textarea
          rows={2}
          value={fac.subheading}
          onChange={(e) => set({ subheading: e.target.value })}
        />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={fac.fontFamily || "serif"}
          style={fac.fontStyle || "bold"}
          size={fac.fontSize || 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={fac.color || "#1c1917"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
    </Section>
  );
}

function NewsTab({ cfg, setCfg }: TabProps) {
  const news = cfg.news;
  const set = (patch: Partial<HomepageConfig["news"]>) =>
    setCfg((c) => ({ ...c, news: { ...c.news, ...patch } }));
  return (
    <Section title="Berita & Acara" desc="Ubah judul dan teks penjelasan bagian Berita & Event.">
      <FieldRow label="Judul Section">
        <Input value={news.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <FieldRow label="Deskripsi">
        <Textarea
          rows={2}
          value={news.subheading}
          onChange={(e) => set({ subheading: e.target.value })}
        />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={news.fontFamily || "serif"}
          style={news.fontStyle || "bold"}
          size={news.fontSize || 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={news.color || "#1c1917"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
    </Section>
  );
}

function ReviewsTab({ cfg, setCfg }: TabProps) {
  const rev = cfg.reviews;
  const set = (patch: Partial<HomepageConfig["reviews"]>) =>
    setCfg((c) => ({ ...c, reviews: { ...c.reviews, ...patch } }));
  return (
    <Section title="Google Rating & Ulasan" desc="Ubah judul dan gaya font bagian ulasan Google.">
      <FieldRow label="Judul Section">
        <Input value={rev.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={rev.fontFamily || "serif"}
          style={rev.fontStyle || "bold"}
          size={rev.fontSize || 32}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={rev.color || "#1c1917"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
    </Section>
  );
}

function CtaTab({ cfg, setCfg }: TabProps) {
  const cta = cfg.cta;
  const set = (patch: Partial<HomepageConfig["cta"]>) =>
    setCfg((c) => ({ ...c, cta: { ...c.cta, ...patch } }));
  return (
    <Section title="CTA Banner" desc="Ubah judul banner ajakan bertindak (CTA).">
      <FieldRow label="Judul Section">
        <Input value={cta.heading} onChange={(e) => set({ heading: e.target.value })} />
      </FieldRow>
      <div className="border-t border-border my-4 pt-4 space-y-4">
        <FontStyleFields
          family={cta.fontFamily || "serif"}
          style={cta.fontStyle || "bold"}
          size={cta.fontSize || 30}
          minSize={16}
          maxSize={72}
          onFamilyChange={(v) => set({ fontFamily: v })}
          onStyleChange={(v) => set({ fontStyle: v })}
          onSizeChange={(v) => set({ fontSize: v })}
        />
        <FieldRow label="Warna Judul">
          <ColorField value={cta.color || "#ffffff"} onChange={(v) => set({ color: v })} />
        </FieldRow>
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
      <div className="border-t border-border my-4 pt-4 space-y-4">
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
        <FieldRow label="Warna Judul">
          <ColorField value={rc.color || "#7c4a21"} onChange={(v) => set({ color: v })} />
        </FieldRow>
      </div>
      <LayerArrange value={rc.layer} onChange={(v) => set({ layer: v })} />
    </Section>
  );
}

/* ================================================================== */
/* 6. Landing Pages Tab                                                */
/* ================================================================== */

/** Rename Page Dialog — lets the user update a page's title and slug. */
function RenamePageDialog({
  page,
  onClose,
  onSave,
}: {
  page: SeoLandingPage;
  onClose: () => void;
  onSave: (title: string, slug: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [saving, setSaving] = useState(false);

  const handleSlugFromTitle = (t: string) => {
    const s = t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
    setSlug(s);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename Halaman</DialogTitle>
          <DialogDescription>Ubah judul dan slug URL halaman ini.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Judul Halaman</Label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); handleSlugFromTitle(e.target.value); }}
              placeholder="Judul halaman"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Slug URL</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="slug-halaman"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">/lp/{slug}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button
            onClick={async () => {
              if (!title.trim() || !slug.trim()) return;
              setSaving(true);
              await onSave(title.trim(), slug.trim());
              setSaving(false);
            }}
            disabled={saving || !title.trim() || !slug.trim()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Site Menu — Wix-style left sidebar listing all editable pages
 * (Home + landing pages). Each landing page row has a dropdown menu
 * with Edit/SEO, Duplicate, Rename, and Delete actions.
 */
function SiteMenu({
  activeMenuTab,
  onMenuTabChange,
  pages,
  activePageId,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  onDuplicateSystem,
  onRename,
  onSeo,
  duplicatingId,
}: {
  activeMenuTab: "PAGES" | "GLOBAL";
  onMenuTabChange: (tab: "PAGES" | "GLOBAL") => void;
  pages: SeoLandingPage[];
  activePageId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (p: SeoLandingPage) => void;
  onDuplicate: (p: SeoLandingPage) => void;
  onDuplicateSystem: (type: "home" | "book") => void;
  onRename: (p: SeoLandingPage) => void;
  onSeo: (id: string) => void;
  duplicatingId: string | null;
}) {
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const filtered = pages.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex p-2 bg-stone-100 border-b border-border">
        <button 
          onClick={() => onMenuTabChange("GLOBAL")}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition ${activeMenuTab === "GLOBAL" ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"}`}>
          GLOBAL
        </button>
        <button 
          onClick={() => onMenuTabChange("PAGES")}
          className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition ${activeMenuTab === "PAGES" ? "bg-white shadow-sm text-stone-900" : "text-stone-500 hover:text-stone-700"}`}>
          PAGES
        </button>
      </div>

      {activeMenuTab === "PAGES" && (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Site Menu</p>
          <button type="button" onClick={onAdd}
            className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900">
            <Plus className="h-3.5 w-3.5" /> Add Page
          </button>
        </div>
      )}
      
      {activeMenuTab === "GLOBAL" && (
        <>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Global Sections</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-header" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-header")}>
            <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Header</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-footer" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-footer")}>
            <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Footer</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-whatsapp" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-whatsapp")}>
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">WhatsApp Float</span>
          </div>
          <div
            className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition", activePageId === "global-cookie" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted")}
            onClick={() => onSelect("global-cookie")}>
            <Check className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Cookie Banner</span>
          </div>
        </div>
        </>
      )}

      {activeMenuTab === "PAGES" && (
      <>
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari halaman…" className="h-7 pl-7 text-xs" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Home — present, can duplicate */}
        <div className="relative">
          <div
            className={cn(
              "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition",
              activePageId === "home" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
            )}
            onClick={() => { setOpenMenuId(null); onSelect("home"); }}>
            <Home className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Home</span>
            {duplicatingId === "home" && <Loader2 className="h-3 w-3 animate-spin text-teal-600" />}
            <button
              type="button"
              title="Opsi halaman"
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === "home" ? null : "home"); }}
              className="rounded p-0.5 text-stone-400 hover:text-stone-700 opacity-0 group-hover:opacity-100 transition">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Dropdown menu */}
          {openMenuId === "home" && (
            <div
              className="absolute right-1 top-8 z-50 w-44 rounded-lg border border-border bg-white py-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}>
              <button type="button"
                onClick={() => { setOpenMenuId(null); onSeo("home"); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted">
                <Settings2 className="h-3.5 w-3.5" /> Edit / SEO
              </button>
              <button type="button"
                onClick={() => { setOpenMenuId(null); onDuplicateSystem("home"); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted"
                disabled={!!duplicatingId}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
            </div>
          )}
        </div>

        {/* Booking Page */}
        <div className="relative">
          <div
            className={cn(
              "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition",
              activePageId === "book" ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
            )}
            onClick={() => { setOpenMenuId(null); onSelect("book"); }}>
            <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />
            <span className="flex-1 truncate text-xs font-medium text-stone-700">Booking Page</span>
            {duplicatingId === "book" && <Loader2 className="h-3 w-3 animate-spin text-teal-600" />}
            <button
              type="button"
              title="Opsi halaman"
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === "book" ? null : "book"); }}
              className="rounded p-0.5 text-stone-400 hover:text-stone-700 opacity-0 group-hover:opacity-100 transition">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Dropdown menu */}
          {openMenuId === "book" && (
            <div
              className="absolute right-1 top-8 z-50 w-44 rounded-lg border border-border bg-white py-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}>
              <button type="button"
                onClick={() => { setOpenMenuId(null); onSeo("book"); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted">
                <Settings2 className="h-3.5 w-3.5" /> Edit / SEO
              </button>
              <button type="button"
                onClick={() => { setOpenMenuId(null); onDuplicateSystem("book"); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted"
                disabled={!!duplicatingId}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
            </div>
          )}
        </div>

        {/* Landing pages */}
        {filtered.map((p) => (
          <div key={p.id} className="relative">
            <div
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition",
                activePageId === p.id ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
              )}
              onClick={() => { setOpenMenuId(null); onSelect(p.id); }}>
              <Globe className={cn("h-3.5 w-3.5 shrink-0", p.published ? "text-emerald-500" : "text-stone-300")} />
              <span className="flex-1 truncate text-xs font-medium text-stone-700">{p.title}</span>
              {duplicatingId === p.id && <Loader2 className="h-3 w-3 animate-spin text-teal-600" />}
              <button
                type="button"
                title="Opsi halaman"
                onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === p.id ? null : p.id); }}
                className="rounded p-0.5 text-stone-400 hover:text-stone-700 opacity-0 group-hover:opacity-100 transition">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Dropdown menu */}
            {openMenuId === p.id && (
              <div
                className="absolute right-1 top-8 z-50 w-44 rounded-lg border border-border bg-white py-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}>
                <button type="button"
                  onClick={() => { setOpenMenuId(null); onSeo(p.id); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted">
                  <Settings2 className="h-3.5 w-3.5" /> Edit / SEO
                </button>
                <button type="button"
                  onClick={() => { setOpenMenuId(null); onDuplicate(p); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted"
                  disabled={duplicatingId === p.id}>
                  <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <button type="button"
                  onClick={() => { setOpenMenuId(null); onRename(p); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted">
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </button>
                <div className="my-1 border-t border-stone-100" />
                <button type="button"
                  onClick={() => { setOpenMenuId(null); onDelete(p); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {pages.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground italic">
            Belum ada halaman tambahan.
          </p>
        )}
      </div>
      </>
      )}
    </aside>
  );
}

/**
 * Page Settings panel — Wix-style "Page Settings (name)" with four tabs:
 * Access · SEO basics · Advanced SEO · Social share. Operates on one
 * landing page and saves its SEO/meta fields. Rendered inside SitePagesModal.
 */
type PageSettingsTab = "access" | "basics" | "advanced" | "social";

/** Settings target: a landing page, or the Home page (homepage_config). */
type SettingsTarget =
  | { kind: "lp"; page: SeoLandingPage }
  | { kind: "home"; cfg: HomepageConfig; propertyId: string | null }
  | { kind: "book"; cfg: HomepageConfig; propertyId: string | null };

function PageSettingsPanel({
  target,
  onSaved,
  onClose,
}: {
  target: SettingsTarget;
  onSaved: () => void;
  onClose: () => void;
}) {
  const isHome = target.kind === "home";
  const isBook = target.kind === "book";
  const isFixedPage = isHome || isBook;
  const pageTitle = isHome ? "Home" : isBook ? "Booking Page" : target.page.title;
  const pageSlug = isHome ? "" : isBook ? "book" : target.page.slug;
  const targetKey = isHome ? "home" : isBook ? "book" : target.page.id;

  const [tab, setTab] = useState<PageSettingsTab>("access");
  const [saving, setSaving] = useState(false);

  const [slug, setSlug]           = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc]   = useState("");
  const [targetKw, setTargetKw]   = useState("");
  const [ogImage, setOgImage]     = useState("");
  const [indexable, setIndexable] = useState(true);
  const [customHead, setCustomHead]   = useState("");
  const [customRobots, setCustomRobots] = useState("");
  const [jsonLdOn, setJsonLdOn]       = useState(true);
  const [customJsonLd, setCustomJsonLd] = useState("");

  useEffect(() => {
    if (target.kind === "home" || target.kind === "book") {
      const s = target.kind === "book" ? target.cfg.bookingSeo : target.cfg.seo;
      setSlug("");
      setMetaTitle(s.metaTitle ?? "");
      setMetaDesc(s.metaDescription ?? "");
      setTargetKw(s.targetKeyword ?? "");
      setOgImage(s.ogImageUrl ?? "");
      setIndexable(true);
      setCustomHead(s.customHead ?? "");
      setCustomRobots(s.customRobots ?? "");
      setJsonLdOn(s.jsonLdEnabled ?? true);
      setCustomJsonLd(s.customJsonLd ?? "");
    } else {
      const page = target.page;
      setSlug(page.slug ?? "");
      setMetaTitle(page.meta_title ?? "");
      setMetaDesc(page.meta_description ?? "");
      setTargetKw(page.target_keyword ?? "");
      setOgImage(page.og_image_url ?? "");
      setIndexable(page.published);
      setCustomHead(page.custom_head ?? "");
      setCustomRobots(page.custom_robots ?? "");
      setJsonLdOn(page.json_ld_enabled ?? true);
      setCustomJsonLd(page.custom_json_ld ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (target.kind === "home" || target.kind === "book") {
        if (!target.propertyId) { toast.error("Properti belum tersedia."); setSaving(false); return; }
        
        const newSeo = {
          metaTitle: metaTitle, metaDescription: metaDesc, targetKeyword: targetKw,
          ogImageUrl: ogImage, customHead, customRobots,
          jsonLdEnabled: jsonLdOn, customJsonLd,
        };
        
        await updateHomepageConfig({
          data: {
            id: target.propertyId,
            config: {
              ...target.cfg,
              ...(target.kind === "book" ? { bookingSeo: newSeo } : { seo: newSeo }),
            } as unknown as Record<string, unknown>,
          },
        });
      } else {
        const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (!cleanSlug) { toast.error("URL halaman (slug) tidak boleh kosong"); setSaving(false); return; }
        await updateSeoLandingPage({
          data: {
            id: target.page.id,
            slug:             cleanSlug,
            meta_title:       metaTitle || null,
            meta_description: metaDesc  || null,
            target_keyword:   targetKw  || null,
            og_image_url:     ogImage   || null,
            published:        indexable,
            custom_head:      customHead   || null,
            custom_robots:    customRobots || null,
            json_ld_enabled:  jsonLdOn,
            custom_json_ld:   customJsonLd || null,
          },
        });
      }
      toast.success("Pengaturan halaman tersimpan");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: PageSettingsTab; label: string }[] = [
    { key: "access",   label: "Access"       },
    { key: "basics",   label: "SEO basics"   },
    { key: "advanced", label: "Advanced SEO" },
    { key: "social",   label: "Social share" },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
        <p className="truncate text-sm font-semibold">Page Settings ({pageTitle})</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-stone-200 px-3">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium transition",
              tab === t.key ? "border-b-2 border-teal-600 text-teal-700" : "text-muted-foreground hover:text-foreground",
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* ── Access ── */}
        {tab === "access" && (
          <div className="space-y-4">
            {isFixedPage ? (
              <>
                <FieldRow label="URL halaman">
                  <div className="flex items-center gap-1 rounded-md border border-input bg-muted px-3 py-2 text-sm">
                    <span className="font-mono text-stone-700">pomahguesthouse.com/{isBook ? "book" : ""}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">URL halaman {isBook ? "booking" : "depan"} tidak dapat diubah.</p>
                </FieldRow>
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                  <p className="text-xs font-medium">Halaman selalu publik</p>
                  <p className="text-[10px] text-muted-foreground">Halaman {isBook ? "booking" : "depan"} selalu dapat diakses & diindeks.</p>
                </div>
                <a href={isBook ? "/book" : "/"} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Buka halaman di tab baru
                </a>
              </>
            ) : (
              <>
                <FieldRow label="URL halaman">
                  <div className="flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1 text-sm focus-within:ring-2 focus-within:ring-ring">
                    <span className="shrink-0 text-muted-foreground">pomahguesthouse.com/lp/</span>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      placeholder="slug-halaman"
                      className="min-w-0 flex-1 bg-transparent py-1 font-mono text-stone-800 focus:outline-none"
                    />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Hanya huruf kecil, angka, dan tanda hubung. Mengubah URL dapat memengaruhi tautan lama.
                  </p>
                </FieldRow>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="text-xs font-medium">Halaman dipublikasikan</p>
                    <p className="text-[10px] text-muted-foreground">Terlihat publik & dapat diindeks Google.</p>
                  </div>
                  <Switch checked={indexable} onCheckedChange={setIndexable} />
                </div>
                <a href={`/lp/${pageSlug}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Buka halaman di tab baru
                </a>
              </>
            )}
          </div>
        )}

        {/* ── SEO basics ── */}
        {tab === "basics" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">Preview on Google</p>
              <p className="text-[12px] text-stone-500">pomahguesthouse.com{isFixedPage ? (isBook ? " › book" : "") : ` › lp › ${pageSlug}`}</p>
              <p className="text-[15px] font-medium text-blue-700 leading-snug">{metaTitle || pageTitle || "Title tag belum diisi"}</p>
              <p className="text-xs text-stone-600 leading-relaxed">
                {metaDesc || <span className="italic text-stone-400">Meta description belum diisi…</span>}
              </p>
            </div>
            <FieldRow label={`Title tag (${metaTitle.length}/60)`}>
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="Judul di hasil pencarian" />
              <p className={cn("mt-0.5 text-[10px]", metaTitle.length >= 50 && metaTitle.length <= 60 ? "text-emerald-600" : "text-muted-foreground")}>Idealnya 50–60 karakter</p>
            </FieldRow>
            <FieldRow label={`Meta description (${metaDesc.length}/160)`}>
              <Textarea value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} rows={3} placeholder="Deskripsi singkat di hasil pencarian." />
              <p className={cn("mt-0.5 text-[10px]", metaDesc.length >= 120 && metaDesc.length <= 160 ? "text-emerald-600" : "text-muted-foreground")}>Idealnya 120–160 karakter</p>
            </FieldRow>
          </div>
        )}

        {/* ── Advanced SEO ── */}
        {tab === "advanced" && (
          <div className="space-y-4">
            <FieldRow label="Kata kunci target">
              <Input value={targetKw} onChange={(e) => setTargetKw(e.target.value)} placeholder="mis. penginapan wisuda unnes semarang" />
            </FieldRow>
            <FieldRow label="Custom Head Scripts">
              <Textarea value={customHead} onChange={(e) => setCustomHead(e.target.value)} rows={5} className="font-mono text-xs"
                placeholder={'<meta name="..."> · <script>...</script> · tag verifikasi, analytics, dll.'} />
              <p className="mt-0.5 text-[10px] text-muted-foreground">Disisipkan ke dalam &lt;head&gt; halaman ini.</p>
            </FieldRow>
            <FieldRow label="Custom robots.txt">
              <Textarea value={customRobots} onChange={(e) => setCustomRobots(e.target.value)} rows={4} className="font-mono text-xs"
                placeholder={"User-agent: *\nAllow: /"} />
            </FieldRow>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-xs font-medium">Enable Structured Data (JSON-LD)</p>
                <p className="text-[10px] text-muted-foreground">Sisipkan data terstruktur ke halaman.</p>
              </div>
              <Switch checked={jsonLdOn} onCheckedChange={setJsonLdOn} />
            </div>
            {jsonLdOn && (
              <FieldRow label="Custom JSON-LD Schema">
                <Textarea value={customJsonLd} onChange={(e) => setCustomJsonLd(e.target.value)} rows={8} className="font-mono text-xs"
                  placeholder={'{\n  "@context": "https://schema.org",\n  "@type": "Hotel",\n  "name": "Pomah Guesthouse"\n}'} />
                <p className="mt-0.5 text-[10px] text-muted-foreground">Harus JSON yang valid.</p>
              </FieldRow>
            )}
          </div>
        )}

        {/* ── Social share ── */}
        {tab === "social" && (
          <div className="space-y-4">
            <FieldRow label="Gambar share (OG Image)">
              <ImageField value={ogImage} onChange={setOgImage} kind="image" />
              <p className="mt-0.5 text-[10px] text-muted-foreground">Muncul saat halaman dibagikan di media sosial.</p>
            </FieldRow>
            <div className="overflow-hidden rounded-lg border border-stone-200">
              <div className="flex h-36 items-center justify-center bg-stone-100">
                {ogImage ? <img src={ogImage} alt="" className="h-full w-full object-cover" /> : <Images className="h-6 w-6 text-stone-300" />}
              </div>
              <div className="bg-white px-3 py-2">
                <p className="text-[10px] uppercase text-stone-400">pomahguesthouse.com</p>
                <p className="truncate text-sm font-semibold text-stone-800">{metaTitle || pageTitle}</p>
                <p className="line-clamp-2 text-xs text-stone-500">{metaDesc || "Meta description belum diisi…"}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-stone-200 px-5 py-3">
        <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" disabled={saving} onClick={handleSave}>
          {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Menyimpan…</> : <><Save className="mr-1.5 h-3.5 w-3.5" />Simpan</>}
        </Button>
      </div>
    </div>
  );
}

/**
 * Site Pages and Menu — Wix-style modal. Left rail switches between
 * "Site Menu" and "Dynamic Pages"; the middle column lists pages with
 * "+ Add Page" and a per-row ⋯ that opens the Page Settings panel.
 */
type SitePagesRail = "menu" | "dynamic";

function SitePagesModal({
  open,
  onClose,
  pages,
  activePageId,
  settingsPageId,
  onSettingsPage,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  onDuplicateSystem,
  onRename,
  onSaved,
  homeCfg,
  propertyId,
  duplicatingId,
}: {
  open: boolean;
  onClose: () => void;
  pages: SeoLandingPage[];
  activePageId: string;
  settingsPageId: string | null;
  onSettingsPage: (id: string | null) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (p: SeoLandingPage) => void;
  onDuplicate: (p: SeoLandingPage) => void;
  onDuplicateSystem: (type: "home" | "book") => void;
  onRename: (p: SeoLandingPage) => void;
  onSaved: () => void;
  homeCfg: HomepageConfig;
  propertyId: string | null;
  duplicatingId: string | null;
}) {
  const [rail, setRail] = useState<SitePagesRail>("menu");
  const activeLp = activePageId !== "home"
    ? pages.find((p) => p.id === activePageId) ?? null
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-stone-200 px-5 py-4">
          <DialogTitle className="text-base">Site Pages and Menu</DialogTitle>
          <DialogDescription className="sr-only">Kelola halaman situs, menu, dan pengaturan SEO.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Left rail */}
          <div className="w-40 shrink-0 space-y-1 border-r border-stone-200 bg-stone-50/60 p-3">
            {([["menu", "Site Menu"], ["dynamic", "Dynamic Pages"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setRail(key)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-xs font-medium transition",
                  rail === key ? "bg-teal-50 text-teal-800" : "text-stone-600 hover:bg-stone-100",
                )}>
                {label}
              </button>
            ))}
          </div>

          {/* Page list */}
          <div className="flex w-72 shrink-0 flex-col border-r border-stone-200">
            {rail === "menu" ? (
              <>
                <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
                  <p className="text-sm font-semibold">Site Menu</p>
                  <button type="button" onClick={onAdd}
                    className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900">
                    <Plus className="h-3.5 w-3.5" /> Add Page
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {/* Home */}
                  <PageRow
                    icon={<Home className="h-3.5 w-3.5 shrink-0 text-stone-500" />}
                    label="Home" active={activePageId === "home"}
                    onClick={() => onSelect("home")}
                    onDuplicate={() => onDuplicateSystem("home")}
                    duplicatingId={duplicatingId === "home"}
                  />
                  {/* Booking Page */}
                  <PageRow
                    icon={<CalendarCheck className="h-3.5 w-3.5 shrink-0 text-stone-500" />}
                    label="Booking Page" active={activePageId === "book"}
                    onClick={() => onSelect("book")}
                    onDuplicate={() => onDuplicateSystem("book")}
                    duplicatingId={duplicatingId === "book"}
                  />
                  {pages.map((p) => (
                    <PageRow key={p.id}
                      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />}
                      label={p.title} active={activePageId === p.id}
                      published={p.published}
                      onClick={() => onSelect(p.id)}
                      onDelete={() => onDelete(p)}
                      onDuplicate={() => onDuplicate(p)}
                      onRename={() => onRename(p)}
                      duplicatingId={duplicatingId === p.id}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <FileText className="h-8 w-8 text-stone-200" />
                <p className="text-xs text-muted-foreground">Belum ada Dynamic Pages.</p>
                <p className="text-[10px] text-stone-400">Halaman dinamis dari koleksi data akan tampil di sini.</p>
              </div>
            )}
          </div>

          {/* Page Settings */}
          {activeLp ? (
            <PageSettingsPanel target={{ kind: "lp", page: activeLp }} onSaved={onSaved} onClose={onClose} />
          ) : activePageId === "home" ? (
            <PageSettingsPanel target={{ kind: "home", cfg: homeCfg, propertyId }} onSaved={onSaved} onClose={onClose} />
          ) : activePageId === "book" ? (
            <PageSettingsPanel target={{ kind: "book", cfg: homeCfg, propertyId }} onSaved={onSaved} onClose={onClose} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A single row in the Site Menu list (page name + dropdown with actions). */
function PageRow({
  icon, label, active, published, onClick, onDelete, onDuplicate, onRename, duplicatingId,
}: {
  icon: React.ReactNode; label: string; active: boolean;
  published?: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onRename?: () => void;
  duplicatingId?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasActions = !!(onDelete || onDuplicate || onRename);

  return (
    <div className="relative">
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition",
          active ? "bg-teal-50 border border-teal-200" : "hover:bg-muted",
        )}
        onClick={() => { setMenuOpen(false); onClick(); }}>
        {icon}
        <span className="flex-1 truncate text-xs font-medium text-stone-700">{label}</span>
        {published === false && <span className="shrink-0 rounded bg-stone-100 px-1 text-[9px] text-stone-400">draft</span>}
        {duplicatingId && <Loader2 className="h-3 w-3 animate-spin text-teal-600" />}
        {hasActions && (
          <button
            type="button"
            title="Opsi halaman"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            className="rounded p-0.5 text-stone-400 hover:text-stone-700 opacity-0 group-hover:opacity-100 transition">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {menuOpen && hasActions && (
        <div
          className="absolute right-1 top-8 z-50 w-44 rounded-lg border border-border bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}>
          {onDuplicate && (
            <button type="button"
              onClick={() => { setMenuOpen(false); onDuplicate(); }}
              disabled={duplicatingId}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted disabled:opacity-50">
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
          )}
          {onRename && (
            <button type="button"
              onClick={() => { setMenuOpen(false); onRename(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-stone-700 hover:bg-muted">
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
          )}
          {onDelete && (
            <>
              <div className="my-1 border-t border-stone-100" />
              <button type="button"
                onClick={() => { setMenuOpen(false); onDelete(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
