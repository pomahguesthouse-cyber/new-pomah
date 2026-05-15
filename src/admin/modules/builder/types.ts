/**
 * Visual Page Builder — core type system.
 *
 * A page is a versioned JSONB document: `PageContent`. It holds a flat
 * ordered list of section `PageNode`s. Each node has a `type` resolved
 * against the component registry and a free-form `props` bag whose shape
 * is described by that component's `fields` schema (used to auto-generate
 * the property panel).
 */

/** Identifiers of every component available in the builder. */
export type ComponentType =
  | "hero"
  | "navbar"
  | "footer"
  | "cta"
  | "text"
  | "image"
  | "features"
  | "room-card"
  | "booking-widget"
  | "gallery";

/** A single section in a page. Phase 1 keeps the tree flat (no nesting). */
export interface PageNode {
  id: string;
  type: ComponentType;
  props: Record<string, unknown>;
}

/** The full versioned document persisted in `landing_pages.content`. */
export interface PageContent {
  version: number;
  nodes: PageNode[];
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
  /** Key inside the node's `props` bag. */
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

/** A registered builder component: metadata + defaults + renderer. */
export interface ComponentDef {
  type: ComponentType;
  /** Display name in the palette / layers panel. */
  label: string;
  /** lucide-react icon name used by the palette. */
  icon: string;
  /** Short description shown in the palette. */
  description: string;
  /** Initial props when the component is added to a page. */
  defaults: Record<string, unknown>;
  /** Editable fields — drives the property panel. */
  fields: FieldDef[];
  /** The actual React renderer for this component. */
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

/** An empty page document. */
export const EMPTY_PAGE: PageContent = { version: 1, nodes: [] };
