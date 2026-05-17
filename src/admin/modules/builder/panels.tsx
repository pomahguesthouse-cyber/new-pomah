/**
 * The four editor sidebar panels:
 *   • Page    — name, slug, SEO, tags
 *   • Section — section list (drag to reorder) + grid settings
 *   • Elements — element palette + the selected section's element list
 *   • Theme   — global colors, font and radius
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Copy,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Heading,
  Type,
  MousePointerClick,
  Image as ImageIcon,
  Minus,
  LayoutTemplate,
  GalleryHorizontal,
  CalendarCheck,
  Grid3x3,
  BedDouble,
  Hotel,
  MapPin,
  Images,
  Megaphone,
  PanelTop,
  PanelBottom,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "./store";
import { ELEMENT_PALETTE, getComponent } from "./registry";
import { updateLandingPage } from "./builder.functions";
import type { ElementCategory, ElementType, LandingPageRow, SectionWidth } from "./types";

/* Map registry icon names → lucide components. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Heading,
  Type,
  MousePointerClick,
  Image: ImageIcon,
  Minus,
  LayoutTemplate,
  GalleryHorizontal,
  CalendarCheck,
  Grid3x3,
  BedDouble,
  Hotel,
  MapPin,
  Images,
  Megaphone,
  PanelTop,
  PanelBottom,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/60 px-4 py-3.5">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ================================================================== */
/* 1. Page Properties                                                  */
/* ================================================================== */

export function PagePanel({
  page,
  onMetaSaved,
}: {
  page: LandingPageRow;
  onMetaSaved: (m: { title: string; slug: string }) => void;
}) {
  const updateFn = useServerFn(updateLandingPage);
  const [form, setForm] = useState({
    title: page.title,
    slug: page.slug,
    seo_title: page.seo_title ?? "",
    seo_description: page.seo_description ?? "",
    tags: (page.tags ?? []).join(", "),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      title: page.title,
      slug: page.slug,
      seo_title: page.seo_title ?? "",
      seo_description: page.seo_description ?? "",
      tags: (page.tags ?? []).join(", "),
    });
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.title.trim()) return toast.error("Page name is required");
    setSaving(true);
    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await updateFn({
        data: {
          id: page.id,
          title: form.title.trim(),
          slug: form.slug.trim() || slugify(form.title),
          seo_title: form.seo_title || null,
          seo_description: form.seo_description || null,
          tags,
        },
      });
      onMetaSaved({ title: form.title.trim(), slug: form.slug.trim() || slugify(form.title) });
      toast.success("Page properties saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <Section title="Identity">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">Page name</Label>
            <Input
              value={form.title}
              className="h-8 text-sm"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">Slug</Label>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[11px] text-muted-foreground">/p/</span>
              <Input
                value={form.slug}
                className="h-8 font-mono text-sm"
                onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title="SEO">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">SEO title</Label>
            <Input
              value={form.seo_title}
              placeholder={form.title}
              className="h-8 text-sm"
              onChange={(e) => setForm({ ...form, seo_title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">Meta description</Label>
            <Textarea
              value={form.seo_description}
              rows={3}
              className="text-sm"
              onChange={(e) => setForm({ ...form, seo_description: e.target.value })}
            />
          </div>
        </div>
      </Section>

      <Section title="Tags">
        <div className="space-y-1.5">
          <Input
            value={form.tags}
            placeholder="promo, landing, 2026"
            className="h-8 text-sm"
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground">
            Comma-separated labels for organising pages.
          </p>
        </div>
      </Section>

      <div className="p-4">
        <Button
          className="w-full bg-teal-700 text-white hover:bg-teal-800"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save page properties"}
        </Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 2. Section                                                          */
/* ================================================================== */

const WIDTH_OPTIONS: { label: string; value: SectionWidth }[] = [
  { label: "Full width", value: "full" },
  { label: "Wide", value: "wide" },
  { label: "Narrow", value: "narrow" },
];

export function SectionPanel() {
  const sections = useEditorStore((s) => s.sections);
  const selectedId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const addSection = useEditorStore((s) => s.addSection);
  const removeSection = useEditorStore((s) => s.removeSection);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const updateSection = useEditorStore((s) => s.updateSection);
  const moveSection = useEditorStore((s) => s.moveSection);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const selected = sections.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <Section title={`Sections (${sections.length})`}>
        <div className="space-y-1">
          {sections.map((s, i) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== i) moveSection(dragIndex, i);
                setDragIndex(null);
              }}
              onClick={() => selectSection(s.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition",
                s.id === selectedId
                  ? "border-teal-600 bg-teal-50 text-teal-900"
                  : "border-transparent hover:bg-muted",
                dragIndex === i && "opacity-50",
              )}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
              <span className="flex-1 truncate font-medium">{s.name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {s.elements.length}
              </span>
              <span className="hidden gap-0.5 group-hover:flex">
                <IconBtn title="Move up" disabled={i === 0} onClick={() => moveSection(i, i - 1)}>
                  <ChevronUp className="h-3 w-3" />
                </IconBtn>
                <IconBtn
                  title="Move down"
                  disabled={i === sections.length - 1}
                  onClick={() => moveSection(i, i + 1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </IconBtn>
                <IconBtn title="Duplicate" onClick={() => duplicateSection(s.id)}>
                  <Copy className="h-3 w-3" />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => removeSection(s.id)}>
                  <Trash2 className="h-3 w-3" />
                </IconBtn>
              </span>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-2 w-full gap-1.5 text-xs"
          onClick={() => addSection()}
        >
          <Plus className="h-3.5 w-3.5" />
          Add section
        </Button>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Drag the handle to reorder sections.
        </p>
      </Section>

      {selected && (
        <Section title="Section settings">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium">Name</Label>
              <Input
                value={selected.name}
                className="h-8 text-sm"
                onChange={(e) => updateSection(selected.id, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium">Grid columns ({selected.columns})</Label>
              <input
                type="range"
                min={1}
                max={4}
                value={selected.columns}
                onChange={(e) => updateSection(selected.id, { columns: Number(e.target.value) })}
                className="w-full accent-teal-700"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">Gap (px)</Label>
                <Input
                  type="number"
                  value={selected.gap}
                  className="h-8 text-sm"
                  onChange={(e) => updateSection(selected.id, { gap: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">Padding Y</Label>
                <Input
                  type="number"
                  value={selected.paddingY}
                  className="h-8 text-sm"
                  onChange={(e) => updateSection(selected.id, { paddingY: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium">Content width</Label>
              <select
                value={selected.width}
                onChange={(e) =>
                  updateSection(selected.id, { width: e.target.value as SectionWidth })
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {WIDTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium">Background</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(selected.bgColor) ? selected.bgColor : "#ffffff"}
                  onChange={(e) => updateSection(selected.id, { bgColor: e.target.value })}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border"
                />
                <Input
                  value={selected.bgColor}
                  className="h-8 font-mono text-sm"
                  onChange={(e) => updateSection(selected.id, { bgColor: e.target.value })}
                />
              </div>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

/* ================================================================== */
/* 3. Elements                                                         */
/* ================================================================== */

const CATEGORY_ORDER: ElementCategory[] = ["Basic", "Media", "Hospitality", "Layout"];

export function ElementsPanel() {
  const sections = useEditorStore((s) => s.sections);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const addElement = useEditorStore((s) => s.addElement);
  const selectElement = useEditorStore((s) => s.selectElement);
  const removeElement = useEditorStore((s) => s.removeElement);
  const moveElement = useEditorStore((s) => s.moveElement);

  const section = sections.find((s) => s.id === selectedSectionId) ?? null;

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    types: ELEMENT_PALETTE.filter((t) => getComponent(t)?.category === cat),
  })).filter((g) => g.types.length > 0);

  if (!section) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
        Select a section first, then add elements to it.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <Section title={`Elements in "${section.name}"`}>
        {section.elements.length === 0 ? (
          <p className="py-2 text-[11px] text-muted-foreground">No elements yet.</p>
        ) : (
          <div className="space-y-1">
            {section.elements.map((el, i) => {
              const def = getComponent(el.type);
              const Icon = ICONS[def?.icon ?? ""] ?? Type;
              return (
                <div
                  key={el.id}
                  onClick={() => selectElement(section.id, el.id)}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                    el.id === selectedElementId ? "bg-teal-50 text-teal-900" : "hover:bg-muted",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  <span className="flex-1 truncate">{def?.label ?? el.type}</span>
                  <span className="hidden gap-0.5 group-hover:flex">
                    <IconBtn
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => moveElement(section.id, el.id, "up")}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn
                      title="Move down"
                      disabled={i === section.elements.length - 1}
                      onClick={() => moveElement(section.id, el.id, "down")}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn title="Delete" onClick={() => removeElement(section.id, el.id)}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {byCategory.map((group) => (
        <Section key={group.cat} title={group.cat}>
          <div className="grid grid-cols-2 gap-2">
            {group.types.map((type) => {
              const def = getComponent(type)!;
              const Icon = ICONS[def.icon] ?? Type;
              return (
                <button
                  key={type}
                  onClick={() => addElement(section.id, type as ElementType)}
                  title={def.description}
                  className="group flex flex-col items-start gap-1.5 rounded-lg border border-border bg-background p-2.5 text-left transition hover:border-teal-600 hover:shadow-sm"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted group-hover:bg-teal-700 group-hover:text-white">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[11px] font-medium leading-tight">{def.label}</span>
                </button>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 4. Page Theme                                                       */
/* ================================================================== */

export function ThemePanel() {
  const theme = useEditorStore((s) => s.theme);
  const updateTheme = useEditorStore((s) => s.updateTheme);

  return (
    <div className="flex-1 overflow-y-auto">
      <Section title="Colors">
        <div className="space-y-3">
          <ColorRow
            label="Primary / accent"
            value={theme.primaryColor}
            onChange={(v) => updateTheme({ primaryColor: v })}
          />
          <ColorRow
            label="Page background"
            value={theme.bgColor}
            onChange={(v) => updateTheme({ bgColor: v })}
          />
          <ColorRow
            label="Body text"
            value={theme.textColor}
            onChange={(v) => updateTheme({ textColor: v })}
          />
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium">Font family</Label>
          <select
            value={theme.fontFamily}
            onChange={(e) =>
              updateTheme({ fontFamily: e.target.value as "sans" | "serif" | "mono" })
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="sans">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>
      </Section>

      <Section title="Shape">
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium">Corner radius ({theme.radius}px)</Label>
          <input
            type="range"
            min={0}
            max={28}
            value={theme.radius}
            onChange={(e) => updateTheme({ radius: Number(e.target.value) })}
            className="w-full accent-teal-700"
          />
        </div>
      </Section>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border"
        />
        <Input
          value={value}
          className="h-8 font-mono text-sm"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IconBtn({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-0.5 hover:bg-background disabled:opacity-30"
    >
      {children}
    </button>
  );
}
