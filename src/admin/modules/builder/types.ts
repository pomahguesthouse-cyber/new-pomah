/**
 * Visual Page Editor — core type system.
 *
 * A page is a versioned JSONB document: `PageContent`. It holds an
 * ordered list of `Section`s; each section is a responsive grid that
 * contains `Element`s. Elements resolve against the component registry;
 * their free-form `props` bag is described by a `fields` schema that
 * auto-generates the property controls.
 *
 * The page also carries a `PageTheme` (global colors / font / radius)
 * applied as CSS variables when the document is rendered.
 */

/* ------------------------------------------------------------------ */
/* Element + section model                                             */
/* ------------------------------------------------------------------ */

/** Identifiers of every element available in the editor. */
export type ElementType =
  | "heading"
  | "text"
  | "image"
  | "button"
  | "hero"
  | "hero-slider"
  | "date-picker"
  | "features"
  | "rooms"
  | "room-card"
  | "location"
  | "gallery"
  | "cta"
  | "navbar"
  | "footer"
  | "spacer";

/** Backwards-compatible alias — earlier code referred to `ComponentType`. */
export type ComponentType = ElementType;

/** A single element placed inside a section's grid. */
export interface Element {
  id: string;
  type: ElementType;
  /** Free-form props bag; shape described by the registry `fields`. */
  props: Record<string, unknown>;
  /** Grid column span (1..section.columns). Defaults to full width. */
  colSpan?: number;
}

/** Legacy alias — the old flat model called these `PageNode`. */
export type PageNode = Element;

/** How wide a section's inner content container is. */
export type SectionWidth = "full" | "wide" | "narrow";

/** A section: a responsive grid container holding elements. */
export interface Section {
  id: string;
  /** Human label shown in the Section panel. */
  name: string;
  /** Number of grid columns on desktop (1..4). */
  columns: number;
  /** Gap between grid cells, in pixels. */
  gap: number;
  /** Vertical padding, in pixels. */
  paddingY: number;
  /** Inner content max-width. */
  width: SectionWidth;
  /** Section background color. */
  bgColor: string;
  /** Elements laid out in the grid, in order. */
  elements: Element[];
}

/** Global look-and-feel applied to the whole page. */
export interface PageTheme {
  primaryColor: string;
  textColor: string;
  bgColor: string;
  fontFamily: "sans" | "serif" | "mono";
  /** Base border radius, in pixels. */
  radius: number;
}

/** The full versioned document persisted in `landing_pages.content`. */
export interface PageContent {
  version: number;
  sections: Section[];
  theme: PageTheme;
}

/** The breakpoint currently previewed in the editor. */
export type DeviceMode = "desktop" | "tablet" | "mobile";

/* ------------------------------------------------------------------ */
/* Property-panel field schema                                         */
/* ------------------------------------------------------------------ */

/** Kinds of editable controls the property panel can render. */
export type FieldType = "text" | "textarea" | "number" | "color" | "select" | "image" | "boolean";

/** Describes one editable property of a component. */
export interface FieldDef {
  /** Key inside the element's `props` bag. */
  key: string;
  /** Human label shown in the property panel. */
  label: string;
  type: FieldType;
  /** Options for `select` fields. */
  options?: { label: string; value: string }[];
  /** Grouping header in the property panel. */
  group?: string;
  /** Help text shown beneath the control. */
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* Component registry definition                                       */
/* ------------------------------------------------------------------ */

/** Palette grouping for the Elements panel. */
export type ElementCategory = "Basic" | "Media" | "Hospitality" | "Layout";

/** A registered editor element: metadata + defaults + renderer. */
export interface ComponentDef {
  type: ElementType;
  /** Display name in the palette / layers panel. */
  label: string;
  /** lucide-react icon name used by the palette. */
  icon: string;
  /** Short description shown in the palette. */
  description: string;
  /** Palette category. */
  category: ElementCategory;
  /** Initial props when the element is added to a section. */
  defaults: Record<string, unknown>;
  /** Editable fields — drives the property panel. */
  fields: FieldDef[];
  /** The actual React renderer for this element. */
  render: (props: Record<string, unknown>) => React.ReactNode;
}

/* ------------------------------------------------------------------ */
/* Persistence row shapes (tables not yet in generated Supabase types) */
/* ------------------------------------------------------------------ */

export type PageStatus = "draft" | "published";

export interface LandingPageRow {
  id: string;
  title: string;
  slug: string;
  status: PageStatus;
  content: PageContent;
  published_content: PageContent | null;
  seo_title: string | null;
  seo_description: string | null;
  og_image_url: string | null;
  canonical_url: string | null;
  noindex: boolean;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface LandingPageVersionRow {
  id: string;
  page_id: string;
  version_number: number;
  content: PageContent;
  label: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Defaults + normalization                                            */
/* ------------------------------------------------------------------ */

/** The default theme applied to new pages. */
export const DEFAULT_THEME: PageTheme = {
  primaryColor: "#0f766e",
  textColor: "#1c1917",
  bgColor: "#ffffff",
  fontFamily: "sans",
  radius: 12,
};

let counter = 0;
/** Stable unique id for sections / elements. */
export function uid(prefix = "n"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

/** Build a fresh, empty section. */
export function emptySection(name = "Section"): Section {
  return {
    id: uid("s"),
    name,
    columns: 1,
    gap: 24,
    paddingY: 64,
    width: "wide",
    bgColor: "#ffffff",
    elements: [],
  };
}

/** An empty page document: one section + default theme. */
export const EMPTY_PAGE: PageContent = {
  version: 2,
  sections: [emptySection("Hero")],
  theme: { ...DEFAULT_THEME },
};

/**
 * Coerce any persisted document into the current `PageContent` shape.
 *
 * Handles three cases:
 *   • already v2 (`{ sections, theme }`) — returned as-is.
 *   • legacy v1 (`{ nodes: [...] }`) — each node becomes its own
 *     single-column section so old pages keep rendering.
 *   • null / malformed — falls back to an empty page.
 */
export function normalizePage(raw: unknown): PageContent {
  const doc = (raw ?? {}) as Record<string, unknown>;

  if (Array.isArray(doc.sections)) {
    return {
      version: 2,
      sections: (doc.sections as Section[]).map((s) => ({
        ...emptySection(),
        ...s,
        elements: Array.isArray(s.elements) ? s.elements : [],
      })),
      theme: { ...DEFAULT_THEME, ...(doc.theme as PageTheme | undefined) },
    };
  }

  if (Array.isArray(doc.nodes)) {
    return {
      version: 2,
      sections: (doc.nodes as PageNode[]).map((n) => ({
        ...emptySection(n.type),
        paddingY: 0,
        bgColor: "transparent",
        width: "full",
        elements: [{ id: uid("e"), type: n.type, props: n.props ?? {}, colSpan: 1 }],
      })),
      theme: { ...DEFAULT_THEME },
    };
  }

  return { version: 2, sections: [emptySection("Hero")], theme: { ...DEFAULT_THEME } };
}
