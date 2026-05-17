/**
 * Editor state store (Zustand).
 *
 * Holds the working section tree, the page theme, the current selection
 * and a full undo/redo history. Every structural mutation goes through
 * `commit()`, which snapshots the previous state — so undo/redo, dirty
 * tracking and autosave all stay correct.
 */
import { create } from "zustand";
import type { DeviceMode, Element, ElementType, PageContent, PageTheme, Section } from "./types";
import { DEFAULT_THEME, emptySection, normalizePage, uid } from "./types";
import { getComponent } from "./registry";

/** Max snapshots kept on the undo stack. */
const HISTORY_LIMIT = 50;

/** A point-in-time snapshot used by undo/redo. */
interface Snapshot {
  sections: Section[];
  theme: PageTheme;
}

interface EditorState {
  /** Ordered section tree. */
  sections: Section[];
  /** Global page theme. */
  theme: PageTheme;
  /** Selected section id, or null. */
  selectedSectionId: string | null;
  /** Selected element id, or null. */
  selectedElementId: string | null;
  /** Active responsive preview device. */
  device: DeviceMode;
  /** Unsaved changes since last `markSaved()`. */
  dirty: boolean;
  /** Undo / redo snapshot stacks. */
  past: Snapshot[];
  future: Snapshot[];

  /* lifecycle */
  load: (content: unknown) => void;
  markSaved: () => void;
  toContent: () => PageContent;

  /* selection + device */
  selectSection: (id: string | null) => void;
  selectElement: (sectionId: string, elementId: string) => void;
  clearSelection: () => void;
  setDevice: (device: DeviceMode) => void;

  /* section mutations */
  addSection: (atIndex?: number) => void;
  updateSection: (id: string, patch: Partial<Section>) => void;
  removeSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  moveSection: (fromIndex: number, toIndex: number) => void;

  /* element mutations */
  addElement: (sectionId: string, type: ElementType) => void;
  updateElementProps: (
    sectionId: string,
    elementId: string,
    patch: Record<string, unknown>,
  ) => void;
  updateElement: (sectionId: string, elementId: string, patch: Partial<Element>) => void;
  removeElement: (sectionId: string, elementId: string) => void;
  duplicateElement: (sectionId: string, elementId: string) => void;
  moveElement: (sectionId: string, elementId: string, direction: "up" | "down") => void;

  /* theme */
  updateTheme: (patch: Partial<PageTheme>) => void;

  /* history */
  undo: () => void;
  redo: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Apply a change while recording an undo snapshot. */
  const commit = (next: Partial<Snapshot>) => {
    const { sections, theme, past } = get();
    set({
      sections: next.sections ?? sections,
      theme: next.theme ?? theme,
      past: [...past, { sections, theme }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  };

  const mapSection = (id: string, fn: (s: Section) => Section) =>
    get().sections.map((s) => (s.id === id ? fn(s) : s));

  return {
    sections: [],
    theme: { ...DEFAULT_THEME },
    selectedSectionId: null,
    selectedElementId: null,
    device: "desktop",
    dirty: false,
    past: [],
    future: [],

    load: (content) => {
      const doc = normalizePage(content);
      set({
        sections: doc.sections,
        theme: doc.theme,
        selectedSectionId: doc.sections[0]?.id ?? null,
        selectedElementId: null,
        past: [],
        future: [],
        dirty: false,
      });
    },

    markSaved: () => set({ dirty: false }),

    toContent: () => ({ version: 2, sections: get().sections, theme: get().theme }),

    selectSection: (id) => set({ selectedSectionId: id, selectedElementId: null }),

    selectElement: (sectionId, elementId) =>
      set({ selectedSectionId: sectionId, selectedElementId: elementId }),

    clearSelection: () => set({ selectedElementId: null }),

    setDevice: (device) => set({ device }),

    /* ---- sections -------------------------------------------------- */

    addSection: (atIndex) => {
      const section = emptySection(`Section ${get().sections.length + 1}`);
      const sections = [...get().sections];
      sections.splice(atIndex ?? sections.length, 0, section);
      commit({ sections });
      set({ selectedSectionId: section.id, selectedElementId: null });
    },

    updateSection: (id, patch) => commit({ sections: mapSection(id, (s) => ({ ...s, ...patch })) }),

    removeSection: (id) => {
      commit({ sections: get().sections.filter((s) => s.id !== id) });
      if (get().selectedSectionId === id) set({ selectedSectionId: null, selectedElementId: null });
    },

    duplicateSection: (id) => {
      const sections = [...get().sections];
      const i = sections.findIndex((s) => s.id === id);
      if (i === -1) return;
      const src = sections[i];
      const copy: Section = {
        ...src,
        id: uid("s"),
        name: `${src.name} copy`,
        elements: src.elements.map((e) => ({ ...e, id: uid("e"), props: { ...e.props } })),
      };
      sections.splice(i + 1, 0, copy);
      commit({ sections });
      set({ selectedSectionId: copy.id, selectedElementId: null });
    },

    moveSection: (fromIndex, toIndex) => {
      const sections = [...get().sections];
      if (fromIndex < 0 || fromIndex >= sections.length) return;
      const [moved] = sections.splice(fromIndex, 1);
      sections.splice(Math.max(0, Math.min(toIndex, sections.length)), 0, moved);
      commit({ sections });
    },

    /* ---- elements -------------------------------------------------- */

    addElement: (sectionId, type) => {
      const def = getComponent(type);
      if (!def) return;
      const element: Element = { id: uid("e"), type, props: { ...def.defaults }, colSpan: 1 };
      commit({
        sections: mapSection(sectionId, (s) => ({ ...s, elements: [...s.elements, element] })),
      });
      set({ selectedSectionId: sectionId, selectedElementId: element.id });
    },

    updateElementProps: (sectionId, elementId, patch) =>
      commit({
        sections: mapSection(sectionId, (s) => ({
          ...s,
          elements: s.elements.map((e) =>
            e.id === elementId ? { ...e, props: { ...e.props, ...patch } } : e,
          ),
        })),
      }),

    updateElement: (sectionId, elementId, patch) =>
      commit({
        sections: mapSection(sectionId, (s) => ({
          ...s,
          elements: s.elements.map((e) => (e.id === elementId ? { ...e, ...patch } : e)),
        })),
      }),

    removeElement: (sectionId, elementId) => {
      commit({
        sections: mapSection(sectionId, (s) => ({
          ...s,
          elements: s.elements.filter((e) => e.id !== elementId),
        })),
      });
      if (get().selectedElementId === elementId) set({ selectedElementId: null });
    },

    duplicateElement: (sectionId, elementId) => {
      let newId: string | null = null;
      commit({
        sections: mapSection(sectionId, (s) => {
          const i = s.elements.findIndex((e) => e.id === elementId);
          if (i === -1) return s;
          newId = uid("e");
          const copy: Element = { ...s.elements[i], id: newId, props: { ...s.elements[i].props } };
          const elements = [...s.elements];
          elements.splice(i + 1, 0, copy);
          return { ...s, elements };
        }),
      });
      if (newId) set({ selectedElementId: newId });
    },

    moveElement: (sectionId, elementId, direction) =>
      commit({
        sections: mapSection(sectionId, (s) => {
          const i = s.elements.findIndex((e) => e.id === elementId);
          if (i === -1) return s;
          const target = direction === "up" ? i - 1 : i + 1;
          if (target < 0 || target >= s.elements.length) return s;
          const elements = [...s.elements];
          [elements[i], elements[target]] = [elements[target], elements[i]];
          return { ...s, elements };
        }),
      }),

    /* ---- theme ----------------------------------------------------- */

    updateTheme: (patch) => commit({ theme: { ...get().theme, ...patch } }),

    /* ---- history --------------------------------------------------- */

    undo: () => {
      const { past, future, sections, theme } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        sections: previous.sections,
        theme: previous.theme,
        past: past.slice(0, -1),
        future: [{ sections, theme }, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
      });
    },

    redo: () => {
      const { past, future, sections, theme } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        sections: next.sections,
        theme: next.theme,
        past: [...past, { sections, theme }].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        dirty: true,
      });
    },
  };
});
