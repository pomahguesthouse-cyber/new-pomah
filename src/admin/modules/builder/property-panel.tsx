/**
 * Property panel — the contextual right sidebar of the editor.
 *
 * For the selected element it reads the registry `fields` schema and
 * auto-generates grouped, live-updating controls. Every change is pushed
 * straight into the editor store, so the canvas re-renders instantly.
 */
import { useMemo } from "react";
import { Trash2, Copy, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "./store";
import { getComponent } from "./registry";
import type { FieldDef } from "./types";

export function PropertyPanel() {
  const sectionId = useEditorStore((s) => s.selectedSectionId);
  const elementId = useEditorStore((s) => s.selectedElementId);
  const element = useEditorStore(
    (s) =>
      s.sections
        .find((x) => x.id === s.selectedSectionId)
        ?.elements.find((e) => e.id === s.selectedElementId) ?? null,
  );
  const section = useEditorStore(
    (s) => s.sections.find((x) => x.id === s.selectedSectionId) ?? null,
  );
  const updateElementProps = useEditorStore((s) => s.updateElementProps);
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);
  const duplicateElement = useEditorStore((s) => s.duplicateElement);

  const def = element ? getComponent(element.type) : undefined;

  const groups = useMemo(() => {
    if (!def) return [] as { name: string; fields: FieldDef[] }[];
    const order: string[] = [];
    const map = new Map<string, FieldDef[]>();
    for (const f of def.fields) {
      const g = f.group ?? "General";
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push(f);
    }
    return order.map((name) => ({ name, fields: map.get(name)! }));
  }, [def]);

  if (!element || !def || !section || !sectionId || !elementId) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
        <PanelHeader title="Properties" />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <SlidersHorizontal className="h-5 w-5 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">
            Select an element on the canvas to edit its properties.
          </p>
        </div>
      </aside>
    );
  }

  const cols = Math.max(1, Math.min(section.columns, 4));

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {def.label}
          </p>
          <p className="text-xs text-muted-foreground/70">Element properties</p>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Duplicate"
            onClick={() => duplicateElement(sectionId, elementId)}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            title="Delete"
            onClick={() => removeElement(sectionId, elementId)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {cols > 1 && (
          <div className="border-b border-border/60 px-4 py-3">
            <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Grid
            </p>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-foreground/80">
                Column span ({Math.min(element.colSpan ?? 1, cols)} / {cols})
              </Label>
              <input
                type="range"
                min={1}
                max={cols}
                value={Math.min(element.colSpan ?? 1, cols)}
                onChange={(e) =>
                  updateElement(sectionId, elementId, { colSpan: Number(e.target.value) })
                }
                className="w-full accent-teal-700"
              />
            </div>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.name} className="border-b border-border/60 px-4 py-3">
            <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {group.name}
            </p>
            <div className="space-y-3">
              {group.fields.map((field) => (
                <FieldControl
                  key={field.key}
                  field={field}
                  value={element.props[field.key]}
                  onChange={(v) => updateElementProps(sectionId, elementId, { [field.key]: v })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function PanelHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-border px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Field controls                                                      */
/* ------------------------------------------------------------------ */

export function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const s = typeof value === "string" ? value : value == null ? "" : String(value);

  return (
    <div className="space-y-1.5">
      {field.type !== "boolean" && (
        <Label className="text-[11px] font-medium text-foreground/80">{field.label}</Label>
      )}

      {field.type === "text" && (
        <Input value={s} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
      )}

      {field.type === "textarea" && (
        <Textarea
          value={s}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="text-sm"
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          value={s}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-sm"
        />
      )}

      {field.type === "image" && (
        <Input
          value={s}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm font-mono"
        />
      )}

      {field.type === "color" && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(s) ? s : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input
            value={s}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
      )}

      {field.type === "select" && (
        <select
          value={s}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-8 w-full rounded-md border border-input bg-background px-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {field.type === "boolean" && (
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-medium text-foreground/80">{field.label}</Label>
          <Switch checked={value === true} onCheckedChange={(c) => onChange(c)} />
        </div>
      )}

      {field.hint && <p className="text-[10px] text-muted-foreground">{field.hint}</p>}
    </div>
  );
}
