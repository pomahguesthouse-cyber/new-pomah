/**
 * Technical SEO for builder landing pages (/lp/:slug).
 * Pure functions: one H1, one indexed section tree, robots, and JSON-LD
 * that can be emitted from the route head() during SSR.
 */
import { faqPageGraph, landingBuilderGraph, type FaqItem } from "@/public/lib/structured-data";
import { stripPublicHotWaterClaim, stripPublicHotWaterJsonText } from "@/public/content/approved-seo";

export type LandingSectionLike = {
  id?: string | null;
  type?: string | null;
  headline?: string | null;
  image_url?: string | null;
  slides?: Array<{ imageUrl?: string | null; heading?: string | null }> | null;
  items?: ReadonlyArray<{
    question?: string | null;
    answer?: string | null;
    title?: string | null;
    description?: string | null;
    name?: string | null;
    text?: string | null;
  }> | null;
  source?: string | null;
};

export type LandingHeadingTag = "h1" | "h2";

type SplitSections = {
  split?: boolean;
  desktop?: LandingSectionLike[];
  mobile?: LandingSectionLike[];
};

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Desktop content is the indexed document. Mobile is used only when desktop is empty. */
export function publicLandingSections<T = LandingSectionLike>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data !== "object") return [];
  const split = data as SplitSections;
  const desktop = Array.isArray(split.desktop) ? split.desktop : [];
  if (desktop.length > 0) return desktop as T[];
  return (Array.isArray(split.mobile) ? split.mobile : []) as T[];
}

/** Both device trees, for deciding whether the loader should fetch reviews. */
export function allLandingSections(data: unknown): LandingSectionLike[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as LandingSectionLike[];
  if (typeof data !== "object") return [];
  const split = data as SplitSections;
  return [...(split.desktop ?? []), ...(split.mobile ?? [])];
}

export function landingSectionId(section: LandingSectionLike, index: number): string {
  const id = text(section.id);
  return id || `idx-${index}`;
}

function isHeroOrSlider(section: LandingSectionLike): boolean {
  return section.type === "hero" || section.type === "slider";
}

function sectionHasHeading(section: LandingSectionLike): boolean {
  if (section.type === "hero") return Boolean(text(section.headline));
  if (section.type === "slider") {
    return (section.slides ?? []).some((slide) => Boolean(text(slide.heading)));
  }
  return false;
}

function sectionHasImage(section: LandingSectionLike): boolean {
  if (section.type === "hero") return Boolean(text(section.image_url));
  if (section.type === "slider") {
    return (section.slides ?? []).some((slide) => Boolean(text(slide.imageUrl)));
  }
  return false;
}

export function landingDocumentOutline(
  sections: readonly LandingSectionLike[],
  page: {
    hero_headline?: string | null;
    meta_title?: string | null;
    title?: string | null;
  },
): { h1SectionId: string | null; eagerSectionId: string | null; fallbackH1: string | null } {
  let h1SectionId: string | null = null;
  let eagerSectionId: string | null = null;
  sections.forEach((section, index) => {
    if (!isHeroOrSlider(section)) return;
    const id = landingSectionId(section, index);
    if (!h1SectionId && sectionHasHeading(section)) h1SectionId = id;
    if (!eagerSectionId && sectionHasImage(section)) eagerSectionId = id;
  });
  const fallbackH1 = h1SectionId
    ? null
    : text(page.hero_headline) || text(page.meta_title) || text(page.title) || null;
  return { h1SectionId, eagerSectionId, fallbackH1 };
}

/** Rich-text blocks must not add a second H1 once the page heading is chosen. */
export function demoteContentH1(html: string | null | undefined): string {
  return (html ?? "").replace(/<(\/?)h1\b/gi, "<$1h2");
}

export function blockHeadingTag(
  sectionId: string,
  h1SectionId: string | null,
  demote = false,
): LandingHeadingTag {
  if (demote) return "h2";
  return h1SectionId != null && sectionId === h1SectionId ? "h1" : "h2";
}

export function firstHeroImageUrl(sections: readonly LandingSectionLike[]): string | null {
  for (const section of sections) {
    if (section.type === "hero") {
      const url = text(section.image_url);
      if (url) return url;
    }
    if (section.type === "slider") {
      for (const slide of section.slides ?? []) {
        const url = text(slide.imageUrl);
        if (url) return url;
      }
    }
  }
  return null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function collectLandingFaqs(sections: readonly LandingSectionLike[]): FaqItem[] {
  const faqs: FaqItem[] = [];
  for (const section of sections) {
    if (section.type !== "faq") continue;
    for (const item of section.items ?? []) {
      const question = stripPublicHotWaterClaim(text(item.question));
      const answer = stripPublicHotWaterClaim(stripTags(text(item.answer)));
      if (question && answer) faqs.push({ question, answer });
    }
  }
  return faqs;
}

export function landingNeedsGoogleReviews(sections: readonly LandingSectionLike[]): boolean {
  return sections.some((section) => section.type === "testimonials" && section.source === "google");
}

/**
 * `custom_robots` is the meta robots content. `noindex` forces the page out
 * of the index even when that field says otherwise.
 */
export function landingRobotsContent(
  customRobots: string | null | undefined,
  noindex: boolean | null | undefined,
): string | null {
  const custom = (customRobots ?? "").replace(/\s+/g, " ").trim();
  if (noindex) {
    if (!custom) return "noindex, follow";
    const rest = custom
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !/^(no)?index$/i.test(part));
    return ["noindex", ...rest].join(", ");
  }
  return custom || null;
}

export function filterIndexableLandingRows<T extends { noindex?: boolean | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.noindex !== true);
}

export function parseCustomJsonLd(raw: string | null | undefined): unknown | null {
  const textValue = (raw ?? "").trim();
  if (!textValue) return null;
  try {
    const value = JSON.parse(textValue) as unknown;
    if (!value || typeof value !== "object") return null;
    return value;
  } catch {
    return null;
  }
}

function nodeTypes(node: unknown): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return [];
  const value = (node as { "@type"?: unknown })["@type"];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/** Drop nodes whose types are already emitted (global identity, or this page's own graph). */
export function omitDuplicateJsonLd(value: unknown, skipTypes: readonly string[]): unknown | null {
  const skip = new Set(skipTypes);
  const prune = (node: unknown): unknown | null => {
    if (Array.isArray(node)) {
      const items = node.map(prune).filter((item) => item != null);
      return items.length > 0 ? items : null;
    }
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record["@graph"])) {
      const graph = (record["@graph"] as unknown[]).map(prune).filter((item) => item != null);
      if (graph.length === 0) return null;
      return { ...record, "@graph": graph };
    }
    const types = nodeTypes(record);
    if (types.length > 0 && types.every((type) => skip.has(type))) return null;
    return record;
  };
  return prune(value);
}

export function jsonLdScriptText(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const ATTR_NAMES: Record<string, string> = {
  "http-equiv": "httpEquiv",
  crossorigin: "crossOrigin",
  charset: "charSet",
  class: "className",
  fetchpriority: "fetchPriority",
};

const BOOLEAN_ATTRS = new Set(["async", "defer", "nomodule"]);

function parseAttributes(source: string): Record<string, string | boolean> {
  const attrs: Record<string, string | boolean> = {};
  const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const rawName = match[1];
    if (!rawName || rawName.startsWith("<")) continue;
    const name = ATTR_NAMES[rawName.toLowerCase()] ?? rawName;
    const value = match[2] ?? match[3] ?? match[4];
    if (value === undefined) {
      if (BOOLEAN_ATTRS.has(rawName.toLowerCase())) attrs[name] = true;
      continue;
    }
    attrs[name] = value;
  }
  return attrs;
}

export type ParsedHeadScript = {
  type?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  children?: string;
};

export type ParsedCustomHead = {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
  scripts: ParsedHeadScript[];
  styles: Array<{ children: string }>;
  jsonLd: unknown[];
};

/** Split saved head HTML into tags the router can render during SSR. Invalid JSON-LD is dropped. */
export function parseCustomHeadMarkup(html: string | null | undefined): ParsedCustomHead {
  const result: ParsedCustomHead = { meta: [], links: [], scripts: [], styles: [], jsonLd: [] };
  const source = stripPublicHotWaterClaim(html ?? "");
  if (!source.trim()) return result;
  const re = /<(meta|link|script|style)\b([^>]*)\/?>(?:([\s\S]*?)<\/\1>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttributes(match[2] ?? "");
    const body = match[3] ?? "";
    if (tag === "meta") {
      const meta: Record<string, string> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === "string") meta[key] = value;
      }
      if (meta.name || meta.property || meta.httpEquiv || meta.charSet) result.meta.push(meta);
      continue;
    }
    if (tag === "link") {
      const link: Record<string, string> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === "string") link[key] = value;
      }
      if (link.rel && link.href) result.links.push(link);
      continue;
    }
    if (tag === "style") {
      if (body.trim()) result.styles.push({ children: body });
      continue;
    }
    const type = typeof attrs.type === "string" ? attrs.type : undefined;
    const src = typeof attrs.src === "string" ? attrs.src : undefined;
    if (type === "application/ld+json") {
      const parsed = parseCustomJsonLd(stripPublicHotWaterJsonText(body));
      if (parsed) result.jsonLd.push(parsed);
      continue;
    }
    const script: ParsedHeadScript = {};
    if (type) script.type = type;
    if (src) script.src = src;
    if (attrs.async === true) script.async = true;
    if (attrs.defer === true) script.defer = true;
    if (!src && body.trim()) script.children = body.replace(/<\/script/gi, "<\\/script");
    if (script.src || script.children) result.scripts.push(script);
  }
  return result;
}

export type LandingHeadExtras = {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
  scripts: ParsedHeadScript[];
  styles: Array<{ children: string }>;
};

export function buildLandingHeadExtras(input: {
  approved: boolean;
  pageUrl: string;
  name: string;
  description?: string | null;
  sections: unknown;
  customHead?: string | null;
  customRobots?: string | null;
  noindex?: boolean | null;
  jsonLdEnabled?: boolean | null;
  customJsonLd?: string | null;
  property?: { whatsapp_number?: string | null; email?: string | null } | null;
}): LandingHeadExtras {
  const meta: Array<Record<string, string>> = [];
  const robots = landingRobotsContent(input.customRobots, input.noindex);
  const customHead = parseCustomHeadMarkup(input.customHead);
  // The router keeps the last meta for a given name. Robots goes last so
  // noindex is not overwritten by a tag inside custom head HTML.
  const customMeta = robots
    ? customHead.meta.filter((item) => item.name?.toLowerCase() !== "robots")
    : customHead.meta;
  meta.push(...customMeta);
  if (robots) meta.push({ name: "robots", content: robots });

  const indexedSections = publicLandingSections(input.sections);
  const faqs = input.approved ? [] : collectLandingFaqs(indexedSections);
  const documents: unknown[] = [];
  if (!input.approved) {
    documents.push(
      landingBuilderGraph({
        pageUrl: input.pageUrl,
        name: input.name,
        description: input.description,
        property: input.property,
      }),
    );
    if (faqs.length > 0) documents.push(faqPageGraph(input.pageUrl, faqs));
  }

  const skip = ["Organization", "WebSite"];
  if (input.approved) skip.push("LodgingBusiness", "BreadcrumbList", "FAQPage", "HotelRoom");
  else skip.push("LodgingBusiness", "WebPage", "BreadcrumbList");
  if (faqs.length > 0) skip.push("FAQPage");

  const customDocuments: unknown[] = [];
  if (input.jsonLdEnabled !== false) {
    const parsed = parseCustomJsonLd(stripPublicHotWaterJsonText(input.customJsonLd));
    if (parsed) customDocuments.push(parsed);
  }
  customDocuments.push(...customHead.jsonLd);

  const seen = new Set(documents.map((doc) => JSON.stringify(doc)));
  for (const doc of customDocuments) {
    const pruned = omitDuplicateJsonLd(doc, skip);
    if (!pruned) continue;
    const key = JSON.stringify(pruned);
    if (seen.has(key)) continue;
    seen.add(key);
    documents.push(pruned);
  }

  const scripts: ParsedHeadScript[] = [
    ...documents.map((doc) => ({
      type: "application/ld+json",
      children: jsonLdScriptText(doc),
    })),
    ...customHead.scripts,
  ];

  return { meta, links: customHead.links, scripts, styles: customHead.styles };
}
