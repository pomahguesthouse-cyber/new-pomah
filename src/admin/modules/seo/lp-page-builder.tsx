/**
 * Visual page builder for SEO Landing Pages.
 * Manages an ordered list of typed section blocks.
 */
import { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Trash2,
  Plus,
  Image as ImageIcon,
  FileText,
  Layers,
  HelpCircle,
  Megaphone,
  Quote,
  GripVertical,
  PanelTop,
  GalleryHorizontal,
  MousePointerClick,
  FolderOpen,
  Film,
  BedDouble,
  CalendarCheck,
} from "lucide-react";
import { MediaPicker, type MediaKind } from "@/admin/components/media-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ensureResponsiveStyles,
  type LPElementStyles,
  type LPSection,
  type LPHeroSection,
  type LPTextSection,
  type LPFeaturesSection,
  type LPGallerySection,
  type LPFaqSection,
  type LPCtaBannerSection,
  type LPTestimonialsSection,
  type LPHeaderSection,
  type LPSliderSection,
  type LPButtonSection,
  type LPRoomSliderSection,
  type LPDatePickerSection,
  type LPSectionsData,
} from "./landing-page.functions";

/* ─── helpers ──────────────────────────────────────────────────────── */
const genId = () => Math.random().toString(36).slice(2, 10);

function makeDefault(type: LPSection["type"]): LPSection {
  const id = genId();
  switch (type) {
    case "hero":
      return { id, type: "hero", headline: "Selamat Datang di Pomah Guesthouse", subheadline: "Penginapan nyaman di Semarang", cta_text: "Pesan Sekarang", cta_url: "/book", overlay: 40 };
    case "text":
      return { id, type: "text", title: "Tentang Kami", content: "<p>Tulis konten di sini…</p>", align: "left" };
    case "features":
      return { id, type: "features", title: "Fasilitas Kami", columns: 3, items: [{ title: "Wifi Gratis", description: "Wifi kencang di seluruh area" }, { title: "Parkir Gratis", description: "Lahan parkir luas & aman" }, { title: "AC", description: "Setiap kamar ber-AC" }] };
    case "gallery":
      return { id, type: "gallery", title: "Galeri", columns: 3, images: [] };
    case "faq":
      return { id, type: "faq", title: "Pertanyaan Umum", items: [{ question: "Jam berapa check-in?", answer: "Check-in mulai pukul 14.00 WIB." }] };
    case "cta_banner":
      return { id, type: "cta_banner", headline: "Siap Menginap?", subheadline: "Kamar tersedia, harga terjangkau.", cta_text: "Pesan Sekarang", cta_url: "/book", style: "teal" };
    case "testimonials":
      return { id, type: "testimonials", title: "Kata Tamu Kami", items: [{ name: "Tamu", text: "Penginapan yang nyaman dan bersih, pelayanan ramah." }] };
    case "header":
      return { id, type: "header", logo_url: "", brand: "Pomah Guesthouse", sticky: true, cta_text: "Pesan Sekarang", cta_url: "/book", links: [{ label: "Beranda", url: "/" }, { label: "Kamar", url: "/rooms" }] };
    case "room_slider":
      return { id, type: "room_slider", title: "Our Room", subheading: "Pilih tanggal check-in dan check-out untuk melihat ketersediaan kamar", cardsPerView: 3, autoplay: true, slideMs: 4000 };
    case "datepicker":
      return { id, type: "datepicker", heading: "Cek Ketersediaan", buttonLabel: "Cek Ketersediaan" };
    case "slider":
      return { id, type: "slider", autoplayMs: 5000, height: 480, transition: "fade", fontFamily: "serif", fontSize: 48, fontStyle: "bold", slides: [{ imageUrl: "", videoUrl: "", heading: "Selamat Datang Di Pomah Guesthouse", subheading: "Penginapan Murah di Kota Semarang" }] };
    case "button":
      return { id, type: "button", text: "Pesan Sekarang", url: "/book", align: "center", variant: "solid", color: "teal" };
  }
}

/* ─── section meta for the picker ─────────────────────────────────── */
const SECTION_META: { type: LPSection["type"]; label: string; desc: string; Icon: React.ElementType; color: string }[] = [
  { type: "header",       label: "Header / Navbar",    desc: "Bar navigasi atas: logo, menu & CTA",  Icon: PanelTop,         color: "bg-slate-50 text-slate-700 border-slate-200" },
  { type: "hero",         label: "Hero Banner",        desc: "Header besar dengan gambar & CTA",     Icon: ImageIcon,        color: "bg-teal-50 text-teal-700 border-teal-200" },
  { type: "slider",       label: "Hero Slider",        desc: "Banner geser beberapa gambar",         Icon: GalleryHorizontal,color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  { type: "datepicker",   label: "Date Picker",        desc: "Widget cek ketersediaan tanggal",      Icon: CalendarCheck,    color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  { type: "room_slider",  label: "Slider Kamar",       desc: "Carousel kamar dari sistem booking",   Icon: BedDouble,        color: "bg-lime-50 text-lime-700 border-lime-200" },
  { type: "text",         label: "Teks & Paragraf",    desc: "Judul dan paragraf teks bebas",        Icon: FileText,         color: "bg-blue-50 text-blue-700 border-blue-200" },
  { type: "features",     label: "Fitur / Keunggulan", desc: "Grid kartu dengan ikon & deskripsi",   Icon: Layers,           color: "bg-violet-50 text-violet-700 border-violet-200" },
  { type: "gallery",      label: "Galeri Foto",        desc: "Grid foto kamar atau properti",        Icon: ImageIcon,        color: "bg-amber-50 text-amber-700 border-amber-200" },
  { type: "faq",          label: "FAQ",                desc: "Pertanyaan & jawaban accordion",       Icon: HelpCircle,       color: "bg-orange-50 text-orange-700 border-orange-200" },
  { type: "cta_banner",   label: "CTA Banner",         desc: "Strip ajakan bertindak di halaman",    Icon: Megaphone,        color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { type: "button",       label: "Tombol",             desc: "Tombol tautan tunggal",                Icon: MousePointerClick,color: "bg-pink-50 text-pink-700 border-pink-200" },
  { type: "testimonials", label: "Testimoni",          desc: "Kutipan ulasan dari tamu",             Icon: Quote,            color: "bg-rose-50 text-rose-700 border-rose-200" },
];

function typeMeta(type: LPSection["type"]) {
  return SECTION_META.find((m) => m.type === type) ?? SECTION_META[1];
}

/* ═══════════════════════════════════════════════════════════════════
   Main builder component
   ═══════════════════════════════════════════════════════════════════ */
export function LpPageBuilder({
  sections,
  onChange,
  activeMode = "desktop",
  setActiveMode,
}: {
  sections: LPSectionsData;
  onChange: (s: LPSectionsData) => void;
  activeMode?: "desktop" | "mobile";
  setActiveMode?: (mode: "desktop" | "mobile") => void;
}) {
  const isSplit = !!(sections && !Array.isArray(sections) && (sections as any).split);
  const desktopList: LPSection[] = isSplit ? ((sections as any).desktop ?? []) : (Array.isArray(sections) ? sections : []);
  const mobileList: LPSection[] = isSplit ? ((sections as any).mobile ?? []) : (Array.isArray(sections) ? sections : []);

  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [addDialog,  setAddDialog]  = useState(false);
  const [editorTab,  setEditorTab]  = useState<"content" | "style">("content");

  const activeTab = activeMode;
  const setActiveTab = setActiveMode || (() => {});

  const currentList = activeTab === "desktop" || !isSplit ? desktopList : mobileList;
  const active = currentList.find((s) => s.id === activeId) ?? null;

  const handleToggleSplit = (checked: boolean) => {
    if (checked) {
      onChange({
        split: true,
        desktop: [...desktopList],
        mobile: [...desktopList],
      });
      setActiveTab("desktop");
      setActiveId(null);
    } else {
      if (confirm("Menonaktifkan pemisahan desain akan menghapus desain khusus Mobile dan menyamakan dengan desain Desktop. Lanjutkan?")) {
        onChange(desktopList);
        setActiveTab("desktop");
        setActiveId(null);
      }
    }
  };

  const updateCurrentList = (nextList: LPSection[]) => {
    if (isSplit) {
      if (activeTab === "desktop") {
        onChange({
          split: true,
          desktop: nextList,
          mobile: mobileList,
        });
      } else {
        onChange({
          split: true,
          desktop: desktopList,
          mobile: nextList,
        });
      }
    } else {
      onChange(nextList);
    }
  };

  const add = (type: LPSection["type"]) => {
    const s = makeDefault(type);
    updateCurrentList([...currentList, s]);
    setActiveId(s.id);
    setAddDialog(false);
  };

  const remove = (id: string) => {
    updateCurrentList(currentList.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = currentList.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...currentList];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    updateCurrentList(next);
  };

  const update = (id: string, patch: Partial<LPSection>) => {
    updateCurrentList(currentList.map((s) => (s.id === id ? ({ ...s, ...patch } as LPSection) : s)));
  };

  return (
    <div className="space-y-4">
      {/* Toggle Split */}
      <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm">
        <div>
          <h3 className="text-xs font-bold text-stone-900">Pemisahan Desain Desktop & Mobile</h3>
          <p className="text-[11px] text-stone-400 mt-0.5">Diferensiasikan elemen atau konten khusus perangkat mobile.</p>
        </div>
        <Switch checked={isSplit} onCheckedChange={handleToggleSplit} />
      </div>

      {/* Tabs for desktop / mobile */}
      {isSplit && (
        <div className="flex rounded-lg border border-stone-200 bg-stone-100 p-1">
          <button
            type="button"
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              activeTab === "desktop"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-850"
            }`}
            onClick={() => { setActiveTab("desktop"); setActiveId(null); }}
          >
            🖥️ Desktop View ({desktopList.length})
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
              activeTab === "mobile"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-850"
            }`}
            onClick={() => { setActiveTab("mobile"); setActiveId(null); }}
          >
            📱 Mobile View ({mobileList.length})
          </button>
        </div>
      )}

      {/* Section list */}
      {currentList.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-200 py-10 text-center">
          <Layers className="mx-auto h-8 w-8 text-stone-200" />
          <p className="mt-2 text-xs text-stone-400">
            Belum ada section di {isSplit ? (activeTab === "desktop" ? "Desktop" : "Mobile") : "halaman ini"}. Klik "+ Tambah Section" untuk mulai.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {currentList.map((s, idx) => {
            const meta = typeMeta(s.type);
            const isActive = s.id === activeId;
            return (
              <div key={s.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition cursor-pointer ${
                  isActive
                    ? "border-teal-300 bg-teal-50"
                    : "border-stone-200 bg-white hover:border-stone-300"
                }`}
                onClick={() => setActiveId(isActive ? null : s.id)}>
                <GripVertical className="h-4 w-4 shrink-0 text-stone-300" />
                <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>
                  {meta.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-stone-600">
                  {"headline" in s ? s.headline
                    : "title" in s && s.title ? s.title
                    : s.type === "header" ? (s.brand || meta.label)
                    : s.type === "button" ? (s.text || meta.label)
                    : meta.label}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-stone-300">{idx + 1}</span>
                <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <button type="button" title="Naik" disabled={idx === 0}
                    className="rounded p-1 hover:bg-stone-100 disabled:opacity-30"
                    onClick={() => move(s.id, -1)}>
                    <ChevronUp className="h-3.5 w-3.5 text-stone-500" />
                  </button>
                  <button type="button" title="Turun" disabled={idx === currentList.length - 1}
                    className="rounded p-1 hover:bg-stone-100 disabled:opacity-30"
                    onClick={() => move(s.id, 1)}>
                    <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
                  </button>
                  <button type="button" title="Hapus section"
                    className="rounded p-1 text-stone-300 hover:bg-red-50 hover:text-red-500"
                    onClick={() => remove(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" className="w-full gap-1.5 border-dashed"
        onClick={() => setAddDialog(true)}>
        <Plus className="h-4 w-4" /> Tambah Section
      </Button>

      {/* Section editor */}
      {active && (
        <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-teal-150 pb-2">
            <p className="text-xs font-bold uppercase tracking-wide text-teal-600">
              Edit: {typeMeta(active.type).label}
            </p>
            <div className="flex rounded bg-stone-200/60 p-0.5">
              <button
                type="button"
                className={`rounded px-2.5 py-0.5 text-[10px] font-semibold transition ${
                  editorTab === "content" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
                onClick={() => setEditorTab("content")}
              >
                Konten
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-0.5 text-[10px] font-semibold transition ${
                  editorTab === "style" ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-700"
                }`}
                onClick={() => setEditorTab("style")}
              >
                Style
              </button>
            </div>
          </div>
          {editorTab === "content" ? (
            <SectionEditor section={active} onUpdate={(patch) => update(active.id, patch)} />
          ) : (
            <ResponsiveStyleEditor
              section={active}
              activeMode={activeTab}
              onUpdate={(patch) => update(active.id, patch)}
            />
          )}
        </div>
      )}

      {/* Add section dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih Tipe Section</DialogTitle>
            <DialogDescription>Pilih jenis section yang ingin ditambahkan ke halaman.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {SECTION_META.map((m) => (
              <button key={m.type} type="button"
                className="flex flex-col items-start gap-1 rounded-xl border border-stone-200 bg-white p-3 text-left transition hover:border-teal-300 hover:shadow-sm"
                onClick={() => add(m.type)}>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${m.color}`}>
                  <m.Icon className="mr-1 inline h-3 w-3" />
                  {m.label}
                </span>
                <span className="text-[11px] text-stone-400 leading-snug">{m.desc}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Section-specific editors
   ═══════════════════════════════════════════════════════════════════ */
function SectionEditor({ section, onUpdate }: { section: LPSection; onUpdate: (patch: Partial<LPSection>) => void }) {
  switch (section.type) {
    case "header":       return <HeaderEditor        s={section} onUpdate={onUpdate} />;
    case "hero":         return <HeroEditor         s={section} onUpdate={onUpdate} />;
    case "slider":       return <SliderEditor        s={section} onUpdate={onUpdate} />;
    case "room_slider":  return <RoomSliderEditor    s={section} onUpdate={onUpdate} />;
    case "datepicker":   return <DatePickerEditor    s={section} onUpdate={onUpdate} />;
    case "text":         return <TextEditor          s={section} onUpdate={onUpdate} />;
    case "features":     return <FeaturesEditor      s={section} onUpdate={onUpdate} />;
    case "gallery":      return <GalleryEditor       s={section} onUpdate={onUpdate} />;
    case "faq":          return <FaqEditor           s={section} onUpdate={onUpdate} />;
    case "cta_banner":   return <CtaBannerEditor     s={section} onUpdate={onUpdate} />;
    case "button":       return <ButtonEditor        s={section} onUpdate={onUpdate} />;
    case "testimonials": return <TestimonialsEditor  s={section} onUpdate={onUpdate} />;
    default:             return null;
  }
}

type UpFn = (patch: Partial<LPSection>) => void;

function Fld({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Pick an image/video from the Media Library (no manual URL entry). */
function MediaField({
  value,
  onChange,
  kind = "image",
}: {
  value: string;
  onChange: (url: string) => void;
  kind?: MediaKind;
}) {
  const [open, setOpen] = useState(false);
  const isVideo = kind === "video";
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200 bg-stone-50">
        {value ? (
          isVideo
            ? <video src={value} muted className="h-full w-full object-cover" />
            : <img src={value} alt="" className="h-full w-full object-cover" />
        ) : isVideo ? (
          <Film className="h-4 w-4 text-stone-300" />
        ) : (
          <ImageIcon className="h-4 w-4 text-stone-300" />
        )}
      </div>
      <div className="flex flex-1 items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-8 flex-1 gap-1.5 text-xs"
          onClick={() => setOpen(true)}>
          <FolderOpen className="h-3.5 w-3.5" /> {value ? "Ganti" : "Pilih dari Library"}
        </Button>
        {value && (
          <button type="button" onClick={() => onChange("")}
            className="shrink-0 rounded p-1 text-stone-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <MediaPicker open={open} kind={kind}
        onPick={(url) => { onChange(url); setOpen(false); }}
        onClose={() => setOpen(false)} />
    </div>
  );
}

/* Header / Navbar */
function HeaderEditor({ s, onUpdate }: { s: LPHeaderSection; onUpdate: UpFn }) {
  const links = s.links ?? [];
  const setLinks = (next: typeof links) => onUpdate({ links: next } as any);
  return (
    <div className="space-y-3">
      <Fld label="Logo (opsional)" hint="Jika kosong, nama brand di bawah yang ditampilkan.">
        <div className="mt-1">
          <MediaField kind="image" value={s.logo_url ?? ""}
            onChange={(url) => onUpdate({ logo_url: url || undefined } as any)} />
        </div>
      </Fld>
      <Fld label="Nama Brand">
        <Input value={s.brand ?? ""} onChange={(e) => onUpdate({ brand: e.target.value } as any)} className="mt-1" placeholder="Pomah Guesthouse" />
      </Fld>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Teks Tombol CTA">
          <Input value={s.cta_text ?? ""} onChange={(e) => onUpdate({ cta_text: e.target.value } as any)} className="mt-1" placeholder="Pesan Sekarang" />
        </Fld>
        <Fld label="URL Tombol CTA">
          <Input value={s.cta_url ?? ""} onChange={(e) => onUpdate({ cta_url: e.target.value } as any)} className="mt-1" placeholder="/book" />
        </Fld>
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-stone-600">
        <input type="checkbox" checked={s.sticky ?? true}
          onChange={(e) => onUpdate({ sticky: e.target.checked } as any)} className="accent-teal-700" />
        Tempelkan header di atas saat scroll (sticky)
      </label>
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Menu Navigasi</Label>
        {links.map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={link.label} placeholder="Label" className="text-xs"
              onChange={(e) => setLinks(links.map((l, j) => j === i ? { ...l, label: e.target.value } : l))} />
            <Input value={link.url} placeholder="/path" className="flex-1 text-xs font-mono"
              onChange={(e) => setLinks(links.map((l, j) => j === i ? { ...l, url: e.target.value } : l))} />
            <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))}
              className="shrink-0 text-stone-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setLinks([...links, { label: "Menu", url: "/" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Menu
        </Button>
      </div>
    </div>
  );
}

/* Slider Kamar — pulls room types from the booking system */
function RoomSliderEditor({ s, onUpdate }: { s: LPRoomSliderSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-lime-200 bg-lime-50 px-3 py-2.5 text-[11px] leading-relaxed text-lime-700">
        Kamar diambil otomatis dari sistem booking (Room Types). Jika ada Date Picker
        di halaman ini, ketersediaan kamar mengikuti tanggal yang dipilih.
      </div>
      <Fld label="Judul Section">
        <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" placeholder="Our Room" />
      </Fld>
      <Fld label="Teks di bawah judul">
        <Textarea value={s.subheading ?? ""} rows={2} className="mt-1 text-xs"
          onChange={(e) => onUpdate({ subheading: e.target.value || undefined } as any)} />
      </Fld>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Jumlah kartu">
          <Select value={String(s.cardsPerView ?? 3)} onValueChange={(v) => onUpdate({ cardsPerView: +v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} Kartu</SelectItem>)}
            </SelectContent>
          </Select>
        </Fld>
        <Fld label="Kecepatan (ms)">
          <Input type="number" value={s.slideMs ?? 4000} className="mt-1 text-xs"
            onChange={(e) => onUpdate({ slideMs: +e.target.value } as any)} />
        </Fld>
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-stone-600">
        <input type="checkbox" checked={s.autoplay ?? true}
          onChange={(e) => onUpdate({ autoplay: e.target.checked } as any)} className="accent-teal-700" />
        Geser otomatis
      </label>
    </div>
  );
}

/* Date Picker — availability widget, same flow as the homepage */
function DatePickerEditor({ s, onUpdate }: { s: LPDatePickerSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-[11px] leading-relaxed text-indigo-700">
        Tamu memilih tanggal check-in & check-out. Tombol akan menuju ke Slider Kamar
        di halaman ini (jika ada) untuk menampilkan ketersediaan, atau ke halaman booking.
      </div>
      <Fld label="Judul Widget">
        <Input value={s.heading ?? ""} onChange={(e) => onUpdate({ heading: e.target.value || undefined } as any)} className="mt-1" placeholder="Cek Ketersediaan" />
      </Fld>
      <Fld label="Teks Tombol">
        <Input value={s.buttonLabel ?? ""} onChange={(e) => onUpdate({ buttonLabel: e.target.value || undefined } as any)} className="mt-1" placeholder="Cek Ketersediaan" />
      </Fld>
    </div>
  );
}

/* Hero Slider — identical properties to the homepage hero slider */
function SliderEditor({ s, onUpdate }: { s: LPSliderSection; onUpdate: UpFn }) {
  const slides = s.slides ?? [];
  const setSlides = (next: typeof slides) => onUpdate({ slides: next } as any);
  const patchSlide = (i: number, patch: Partial<(typeof slides)[number]>) =>
    setSlides(slides.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Kecepatan slide (ms)">
          <Input type="number" value={s.autoplayMs} className="mt-1 text-xs"
            onChange={(e) => onUpdate({ autoplayMs: +e.target.value } as any)} />
        </Fld>
        <Fld label="Tinggi banner (px)">
          <Input type="number" value={s.height} className="mt-1 text-xs"
            onChange={(e) => onUpdate({ height: +e.target.value } as any)} />
        </Fld>
      </div>

      <Fld label="Animasi transisi antar slide">
        <Select value={s.transition} onValueChange={(v) => onUpdate({ transition: v as any } as any)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fade">Fade — memudar</SelectItem>
            <SelectItem value="slide">Slide — menggeser</SelectItem>
            <SelectItem value="zoom">Zoom — membesar</SelectItem>
            <SelectItem value="none">Tanpa animasi</SelectItem>
          </SelectContent>
        </Select>
      </Fld>

      <div className="space-y-2">
        <Label className="text-xs font-semibold">Slide ({slides.length})</Label>
        {slides.map((slide, i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-500">Slide {i + 1}</span>
              <button type="button" onClick={() => setSlides(slides.filter((_, j) => j !== i))}
                className="text-stone-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Label className="text-[10px] text-muted-foreground">Gambar</Label>
            <MediaField kind="image" value={slide.imageUrl}
              onChange={(url) => patchSlide(i, { imageUrl: url })} />
            <Label className="text-[10px] text-muted-foreground">Video (opsional — diutamakan di atas gambar)</Label>
            <MediaField kind="video" value={slide.videoUrl}
              onChange={(url) => patchSlide(i, { videoUrl: url })} />
            <Input value={slide.heading} placeholder="Judul" className="text-xs"
              onChange={(e) => patchSlide(i, { heading: e.target.value })} />
            <Input value={slide.subheading} placeholder="Subjudul" className="text-xs"
              onChange={(e) => patchSlide(i, { subheading: e.target.value })} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setSlides([...slides, { imageUrl: "", videoUrl: "", heading: "", subheading: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Slide
        </Button>
      </div>

      {/* Font controls — same as the homepage hero */}
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Font judul">
          <Select value={s.fontFamily} onValueChange={(v) => onUpdate({ fontFamily: v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sans">Sans-serif</SelectItem>
              <SelectItem value="serif">Serif</SelectItem>
              <SelectItem value="mono">Monospace</SelectItem>
            </SelectContent>
          </Select>
        </Fld>
        <Fld label="Gaya font">
          <Select value={s.fontStyle} onValueChange={(v) => onUpdate({ fontStyle: v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="bold">Tebal</SelectItem>
              <SelectItem value="italic">Miring</SelectItem>
            </SelectContent>
          </Select>
        </Fld>
      </div>
      <Fld label={`Ukuran font — ${s.fontSize}px`}>
        <input type="range" min={24} max={96} value={s.fontSize}
          onChange={(e) => onUpdate({ fontSize: +e.target.value } as any)}
          className="mt-2 w-full accent-teal-700" />
      </Fld>
    </div>
  );
}

/* Button */
function ButtonEditor({ s, onUpdate }: { s: LPButtonSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Teks Tombol *">
          <Input value={s.text} onChange={(e) => onUpdate({ text: e.target.value } as any)} className="mt-1" />
        </Fld>
        <Fld label="URL Tujuan *">
          <Input value={s.url} onChange={(e) => onUpdate({ url: e.target.value } as any)} className="mt-1" placeholder="/book" />
        </Fld>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Fld label="Posisi">
          <Select value={s.align ?? "center"} onValueChange={(v) => onUpdate({ align: v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Kiri</SelectItem>
              <SelectItem value="center">Tengah</SelectItem>
              <SelectItem value="right">Kanan</SelectItem>
            </SelectContent>
          </Select>
        </Fld>
        <Fld label="Gaya">
          <Select value={s.variant ?? "solid"} onValueChange={(v) => onUpdate({ variant: v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="solid">Penuh</SelectItem>
              <SelectItem value="outline">Garis</SelectItem>
            </SelectContent>
          </Select>
        </Fld>
        <Fld label="Warna">
          <Select value={s.color ?? "teal"} onValueChange={(v) => onUpdate({ color: v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="teal">Teal</SelectItem>
              <SelectItem value="dark">Gelap</SelectItem>
              <SelectItem value="light">Terang</SelectItem>
            </SelectContent>
          </Select>
        </Fld>
      </div>
    </div>
  );
}

/* Hero */
function HeroEditor({ s, onUpdate }: { s: LPHeroSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <Fld label="Headline *">
        <Input value={s.headline} onChange={(e) => onUpdate({ headline: e.target.value } as any)} className="mt-1" />
      </Fld>
      <Fld label="Sub Headline">
        <Input value={s.subheadline ?? ""} onChange={(e) => onUpdate({ subheadline: e.target.value } as any)} className="mt-1" placeholder="Kalimat pendukung singkat" />
      </Fld>
      <Fld label="Gambar Latar (opsional)" hint="Kosongkan untuk menggunakan gradient teal">
        <div className="mt-1">
          <MediaField kind="image" value={s.image_url ?? ""}
            onChange={(url) => onUpdate({ image_url: url || undefined } as any)} />
        </div>
      </Fld>
      <Fld label={`Transparansi Overlay: ${s.overlay ?? 40}%`} hint="Semakin tinggi = latar lebih gelap">
        <input type="range" min={0} max={80} value={s.overlay ?? 40}
          onChange={(e) => onUpdate({ overlay: +e.target.value } as any)}
          className="mt-1 w-full accent-teal-700" />
      </Fld>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Teks Tombol CTA">
          <Input value={s.cta_text ?? ""} onChange={(e) => onUpdate({ cta_text: e.target.value } as any)} className="mt-1" placeholder="Pesan Sekarang" />
        </Fld>
        <Fld label="URL Tombol CTA">
          <Input value={s.cta_url ?? ""} onChange={(e) => onUpdate({ cta_url: e.target.value } as any)} className="mt-1" placeholder="/book" />
        </Fld>
      </div>
    </div>
  );
}

/* Text */
function TextEditor({ s, onUpdate }: { s: LPTextSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <Fld label="Judul Section (opsional)">
        <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
      </Fld>
      <Fld label="Konten (HTML)" hint="Gunakan <h3>, <p>, <ul>, <strong> untuk format.">
        <Textarea value={s.content} onChange={(e) => onUpdate({ content: e.target.value } as any)}
          rows={6} className="mt-1 font-mono text-xs" />
      </Fld>
      <Fld label="Alignment">
        <Select value={s.align ?? "left"} onValueChange={(v) => onUpdate({ align: v as any } as any)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Kiri</SelectItem>
            <SelectItem value="center">Tengah</SelectItem>
          </SelectContent>
        </Select>
      </Fld>
    </div>
  );
}

/* Features */
function FeaturesEditor({ s, onUpdate }: { s: LPFeaturesSection; onUpdate: UpFn }) {
  const items = s.items ?? [];
  const setItems = (next: typeof items) => onUpdate({ items: next } as any);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Judul Section">
          <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
        </Fld>
        <Fld label="Jumlah Kolom">
          <Select value={String(s.columns ?? 3)} onValueChange={(v) => onUpdate({ columns: +v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} Kolom</SelectItem>)}
            </SelectContent>
          </Select>
        </Fld>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-500">Item {i + 1}</span>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-stone-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Input value={item.title} placeholder="Judul" className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, title: e.target.value } : it))} />
            <Input value={item.description} placeholder="Deskripsi singkat" className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, description: e.target.value } : it))} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setItems([...items, { title: "", description: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Item
        </Button>
      </div>
    </div>
  );
}

/* Gallery */
function GalleryEditor({ s, onUpdate }: { s: LPGallerySection; onUpdate: UpFn }) {
  const images = s.images ?? [];
  const setImages = (next: string[]) => onUpdate({ images: next } as any);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Judul Section">
          <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
        </Fld>
        <Fld label="Jumlah Kolom">
          <Select value={String(s.columns ?? 3)} onValueChange={(v) => onUpdate({ columns: +v as any } as any)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} Kolom</SelectItem>)}
            </SelectContent>
          </Select>
        </Fld>
      </div>
      <div className="space-y-2">
        {images.map((url, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <MediaField kind="image" value={url}
                onChange={(next) => setImages(images.map((u, j) => j === i ? next : u))} />
            </div>
            <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))}
              className="shrink-0 text-stone-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setImages([...images, ""])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Foto
        </Button>
      </div>
    </div>
  );
}

/* FAQ */
function FaqEditor({ s, onUpdate }: { s: LPFaqSection; onUpdate: UpFn }) {
  const items = s.items ?? [];
  const setItems = (next: typeof items) => onUpdate({ items: next } as any);
  return (
    <div className="space-y-3">
      <Fld label="Judul Section">
        <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
      </Fld>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-500">Q&A {i + 1}</span>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-stone-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Input value={item.question} placeholder="Pertanyaan" className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, question: e.target.value } : it))} />
            <Textarea value={item.answer} placeholder="Jawaban" rows={2} className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, answer: e.target.value } : it))} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setItems([...items, { question: "", answer: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Q&A
        </Button>
      </div>
    </div>
  );
}

/* CTA Banner */
function CtaBannerEditor({ s, onUpdate }: { s: LPCtaBannerSection; onUpdate: UpFn }) {
  return (
    <div className="space-y-3">
      <Fld label="Headline *">
        <Input value={s.headline} onChange={(e) => onUpdate({ headline: e.target.value } as any)} className="mt-1" />
      </Fld>
      <Fld label="Sub Headline (opsional)">
        <Input value={s.subheadline ?? ""} onChange={(e) => onUpdate({ subheadline: e.target.value || undefined } as any)} className="mt-1" />
      </Fld>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Teks Tombol">
          <Input value={s.cta_text} onChange={(e) => onUpdate({ cta_text: e.target.value } as any)} className="mt-1" />
        </Fld>
        <Fld label="URL Tombol">
          <Input value={s.cta_url} onChange={(e) => onUpdate({ cta_url: e.target.value } as any)} className="mt-1" />
        </Fld>
      </div>
      <Fld label="Warna Latar">
        <Select value={s.style ?? "teal"} onValueChange={(v) => onUpdate({ style: v as any } as any)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="teal">Teal (hijau)</SelectItem>
            <SelectItem value="dark">Gelap (batu)</SelectItem>
            <SelectItem value="light">Terang (putih)</SelectItem>
          </SelectContent>
        </Select>
      </Fld>
    </div>
  );
}

/* Testimonials */
function TestimonialsEditor({ s, onUpdate }: { s: LPTestimonialsSection; onUpdate: UpFn }) {
  const items = s.items ?? [];
  const setItems = (next: typeof items) => onUpdate({ items: next } as any);
  const source = s.source ?? "manual";
  return (
    <div className="space-y-3">
      <Fld label="Judul Section">
        <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
      </Fld>

      <Fld label="Sumber Testimoni">
        <Select value={source} onValueChange={(v) => onUpdate({ source: v as any } as any)}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Tulis Manual</SelectItem>
            <SelectItem value="google">Google Review (otomatis)</SelectItem>
          </SelectContent>
        </Select>
      </Fld>

      {source === "google" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
          Ulasan diambil otomatis dari Google Review properti (Settings → Integrasi).
          Daftar manual di bawah diabaikan saat sumber ini aktif.
        </div>
      ) : (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-500">Testimoni {i + 1}</span>
              <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="text-stone-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Input value={item.name} placeholder="Nama tamu" className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, name: e.target.value } : it))} />
            <Textarea value={item.text} placeholder="Kutipan ulasan" rows={2} className="text-xs"
              onChange={(e) => setItems(items.map((it, j) => j === i ? { ...it, text: e.target.value } : it))} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setItems([...items, { name: "", text: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Testimoni
        </Button>
      </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Responsive Style Editor Components
   ═══════════════════════════════════════════════════════════════════ */
function LocalColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-stone-200"
      />
      <Input
        value={value}
        placeholder="#ffffff"
        className="font-mono text-xs h-8"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ResponsiveStyleEditor({
  section,
  activeMode,
  onUpdate,
}: {
  section: LPSection;
  activeMode: "desktop" | "mobile";
  onUpdate: (patch: Partial<LPSection>) => void;
}) {
  const s = ensureResponsiveStyles(section);
  const currentStyles = s.styles[activeMode] || {};

  const updateStyle = (key: keyof LPElementStyles, value: any) => {
    const nextStyles = {
      ...s.styles,
      [activeMode]: {
        ...s.styles[activeMode],
        [key]: value,
      },
    };
    onUpdate({ styles: nextStyles } as any);
  };

  const isHiddenDesktop = s.styles.desktop?.display === "none" || s.styles.desktop?.visibility === "hidden";
  const isHiddenMobile = s.styles.mobile?.display === "none" || s.styles.mobile?.visibility === "hidden";

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center justify-between rounded-lg bg-stone-150 p-2 text-xs font-semibold text-stone-700">
        <span>Editing Mode: {activeMode === "desktop" ? "🖥️ Desktop" : "📱 Mobile"}</span>
      </div>

      {/* Visibility / Hide switches */}
      <div className="space-y-2 border-b border-stone-200 pb-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Sembunyikan di Desktop</Label>
          <Switch
            checked={isHiddenDesktop}
            onCheckedChange={(checked) => {
              const nextStyles = {
                ...s.styles,
                desktop: {
                  ...s.styles.desktop,
                  display: checked ? "none" : "block",
                  visibility: checked ? "hidden" : "visible",
                },
              };
              onUpdate({ styles: nextStyles } as any);
            }}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Sembunyikan di Mobile</Label>
          <Switch
            checked={isHiddenMobile}
            onCheckedChange={(checked) => {
              const nextStyles = {
                ...s.styles,
                mobile: {
                  ...s.styles.mobile,
                  display: checked ? "none" : "block",
                  visibility: checked ? "hidden" : "visible",
                },
              };
              onUpdate({ styles: nextStyles } as any);
            }}
          />
        </div>
      </div>

      {/* Typography */}
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Tipografi</p>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Font Size" hint="Contoh: 16px, 2rem">
            <Input
              value={currentStyles.fontSize ?? ""}
              onChange={(e) => updateStyle("fontSize", e.target.value)}
              className="h-8 text-xs"
              placeholder="e.g. 24px"
            />
          </Fld>
          <Fld label="Line Height" hint="Contoh: 1.5, 24px">
            <Input
              value={currentStyles.textSize ?? ""}
              onChange={(e) => updateStyle("textSize", e.target.value)}
              className="h-8 text-xs"
              placeholder="e.g. 1.5"
            />
          </Fld>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Font Weight">
            <Select
              value={currentStyles.fontWeight ?? ""}
              onValueChange={(v) => updateStyle("fontWeight", v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Bawaan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="medium">Medium (500)</SelectItem>
                <SelectItem value="semibold">Semibold (600)</SelectItem>
                <SelectItem value="bold">Bold (700)</SelectItem>
              </SelectContent>
            </Select>
          </Fld>
          <Fld label="Perataan Teks">
            <Select
              value={currentStyles.alignment ?? ""}
              onValueChange={(v) => updateStyle("alignment", v === "" ? undefined : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Bawaan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Kiri</SelectItem>
                <SelectItem value="center">Tengah</SelectItem>
                <SelectItem value="right">Kanan</SelectItem>
                <SelectItem value="justify">Rata Kiri-Kanan</SelectItem>
              </SelectContent>
            </Select>
          </Fld>
        </div>
      </div>

      {/* Colors */}
      <div className="space-y-2 border-t border-stone-200 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Warna</p>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Warna Teks">
            <LocalColorField
              value={currentStyles.textColor ?? ""}
              onChange={(v) => updateStyle("textColor", v)}
            />
          </Fld>
          <Fld label="Warna Latar">
            <LocalColorField
              value={currentStyles.bgColor ?? ""}
              onChange={(v) => updateStyle("bgColor", v)}
            />
          </Fld>
        </div>
      </div>

      {/* Dimensions & Spacing */}
      <div className="space-y-2 border-t border-stone-200 pt-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Ukuran & Spacing</p>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Lebar" hint="Contoh: 100%, 400px">
            <Input
              value={currentStyles.width ?? ""}
              onChange={(e) => updateStyle("width", e.target.value)}
              className="h-8 text-xs"
              placeholder="auto"
            />
          </Fld>
          <Fld label="Tinggi" hint="Contoh: 200px, auto">
            <Input
              value={currentStyles.height ?? ""}
              onChange={(e) => updateStyle("height", e.target.value)}
              className="h-8 text-xs"
              placeholder="auto"
            />
          </Fld>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Padding" hint="Contoh: 12px, 10px 20px">
            <Input
              value={currentStyles.padding ?? ""}
              onChange={(e) => updateStyle("padding", e.target.value)}
              className="h-8 text-xs"
              placeholder="0px"
            />
          </Fld>
          <Fld label="Margin" hint="Contoh: 12px, 10px auto">
            <Input
              value={currentStyles.margin ?? ""}
              onChange={(e) => updateStyle("margin", e.target.value)}
              className="h-8 text-xs"
              placeholder="0px"
            />
          </Fld>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Fld label="Border Radius" hint="Contoh: 8px, 9999px">
            <Input
              value={currentStyles.borderRadius ?? ""}
              onChange={(e) => updateStyle("borderRadius", e.target.value)}
              className="h-8 text-xs"
              placeholder="0px"
            />
          </Fld>
        </div>
      </div>

      {/* Mobile Specific Features */}
      {activeMode === "mobile" && (
        <div className="space-y-2 border-t border-stone-200 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Pengaturan Mobile</p>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">Lebar Penuh di Mobile</Label>
            <Switch
              checked={!!currentStyles.fullWidth}
              onCheckedChange={(checked) => updateStyle("fullWidth", checked)}
            />
          </div>
          <Fld label="Urutan / Posisi (Flex Order)" hint="Mengatur susunan vertikal di Mobile">
            <Input
              type="number"
              value={currentStyles.order ?? 0}
              onChange={(e) => updateStyle("order", parseInt(e.target.value, 10) || 0)}
              className="h-8 text-xs"
            />
          </Fld>
        </div>
      )}
    </div>
  );
}
