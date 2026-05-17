/**
 * Visual Page Editor — editor shell.
 *
 * Layout, modelled on a modern site builder:
 *   • Top bar      — page switcher, device toggle, zoom, undo/redo, save
 *   • Icon rail    — narrow vertical strip; each icon opens a flyout panel
 *   • Flyout panel — Page / Section / Elements / Theme (collapsible)
 *   • Canvas       — live, selectable preview with rulers + zoom
 *   • Right panel  — auto-generated element property editor
 *
 * Persistence: a debounced autosave writes the draft document 1.5s after
 * the last change; Save forces it immediately; Publish snapshots a
 * version and goes live. All editor state lives in `useEditorStore`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Undo2,
  Redo2,
  Monitor,
  Smartphone,
  Save,
  Rocket,
  ExternalLink,
  FileText,
  Rows3,
  Palette as PaletteIcon,
  Plus,
  Minus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "./store";
import { WIDTH_CLASS, ElementView } from "./renderer";
import { PropertyPanel } from "./property-panel";
import { PagePanel, SectionPanel, ElementsPanel, ThemePanel } from "./panels";
import type { DeviceMode, LandingPageRow } from "./types";
import { updateLandingPage, publishLandingPage } from "./builder.functions";

const DEVICE_WIDTH: Record<DeviceMode, number> = {
  desktop: 1180,
  tablet: 820,
  mobile: 390,
};

const AUTOSAVE_MS = 1500;
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.15, 1.3];

type PanelKey = "page" | "section" | "elements" | "theme";

const RAIL: { key: PanelKey; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { key: "elements", label: "Elements", icon: Plus },
    { key: "section", label: "Sections", icon: Rows3 },
    { key: "page", label: "Page Properties", icon: FileText },
    { key: "theme", label: "Page Theme", icon: PaletteIcon },
  ];

/* ================================================================== */
/* Editor                                                              */
/* ================================================================== */

export function PageEditor({ page }: { page: LandingPageRow }) {
  const load = useEditorStore((s) => s.load);
  const sections = useEditorStore((s) => s.sections);
  const theme = useEditorStore((s) => s.theme);
  const dirty = useEditorStore((s) => s.dirty);
  const device = useEditorStore((s) => s.device);
  const markSaved = useEditorStore((s) => s.markSaved);
  const toContent = useEditorStore((s) => s.toContent);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const updateFn = useServerFn(updateLandingPage);
  const publishFn = useServerFn(publishLandingPage);

  const [panel, setPanel] = useState<PanelKey | null>("elements");
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [publishing, setPublishing] = useState(false);
  const [meta, setMeta] = useState({ title: page.title, slug: page.slug, status: page.status });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    load(page.content);
    setMeta({ title: page.title, slug: page.slug, status: page.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      await updateFn({ data: { id: page.id, content: toContent() } });
      markSaved();
      setSaveState("saved");
    } catch (err) {
      setSaveState("idle");
      toast.error((err as Error).message);
    }
  }, [updateFn, page.id, toContent, markSaved]);

  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sections, theme, dirty, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        mod &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, save]);

  const publish = async () => {
    setPublishing(true);
    try {
      await save();
      await publishFn({ data: { id: page.id } });
      setMeta((m) => ({ ...m, status: "published" }));
      toast.success("Page published");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      <TopBar
        title={meta.title}
        slug={meta.slug}
        status={meta.status}
        dirty={dirty}
        saveState={saveState}
        publishing={publishing}
        zoom={zoom}
        onZoom={setZoom}
        onSave={save}
        onPublish={publish}
      />
      <div className="flex flex-1 overflow-hidden">
        <IconRail panel={panel} onPanel={setPanel} />
        {panel && (
          <FlyoutPanel
            panel={panel}
            page={page}
            onClose={() => setPanel(null)}
            onMetaSaved={(m) => setMeta((prev) => ({ ...prev, ...m }))}
          />
        )}
        <Canvas device={device} zoom={zoom} />
        <PropertyPanel />
      </div>
    </div>
  );
}

/* ================================================================== */
/* Top bar                                                             */
/* ================================================================== */

function TopBar({
  title,
  slug,
  status,
  dirty,
  saveState,
  publishing,
  zoom,
  onZoom,
  onSave,
  onPublish,
}: {
  title: string;
  slug: string;
  status: string;
  dirty: boolean;
  saveState: "idle" | "saving" | "saved";
  publishing: boolean;
  zoom: number;
  onZoom: (z: number) => void;
  onSave: () => void;
  onPublish: () => void;
}) {
  const device = useEditorStore((s) => s.device);
  const setDevice = useEditorStore((s) => s.setDevice);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.indexOf(zoom);
    const base = i === -1 ? 3 : i;
    onZoom(ZOOM_STEPS[Math.max(0, Math.min(base + dir, ZOOM_STEPS.length - 1))]);
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      {/* Left — current page */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">Page:</span>
        <div className="flex h-8 items-center rounded-md border border-border px-2.5">
          <span className="max-w-[180px] truncate text-sm font-medium">{title}</span>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            status === "published"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-stone-100 text-stone-500",
          )}
        >
          {status}
        </span>
      </div>

      {/* Center — device toggle + zoom */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {(
            [
              ["desktop", Monitor],
              ["mobile", Smartphone],
            ] as const
          ).map(([mode, Icon]) => (
            <button
              key={mode}
              onClick={() => setDevice(mode)}
              title={mode}
              className={cn(
                "flex h-7 w-9 items-center justify-center rounded-md transition",
                device === mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-border">
          <button
            onClick={() => stepZoom(-1)}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
            title="Zoom out"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-12 text-center text-xs font-medium tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => stepZoom(1)}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
            title="Zoom in"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Right — history + actions */}
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={!canUndo}
          onClick={undo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          disabled={!canRedo}
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <a
          href={`/p/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View live"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <span className="mx-1 w-px self-stretch bg-border" />
        <span className="hidden text-[11px] text-muted-foreground sm:inline">
          {saveState === "saving"
            ? "Saving…"
            : dirty
              ? "Unsaved"
              : saveState === "saved"
                ? "Saved"
                : ""}
        </span>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onSave}>
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-teal-700 text-white hover:bg-teal-800"
          disabled={publishing}
          onClick={onPublish}
        >
          <Rocket className="h-3.5 w-3.5" />
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>
    </header>
  );
}

/* ================================================================== */
/* Icon rail + flyout panel                                            */
/* ================================================================== */

function IconRail({
  panel,
  onPanel,
}: {
  panel: PanelKey | null;
  onPanel: (p: PanelKey | null) => void;
}) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {RAIL.map((r) => {
        const active = panel === r.key;
        return (
          <button
            key={r.key}
            onClick={() => onPanel(active ? null : r.key)}
            title={r.label}
            className={cn(
              "flex h-10 w-10 flex-col items-center justify-center rounded-lg transition",
              active
                ? "bg-teal-700 text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <r.icon className="h-[18px] w-[18px]" />
          </button>
        );
      })}
    </nav>
  );
}

function FlyoutPanel({
  panel,
  page,
  onClose,
  onMetaSaved,
}: {
  panel: PanelKey;
  page: LandingPageRow;
  onClose: () => void;
  onMetaSaved: (m: { title: string; slug: string }) => void;
}) {
  const label = RAIL.find((r) => r.key === panel)!.label;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {panel === "page" && <PagePanel page={page} onMetaSaved={onMetaSaved} />}
      {panel === "section" && <SectionPanel />}
      {panel === "elements" && <ElementsPanel />}
      {panel === "theme" && <ThemePanel />}
    </aside>
  );
}

/* ================================================================== */
/* Canvas — rulers + zoom                                              */
/* ================================================================== */

function Ruler({ orientation, length }: { orientation: "h" | "v"; length: number }) {
  const marks = [];
  for (let x = 0; x <= length; x += 50) {
    marks.push(x);
  }
  if (orientation === "h") {
    return (
      <div className="relative h-5 shrink-0 border-b border-border bg-card">
        {marks.map((x) => (
          <div key={x} className="absolute top-0 h-full" style={{ left: x }}>
            <div className={cn("w-px bg-border", x % 100 === 0 ? "h-2.5" : "h-1.5")} />
            {x % 100 === 0 && (
              <span className="absolute left-1 top-0 font-mono text-[8px] text-muted-foreground">
                {x}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="relative w-5 shrink-0 border-r border-border bg-card">
      {marks.map((y) => (
        <div key={y} className="absolute left-0 w-full" style={{ top: y }}>
          <div className={cn("h-px bg-border", y % 100 === 0 ? "w-2.5" : "w-1.5")} />
          {y % 100 === 0 && (
            <span className="absolute left-0 top-1 font-mono text-[8px] text-muted-foreground">
              {y}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Canvas({ device, zoom }: { device: DeviceMode; zoom: number }) {
  const sections = useEditorStore((s) => s.sections);
  const theme = useEditorStore((s) => s.theme);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const addSection = useEditorStore((s) => s.addSection);

  const width = DEVICE_WIDTH[device];
  const fontClass =
    theme.fontFamily === "serif"
      ? "font-serif"
      : theme.fontFamily === "mono"
        ? "font-mono"
        : "font-sans";

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[#eceae6]">
      <div className="flex shrink-0">
        <div className="h-5 w-5 shrink-0 border-b border-r border-border bg-card" />
        <Ruler orientation="h" length={1400} />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <Ruler orientation="v" length={2400} />
        <div className="flex-1 overflow-auto p-8" onClick={() => clearSelection()}>
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              width,
              margin: "0 auto",
            }}
          >
            <div
              className={cn("bg-white shadow-2xl", fontClass)}
              style={{ background: theme.bgColor, color: theme.textColor }}
            >
              {sections.length === 0 ? (
                <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm font-medium text-stone-500">This page has no sections</p>
                  <p className="text-xs text-stone-400">
                    Add one from the Sections panel to start building.
                  </p>
                </div>
              ) : (
                sections.map((s) => <CanvasSection key={s.id} sectionId={s.id} />)
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addSection();
                }}
                className="flex w-full items-center justify-center gap-2 border-t-2 border-dashed border-stone-200 py-5 text-xs font-medium text-stone-400 transition hover:bg-stone-50 hover:text-teal-700"
              >
                <Plus className="h-4 w-4" />
                Add section
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CanvasSection({ sectionId }: { sectionId: string }) {
  const section = useEditorStore((s) => s.sections.find((x) => x.id === sectionId));
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const selectElement = useEditorStore((s) => s.selectElement);
  if (!section) return null;

  const selected = selectedSectionId === section.id && !selectedElementId;
  const cols = Math.max(1, Math.min(section.columns, 4));

  return (
    <section
      onClick={(e) => {
        e.stopPropagation();
        selectSection(section.id);
      }}
      className={cn(
        "relative cursor-pointer outline-offset-[-2px] transition",
        selected
          ? "outline outline-2 outline-teal-600"
          : "hover:outline hover:outline-1 hover:outline-teal-300",
      )}
      style={{
        background: section.bgColor,
        paddingTop: section.paddingY,
        paddingBottom: section.paddingY,
      }}
    >
      <span
        className={cn(
          "absolute left-0 top-0 z-10 rounded-br-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white",
          selected ? "bg-teal-600" : "bg-teal-400/80",
        )}
      >
        {section.name}
      </span>
      <div className={cn("mx-auto px-6", WIDTH_CLASS[section.width] ?? "max-w-6xl")}>
        {section.elements.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-stone-200 text-[11px] text-stone-400">
            Empty section — add elements from the Elements panel
          </div>
        ) : (
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: section.gap }}
          >
            {section.elements.map((el) => {
              const elSelected = selectedElementId === el.id;
              return (
                <div
                  key={el.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectElement(section.id, el.id);
                  }}
                  style={{ gridColumn: `span ${Math.min(el.colSpan ?? cols, cols)}` }}
                  className={cn(
                    "relative cursor-pointer outline-offset-[-2px] transition",
                    elSelected
                      ? "outline outline-2 outline-amber-500"
                      : "hover:outline hover:outline-1 hover:outline-amber-300",
                  )}
                >
                  <div className="pointer-events-none">
                    <ElementView element={el} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
