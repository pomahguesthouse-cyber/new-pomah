/**
 * Visual Page Builder — editor shell.
 *
 * Composes the four editor regions:
 *   • Toolbar      — device switcher, undo/redo, save, publish, settings
 *   • Left sidebar — component palette + layers tree
 *   • Canvas       — live, selectable preview rendered through the registry
 *   • Right panel  — auto-generated property editor (see property-panel.tsx)
 *
 * Persistence: a debounced autosave writes the draft 1.5s after the last
 * change; Save forces it immediately; Publish snapshots a version and
 * goes live. All state lives in the Zustand `useEditorStore`.
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
  Settings2,
  Plus,
  Layers,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  ExternalLink,
  LayoutTemplate,
  PanelTop,
  PanelBottom,
  Megaphone,
  Type,
  Image as ImageIcon,
  Grid3x3,
  BedDouble,
  CalendarCheck,
  Images,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEditorStore } from "./store";
import { PALETTE, getComponent } from "./registry";
import { NodeRenderer } from "./renderer";
import { PropertyPanel } from "./property-panel";
import type { ComponentType, DeviceMode, LandingPageRow } from "./types";
import { updateLandingPage, publishLandingPage } from "./builder.functions";

/* Map registry icon names → lucide components for the palette. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutTemplate,
  PanelTop,
  PanelBottom,
  Megaphone,
  Type,
  Image: ImageIcon,
  Grid3x3,
  BedDouble,
  CalendarCheck,
  Images,
};

const DEVICE_WIDTH: Record<DeviceMode, string> = {
  desktop: "100%",
  tablet: "820px",
  mobile: "390px",
};

const AUTOSAVE_MS = 1500;

/* ================================================================== */
/* Editor                                                              */
/* ================================================================== */

export function PageEditor({ page }: { page: LandingPageRow }) {
  const load = useEditorStore((s) => s.load);
  const nodes = useEditorStore((s) => s.nodes);
  const dirty = useEditorStore((s) => s.dirty);
  const device = useEditorStore((s) => s.device);
  const selectedId = useEditorStore((s) => s.selectedId);
  const markSaved = useEditorStore((s) => s.markSaved);
  const toContent = useEditorStore((s) => s.toContent);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const removeNode = useEditorStore((s) => s.removeNode);
  const select = useEditorStore((s) => s.select);

  const updateFn = useServerFn(updateLandingPage);
  const publishFn = useServerFn(publishLandingPage);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [publishing, setPublishing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [meta, setMeta] = useState({
    title: page.title,
    slug: page.slug,
    status: page.status,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the page document into the store once per page id.
  useEffect(() => {
    load(page.content);
    setMeta({ title: page.title, slug: page.slug, status: page.status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  /** Persist the current draft immediately. */
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

  // Debounced autosave whenever the tree changes.
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [nodes, dirty, save]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        meta &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        redo();
      } else if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId && !typing) {
        e.preventDefault();
        removeNode(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, save, removeNode, selectedId]);

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
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />
        <Canvas device={device} />
        <PropertyPanel />
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        page={page}
        onSaved={(m) => setMeta((prev) => ({ ...prev, ...m }))}
      />
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
  onOpenSettings,
}: {
  title: string;
  slug: string;
  status: string;
  dirty: boolean;
  saveState: "idle" | "saving" | "saved";
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  onOpenSettings: () => void;
}) {
  const device = useEditorStore((s) => s.device);
  const setDevice = useEditorStore((s) => s.setDevice);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-3">
      {/* Left */}
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

      {/* Center — device switcher */}
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
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* Right */}
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
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onOpenSettings}
          title="Page settings & SEO"
        >
          <Settings2 className="h-4 w-4" />
        </Button>

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
          className="h-8 gap-1.5 bg-amber-700 text-white hover:bg-amber-800"
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
/* Left sidebar — palette + layers                                     */
/* ================================================================== */

function LeftSidebar() {
  const [tab, setTab] = useState<"add" | "layers">("add");

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex shrink-0 border-b border-border">
        {(
          [
            ["add", "Add", Plus],
            ["layers", "Layers", Layers],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition",
              tab === key
                ? "border-b-2 border-amber-700 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {tab === "add" ? <Palette /> : <LayersTree />}
    </aside>
  );
}

function Palette() {
  const addNode = useEditorStore((s) => s.addNode);
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Components
      </p>
      <div className="grid grid-cols-2 gap-2">
        {PALETTE.map((type) => {
          const def = getComponent(type);
          if (!def) return null;
          const Icon = ICONS[def.icon] ?? LayoutTemplate;
          return (
            <button
              key={type}
              onClick={() => addNode(type)}
              title={def.description}
              className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-2.5 text-left transition hover:border-amber-700 hover:shadow-sm"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground group-hover:bg-amber-700 group-hover:text-white">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-medium leading-tight">{def.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Click a component to append it to the page. Select it on the canvas to edit.
      </p>
    </div>
  );
}

function LayersTree() {
  const nodes = useEditorStore((s) => s.nodes);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const moveNode = useEditorStore((s) => s.moveNode);

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <p className="mb-2 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Page structure
      </p>
      {nodes.length === 0 && (
        <p className="px-1 py-4 text-[11px] text-muted-foreground">No components yet.</p>
      )}
      <div className="space-y-0.5">
        {nodes.map((node, i) => {
          const def = getComponent(node.type);
          const Icon = ICONS[def?.icon ?? ""] ?? LayoutTemplate;
          return (
            <div
              key={node.id}
              onClick={() => select(node.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                node.id === selectedId
                  ? "bg-amber-50 text-amber-900"
                  : "hover:bg-muted text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{def?.label ?? node.type}</span>
              <span className="hidden gap-0.5 group-hover:flex">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveNode(node.id, "up");
                  }}
                  disabled={i === 0}
                  className="rounded p-0.5 hover:bg-background disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    moveNode(node.id, "down");
                  }}
                  disabled={i === nodes.length - 1}
                  className="rounded p-0.5 hover:bg-background disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Canvas                                                              */
/* ================================================================== */

function Canvas({ device }: { device: DeviceMode }) {
  const nodes = useEditorStore((s) => s.nodes);
  const select = useEditorStore((s) => s.select);

  return (
    <div className="flex-1 overflow-auto bg-muted/40 p-6" onClick={() => select(null)}>
      <div
        className="mx-auto bg-white shadow-xl transition-all"
        style={{ width: DEVICE_WIDTH[device], maxWidth: "100%" }}
      >
        {nodes.length === 0 ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-stone-500">Your page is empty</p>
            <p className="text-xs text-stone-400">
              Add components from the left panel to start building.
            </p>
          </div>
        ) : (
          nodes.map((node, i) => (
            <NodeFrame key={node.id} nodeId={node.id} index={i} total={nodes.length}>
              <NodeRenderer node={node} />
            </NodeFrame>
          ))
        )}
      </div>
    </div>
  );
}

/** Wraps a rendered node with selection, hover outline and a quick toolbar. */
function NodeFrame({
  nodeId,
  index,
  total,
  children,
}: {
  nodeId: string;
  index: number;
  total: number;
  children: React.ReactNode;
}) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const moveNode = useEditorStore((s) => s.moveNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const removeNode = useEditorStore((s) => s.removeNode);
  const nodeType = useEditorStore((s) => s.nodes.find((n) => n.id === nodeId)?.type);
  const def = nodeType ? getComponent(nodeType) : undefined;
  const selected = selectedId === nodeId;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        select(nodeId);
      }}
      className={cn(
        "group/node relative cursor-pointer outline-offset-[-2px]",
        selected
          ? "outline outline-2 outline-amber-600"
          : "hover:outline hover:outline-2 hover:outline-amber-300",
      )}
    >
      {/* Label tab */}
      <span
        className={cn(
          "absolute left-0 top-0 z-10 rounded-br-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white transition-opacity",
          selected
            ? "bg-amber-600 opacity-100"
            : "bg-amber-400 opacity-0 group-hover/node:opacity-100",
        )}
      >
        {def?.label}
      </span>

      {/* Quick toolbar */}
      {selected && (
        <div className="absolute right-2 top-2 z-10 flex gap-0.5 rounded-md bg-stone-900/90 p-0.5 shadow-lg">
          <ToolbarBtn title="Move up" disabled={index === 0} onClick={() => moveNode(nodeId, "up")}>
            <ChevronUp className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn
            title="Move down"
            disabled={index === total - 1}
            onClick={() => moveNode(nodeId, "down")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Duplicate" onClick={() => duplicateNode(nodeId)}>
            <Copy className="h-3.5 w-3.5" />
          </ToolbarBtn>
          <ToolbarBtn title="Delete" onClick={() => removeNode(nodeId)}>
            <Trash2 className="h-3.5 w-3.5" />
          </ToolbarBtn>
        </div>
      )}

      {/* Rendered component — pointer-events disabled so clicks select. */}
      <div className="pointer-events-none">{children}</div>
    </div>
  );
}

function ToolbarBtn({
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
      className="rounded p-1 text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/* ================================================================== */
/* Page settings + SEO dialog                                          */
/* ================================================================== */

function SettingsDialog({
  open,
  onOpenChange,
  page,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  page: LandingPageRow;
  onSaved: (meta: { title: string; slug: string }) => void;
}) {
  const updateFn = useServerFn(updateLandingPage);
  const [form, setForm] = useState({
    title: page.title,
    slug: page.slug,
    seo_title: page.seo_title ?? "",
    seo_description: page.seo_description ?? "",
    og_image_url: page.og_image_url ?? "",
    noindex: page.noindex,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateFn({
        data: {
          id: page.id,
          title: form.title,
          slug: form.slug,
          seo_title: form.seo_title || null,
          seo_description: form.seo_description || null,
          og_image_url: form.og_image_url || null,
          noindex: form.noindex,
        },
      });
      onSaved({ title: form.title, slug: form.slug });
      toast.success("Page settings saved");
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Page settings & SEO</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <Field label="Page title">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Slug" hint="Lowercase letters, numbers and hyphens. Page lives at /p/slug">
            <Input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="font-mono"
            />
          </Field>
          <div className="h-px bg-border" />
          <Field label="SEO title">
            <Input
              value={form.seo_title}
              onChange={(e) => setForm({ ...form, seo_title: e.target.value })}
              placeholder={form.title}
            />
          </Field>
          <Field label="Meta description">
            <Textarea
              rows={2}
              value={form.seo_description}
              onChange={(e) => setForm({ ...form, seo_description: e.target.value })}
            />
          </Field>
          <Field label="OG image URL">
            <Input
              value={form.og_image_url}
              onChange={(e) => setForm({ ...form, og_image_url: e.target.value })}
              placeholder="https://…"
              className="font-mono"
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Hide from search engines</p>
              <p className="text-xs text-muted-foreground">Adds a noindex tag to this page.</p>
            </div>
            <Switch
              checked={form.noindex}
              onCheckedChange={(c) => setForm({ ...form, noindex: c })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-amber-700 text-white hover:bg-amber-800"
            disabled={saving}
            onClick={save}
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Re-exported so the editor route can show a "view live" affordance. */
export function ViewLiveLink({ slug }: { slug: string }) {
  return (
    <a
      href={`/p/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="h-3 w-3" />
      View live
    </a>
  );
}
