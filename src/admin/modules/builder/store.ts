/**
 * Editor state store (Zustand).
 *
 * Holds the working component tree, selection, preview device and a
 * full undo/redo history. Every structural mutation goes through
 * `commit()`, which snapshots the previous node list onto the undo
 * stack — so undo/redo, dirty tracking and autosave all stay correct.
 */
import { create } from "zustand";
import type { ComponentType, DeviceMode, PageContent, PageNode } from "./types";
import { getComponent } from "./registry";

/** Max snapshots kept on the undo stack. */
const HISTORY_LIMIT = 50;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `n_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

interface EditorState {
  /** Current component tree. */
  nodes: PageNode[];
  /** Currently selected node id, or null. */
  selectedId: string | null;
  /** Active responsive preview device. */
  device: DeviceMode;
  /** Unsaved changes since last `markSaved()`. */
  dirty: boolean;
  /** Undo / redo snapshot stacks. */
  past: PageNode[][];
  future: PageNode[][];

  /* lifecycle */
  load: (content: PageContent) => void;
  markSaved: () => void;
  toContent: () => PageContent;

  /* selection + device */
  select: (id: string | null) => void;
  setDevice: (device: DeviceMode) => void;

  /* mutations */
  addNode: (type: ComponentType, atIndex?: number) => void;
  updateProps: (id: string, patch: Record<string, unknown>) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  moveNode: (id: string, direction: "up" | "down") => void;
  reorder: (fromIndex: number, toIndex: number) => void;

  /* history */
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Apply a structural change while recording an undo snapshot. */
  const commit = (next: PageNode[]) => {
    const { nodes, past } = get();
    set({
      nodes: next,
      past: [...past, nodes].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  };

  return {
    nodes: [],
    selectedId: null,
    device: "desktop",
    dirty: false,
    past: [],
    future: [],

    load: (content) =>
      set({
        nodes: content?.nodes ?? [],
        selectedId: null,
        past: [],
        future: [],
        dirty: false,
      }),

    markSaved: () => set({ dirty: false }),

    toContent: () => ({ version: 1, nodes: get().nodes }),

    select: (id) => set({ selectedId: id }),

    setDevice: (device) => set({ device }),

    addNode: (type, atIndex) => {
      const def = getComponent(type);
      if (!def) return;
      const node: PageNode = { id: uid(), type, props: { ...def.defaults } };
      const nodes = [...get().nodes];
      const index = atIndex ?? nodes.length;
      nodes.splice(index, 0, node);
      commit(nodes);
      set({ selectedId: node.id });
    },

    updateProps: (id, patch) => {
      const nodes = get().nodes.map((n) =>
        n.id === id ? { ...n, props: { ...n.props, ...patch } } : n,
      );
      commit(nodes);
    },

    removeNode: (id) => {
      commit(get().nodes.filter((n) => n.id !== id));
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicateNode: (id) => {
      const nodes = [...get().nodes];
      const index = nodes.findIndex((n) => n.id === id);
      if (index === -1) return;
      const copy: PageNode = {
        id: uid(),
        type: nodes[index].type,
        props: { ...nodes[index].props },
      };
      nodes.splice(index + 1, 0, copy);
      commit(nodes);
      set({ selectedId: copy.id });
    },

    moveNode: (id, direction) => {
      const nodes = [...get().nodes];
      const index = nodes.findIndex((n) => n.id === id);
      if (index === -1) return;
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= nodes.length) return;
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      commit(nodes);
    },

    reorder: (fromIndex, toIndex) => {
      const nodes = [...get().nodes];
      if (fromIndex < 0 || fromIndex >= nodes.length) return;
      const [moved] = nodes.splice(fromIndex, 1);
      nodes.splice(Math.max(0, Math.min(toIndex, nodes.length)), 0, moved);
      commit(nodes);
    },

    undo: () => {
      const { past, future, nodes } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        nodes: previous,
        past: past.slice(0, -1),
        future: [nodes, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const { past, future, nodes } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        nodes: next,
        past: [...past, nodes].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        dirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});
