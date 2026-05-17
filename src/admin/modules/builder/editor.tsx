/**
 * Visual Page Editor — editor shell.
 *
 * Layout:
 *   • Toolbar       — device switcher, undo/redo, save, publish
 *   • Left sidebar  — four panels: Page / Section / Elements / Theme
 *   • Canvas        — live, selectable preview rendered through the registry
 *   • Right panel   — auto-generated element property editor
 *
 * Persistence: a debounced autosave writes the draft document 1.5s after
 * the last change; Save forces it immediately; Publish snapshots a
 * version and goes live. All editor state lives in `useEditorStore`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Undo2,
  Redo2,
  Monitor,
  Tablet,
  Smartphone,
  Save,
  Rocket,
  ExternalLink,
  FileText,
  Rows3,
  Boxes,
  Palette as PaletteIcon,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "./store";
import { WIDTH_CLASS, ElementView } from "./renderer";
import { PropertyPanel } from "./property-panel";
import { PagePanel, SectionPanel, ElementsPanel, ThemePanel } from "./panels";
import type { DeviceMode, LandingPageRow } from "./types";
import { updateLandingPage, publishLandingPage } from "./builder.functions";

const DEVICE_WIDTH: Record<DeviceMode, string> = {
  desktop: "100%",
  tablet: "820px",
  mobile: "390px",
};

const AUTOSAVE_MS = 1500;

type PanelKey = "page" | "section" | "elements" | "theme";

const PANELS: {
  key: PanelKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "page", label: "Page Properties", icon: FileText },
  { key: "section", label: "Section", icon: Rows3 },
  { key: "elements", label: "Elements", icon: Boxes },
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

  const [panel, setPanel] = useState<PanelKey>("section");
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

  // Debounced autosave on any document change.
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [sections, theme, dirty, save]);

  // Keyboard shortcuts.
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
    <div className="flex h-full flex-col overflow-hidden bg-muted/30">
      <Toolbar
        title={meta.title}
        slug={meta.slug}
        status={meta.status}
        dirty={dirty}
        saveState={saveState}
        publishing={publishing}
        onSave={save}
        onPublish={publish}
      />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          panel={panel}
          onPanel={setPanel}
          page={page}
          onMetaSaved={(m) => setMeta((prev) => ({ ...prev, ...m }))}
        />
        <Canvas device={device} />
        <PropertyPanel />
      </div>
    </div>
  );
}

/* ================================================================== */
/* Toolbar                                                             */
/* ================================================================== */

function Toolbar({
  title,
  slug,
  status,
  dirty,
  saveState,
  publishing,
  onSave,
  onPublish,
}: {
  title: string;
  slug: string;
  status: string;
  dirty: boolean;
  saveState: "idle" | "saving" | "saved";
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
}) {
  const device = useEditorStore((s) => s.device);
  const setDevice = useEditorStore((s) => s.setDevice);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link to="/admin/pages">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">/p/{slug}</p>
        </div>
        <span
          className={cn(
            "ml-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            status === "published"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-stone-100 text-stone-500",
          )}
        >
          {status}
        </span>
      </div>

      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {(
          [
            ["desktop", Monitor],
            ["tablet", Tablet],
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
                ? "All changes saved"
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
/* Left sidebar — four panels                                          */
/* ================================================================== */

function LeftSidebar({
  panel,
  onPanel,
  page,
  onMetaSaved,
}: {
  panel: PanelKey;
  onPanel: (p: PanelKey) => void;
  page: LandingPageRow;
  onMetaSaved: (m: { title: string; slug: string }) => void;
}) {
  const active = PANELS.find((p) => p.key === panel)!;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="grid shrink-0 grid-cols-4 border-b border-border">
        {PANELS.map((p) => (
          <button
            key={p.key}
            onClick={() => onPanel(p.key)}
            title={p.label}
            className={cn(
              "flex flex-col items-center gap-1 py-2.5 text-[9px] font-medium uppercase tracking-wide transition",
              panel === p.key
                ? "border-b-2 border-teal-700 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <p.icon className="h-4 w-4" />
            {p.key}
          </button>
        ))}
      </div>
      <div className="border-b border-border bg-muted/40 px-4 py-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {active.label}
        </p>
      </div>
      {panel === "page" && <PagePanel page={page} onMetaSaved={onMetaSaved} />}
      {panel === "section" && <SectionPanel />}
      {panel === "elements" && <ElementsPanel />}
      {panel === "theme" && <ThemePanel />}
    </aside>
  );
}

/* ================================================================== */
/* Canvas                                                              */
/* ================================================================== */

function Canvas({ device }: { device: DeviceMode }) {
  const sections = useEditorStore((s) => s.sections);
  const theme = useEditorStore((s) => s.theme);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const addSection = useEditorStore((s) => s.addSection);

  const fontClass =
    theme.fontFamily === "serif"
      ? "font-serif"
      : theme.fontFamily === "mono"
        ? "font-mono"
        : "font-sans";

  return (
    <div className="flex-1 overflow-auto bg-muted/40 p-6" onClick={() => clearSelection()}>
      <div
        className={cn("mx-auto bg-white shadow-xl transition-all", fontClass)}
        style={{
          width: DEVICE_WIDTH[device],
          maxWidth: "100%",
          background: theme.bgColor,
          color: theme.textColor,
        }}
      >
        {sections.length === 0 ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-stone-500">This page has no sections</p>
            <p className="text-xs text-stone-400">
              Add one from the Section panel to start building.
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
