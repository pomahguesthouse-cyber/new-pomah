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
} from "lucide-react";
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
import type {
  LPSection,
  LPHeroSection,
  LPTextSection,
  LPFeaturesSection,
  LPGallerySection,
  LPFaqSection,
  LPCtaBannerSection,
  LPTestimonialsSection,
  LPHeaderSection,
  LPSliderSection,
  LPButtonSection,
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
      return { id, type: "header", brand: "Pomah Guesthouse", sticky: true, cta_text: "Pesan Sekarang", cta_url: "/book", links: [{ label: "Beranda", url: "/" }, { label: "Kamar", url: "/rooms" }] };
    case "slider":
      return { id, type: "slider", height: 480, overlay: 40, autoplay: true, interval_ms: 5000, slides: [{ image_url: "", headline: "Selamat Datang", subheadline: "Penginapan nyaman di Semarang", cta_text: "Pesan Sekarang", cta_url: "/book" }] };
    case "button":
      return { id, type: "button", text: "Pesan Sekarang", url: "/book", align: "center", variant: "solid", color: "teal" };
  }
}

/* ─── section meta for the picker ─────────────────────────────────── */
const SECTION_META: { type: LPSection["type"]; label: string; desc: string; Icon: React.ElementType; color: string }[] = [
  { type: "header",       label: "Header / Navbar",    desc: "Bar navigasi atas dengan menu & CTA",  Icon: PanelTop,         color: "bg-slate-50 text-slate-700 border-slate-200" },
  { type: "hero",         label: "Hero Banner",        desc: "Header besar dengan gambar & CTA",     Icon: ImageIcon,        color: "bg-teal-50 text-teal-700 border-teal-200" },
  { type: "slider",       label: "Hero Slider",        desc: "Banner geser beberapa gambar",         Icon: GalleryHorizontal,color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
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
}: {
  sections: LPSection[];
  onChange: (s: LPSection[]) => void;
}) {
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const [addDialog,  setAddDialog]  = useState(false);

  const active = sections.find((s) => s.id === activeId) ?? null;

  const add = (type: LPSection["type"]) => {
    const s = makeDefault(type);
    onChange([...sections, s]);
    setActiveId(s.id);
    setAddDialog(false);
  };

  const remove = (id: string) => {
    onChange(sections.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...sections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const update = (id: string, patch: Partial<LPSection>) => {
    onChange(sections.map((s) => (s.id === id ? ({ ...s, ...patch } as LPSection) : s)));
  };

  return (
    <div className="space-y-4">
      {/* Section list */}
      {sections.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-200 py-10 text-center">
          <Layers className="mx-auto h-8 w-8 text-stone-200" />
          <p className="mt-2 text-xs text-stone-400">Belum ada section. Klik "+ Tambah Section" untuk mulai.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sections.map((s, idx) => {
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
                  <button type="button" title="Turun" disabled={idx === sections.length - 1}
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
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-teal-600">
            Edit: {typeMeta(active.type).label}
          </p>
          <SectionEditor section={active} onUpdate={(patch) => update(active.id, patch)} />
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

/* Header / Navbar */
function HeaderEditor({ s, onUpdate }: { s: LPHeaderSection; onUpdate: UpFn }) {
  const links = s.links ?? [];
  const setLinks = (next: typeof links) => onUpdate({ links: next } as any);
  return (
    <div className="space-y-3">
      <Fld label="Nama Brand / Logo">
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

/* Hero Slider */
function SliderEditor({ s, onUpdate }: { s: LPSliderSection; onUpdate: UpFn }) {
  const slides = s.slides ?? [];
  const setSlides = (next: typeof slides) => onUpdate({ slides: next } as any);
  const patchSlide = (i: number, patch: Partial<(typeof slides)[number]>) =>
    setSlides(slides.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Fld label={`Tinggi: ${s.height ?? 480}px`}>
          <input type="range" min={240} max={720} step={20} value={s.height ?? 480}
            onChange={(e) => onUpdate({ height: +e.target.value } as any)}
            className="mt-2 w-full accent-teal-700" />
        </Fld>
        <Fld label={`Overlay: ${s.overlay ?? 40}%`}>
          <input type="range" min={0} max={80} value={s.overlay ?? 40}
            onChange={(e) => onUpdate({ overlay: +e.target.value } as any)}
            className="mt-2 w-full accent-teal-700" />
        </Fld>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-stone-600">
          <input type="checkbox" checked={s.autoplay ?? true}
            onChange={(e) => onUpdate({ autoplay: e.target.checked } as any)} className="accent-teal-700" />
          Geser otomatis
        </label>
        <Fld label="Interval (ms)">
          <Input type="number" value={s.interval_ms ?? 5000} className="mt-1 text-xs"
            onChange={(e) => onUpdate({ interval_ms: +e.target.value } as any)} />
        </Fld>
      </div>
      <div className="space-y-2">
        {slides.map((slide, i) => (
          <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-stone-500">Slide {i + 1}</span>
              <button type="button" onClick={() => setSlides(slides.filter((_, j) => j !== i))}
                className="text-stone-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Input value={slide.image_url} placeholder="URL gambar https://..." className="text-xs font-mono"
              onChange={(e) => patchSlide(i, { image_url: e.target.value })} />
            <Input value={slide.headline ?? ""} placeholder="Headline" className="text-xs"
              onChange={(e) => patchSlide(i, { headline: e.target.value })} />
            <Input value={slide.subheadline ?? ""} placeholder="Sub headline" className="text-xs"
              onChange={(e) => patchSlide(i, { subheadline: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input value={slide.cta_text ?? ""} placeholder="Teks CTA" className="text-xs"
                onChange={(e) => patchSlide(i, { cta_text: e.target.value })} />
              <Input value={slide.cta_url ?? ""} placeholder="/book" className="text-xs font-mono"
                onChange={(e) => patchSlide(i, { cta_url: e.target.value })} />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setSlides([...slides, { image_url: "", headline: "", subheadline: "", cta_text: "Pesan Sekarang", cta_url: "/book" }])}>
          <Plus className="h-3.5 w-3.5" /> Tambah Slide
        </Button>
      </div>
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
      <Fld label="URL Gambar Latar (opsional)" hint="Kosongkan untuk menggunakan gradient teal">
        <Input value={s.image_url ?? ""} onChange={(e) => onUpdate({ image_url: e.target.value || undefined } as any)} className="mt-1" placeholder="https://..." />
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
            <Input value={url} className="flex-1 text-xs" placeholder="https://..."
              onChange={(e) => setImages(images.map((u, j) => j === i ? e.target.value : u))} />
            <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))}
              className="shrink-0 text-stone-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="w-full text-xs gap-1"
          onClick={() => setImages([...images, ""])}>
          <Plus className="h-3.5 w-3.5" /> Tambah URL Foto
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
  return (
    <div className="space-y-3">
      <Fld label="Judul Section">
        <Input value={s.title ?? ""} onChange={(e) => onUpdate({ title: e.target.value || undefined } as any)} className="mt-1" />
      </Fld>
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
    </div>
  );
}
