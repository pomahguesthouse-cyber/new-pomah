/**
 * Property panel — the right sidebar of the editor.
 *
 * For the selected node it reads the component's `fields` schema from
 * the registry and auto-generates grouped, live-updating controls.
 * Every change is pushed straight into the editor store, so the canvas
 * re-renders instantly.
 */
import { useMemo } from "react";
import { Trash2, Copy } from "lucide-react";
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
  const selectedId = useEditorStore((s) => s.selectedId);
  const node = useEditorStore((s) => s.nodes.find((n) => n.id === s.selectedId) ?? null);
  const updateProps = useEditorStore((s) => s.updateProps);
  const removeNode = useEditorStore((s) => s.removeNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);

  const def = node ? getComponent(node.type) : undefined;

  // Group fields by their `group` label, preserving declaration order.
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

  if (!node || !def) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Properties
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
          Select a component on the canvas to edit its properties.
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {def.label}
          </p>
          <p className="text-xs text-muted-foreground/70">Component properties</p>
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Duplicate"
            onClick={() => duplicateNode(node.id)}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive"
            title="Delete"
            onClick={() => removeNode(node.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
                  value={node.props[field.key]}
                  onChange={(v) => updateProps(node.id, { [field.key]: v })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Field controls                                                      */
/* ------------------------------------------------------------------ */

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const str = typeof value === "string" ? value : value == null ? "" : String(value);

  return (
    <div className="space-y-1.5">
      {field.type !== "boolean" && (
        <Label className="text-[11px] font-medium text-foreground/80">{field.label}</Label>
      )}

      {field.type === "text" && (
        <Input value={str} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
      )}

      {field.type === "textarea" && (
        <Textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="text-sm"
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          value={str}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-sm"
        />
      )}

      {field.type === "image" && (
        <Input
          value={str}
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm font-mono"
        />
      )}

      {field.type === "color" && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(str) ? str : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input
            value={str}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
      )}

      {field.type === "select" && (
        <select
          value={str}
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
