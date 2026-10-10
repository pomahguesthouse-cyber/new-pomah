/**
 * Publish checklist for builder landing pages. Pure: no database, no fetch.
 * Dynamic blocks (rooms, prices, reviews, distances, explore cards) are not
 * counted as unique copy.
 */
import { APPROVED_HOME, APPROVED_LP } from "@/public/content/approved-seo";
import {
  collectLandingFaqs,
  demoteContentH1,
  landingDocumentOutline,
  publicLandingSections,
  type LandingSectionLike,
} from "@/public/lib/landing-page-seo";

export const MIN_UNIQUE_WORDS = 500;
export const MAX_SIMILARITY = 0.6;
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 160;

/**
 * Keywords already used by the homepage and the hardcoded UNNES landing.
 * A new page may not take these phrases.
 */
export const RESERVED_PRIMARY_KEYWORDS = [
  "penginapan dekat unnes",
  "wisuda unnes",
  "homestay dekat unnes",
  "penginapan dekat unnes semarang",
  "guesthouse keluarga semarang",
  "penginapan murah semarang",
] as const;

const DYNAMIC_TYPES = new Set([
  "location",
  "filtered_rooms",
  "starting_price",
  "related_explore",
  "filtered_reviews",
  "testimonials",
  "room_slider",
  "datepicker",
  "gallery",
  "slider",
  "header",
]);

export type QualitySection = LandingSectionLike & {
  title?: string | null;
  content?: string | null;
  body_content?: string | null;
  subheadline?: string | null;
  cta_text?: string | null;
  cta_url?: string | null;
  url?: string | null;
  text?: string | null;
  headline_text?: string | null;
  links?: Array<{ url?: string | null }> | null;
  images?: string[] | null;
  landmark_ids?: string[] | null;
  room_type_ids?: string[] | null;
  slugs?: string[] | null;
  min_capacity?: number | null;
  keywords?: string[] | null;
};

export type QualityLandmark = {
  id: string;
  name: string;
  verified: boolean;
  road_distance_km?: number | null;
  travel_minutes?: number | null;
};

export type QualityRoom = {
  id: string;
  slug: string;
  name?: string | null;
  capacity?: number | null;
};

export type QualityPage = {
  id?: string | null;
  slug: string;
  title?: string | null;
  target_keyword?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  hero_headline?: string | null;
  body_content?: string | null;
  sections?: unknown;
};

export type QualityCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type QualityReport = {
  pass: boolean;
  checks: QualityCheck[];
  words: number;
  similarity: number;
};

export function normalizeKeyword(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " dan ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseConflict(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 8) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(longer);
}

export function keywordConflicts(candidate: string | null | undefined, taken: readonly string[]): string | null {
  const mine = normalizeKeyword(candidate);
  if (!mine) return null;
  for (const raw of taken) {
    const other = normalizeKeyword(raw);
    if (phraseConflict(mine, other)) return other;
  }
  return null;
}

export function reservedKeywordCorpus(): string[] {
  return [
    ...RESERVED_PRIMARY_KEYWORDS,
    APPROVED_LP.h1,
    APPROVED_LP.title,
    APPROVED_HOME.h1,
    APPROVED_HOME.title,
  ];
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const cleaned = stripTags(text);
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter((word) => word.length > 0).length;
}

function sectionCopy(section: QualitySection): string {
  if (DYNAMIC_TYPES.has(section.type ?? "")) return "";
  const parts: string[] = [];
  if (section.type === "hero") {
    parts.push(section.headline ?? "", section.subheadline ?? "");
  } else if (section.type === "text") {
    parts.push(section.title ?? "", demoteContentH1(section.content ?? ""));
  } else if (section.type === "features") {
    parts.push(section.title ?? "");
    for (const item of section.items ?? []) {
      parts.push(item.title ?? "", item.description ?? "");
    }
  } else if (section.type === "faq") {
    parts.push(section.title ?? "");
    for (const item of section.items ?? []) {
      parts.push(item.question ?? "", item.answer ?? "");
    }
  } else if (section.type === "cta_banner") {
    parts.push(section.headline ?? "", (section as { subheadline?: string }).subheadline ?? "", section.cta_text ?? "");
  } else if (section.type === "button") {
    parts.push(section.text ?? "");
  }
  return parts.filter(Boolean).join(" ");
}

export function uniqueCopyText(page: QualityPage): string {
  const sections = publicLandingSections<QualitySection>(page.sections);
  if (sections.length === 0) {
    return [page.hero_headline, page.title, page.body_content].filter(Boolean).join(" ");
  }
  return sections.map(sectionCopy).filter(Boolean).join(" ");
}

export function shingles(text: string, size = 3): Set<string> {
  const words = stripTags(text).toLowerCase().split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  if (words.length === 0) return out;
  if (words.length < size) {
    out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i <= words.length - size; i += 1) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function maxCopySimilarity(page: QualityPage, others: readonly QualityPage[]): number {
  const mine = shingles(uniqueCopyText(page));
  let max = 0;
  for (const other of others) {
    if (page.id && other.id && page.id === other.id) continue;
    if (page.slug && other.slug === page.slug) continue;
    const score = jaccard(mine, shingles(uniqueCopyText(other)));
    if (score > max) max = score;
  }
  return max;
}

export function indexedH1Count(page: QualityPage): number {
  const sections = publicLandingSections<QualitySection>(page.sections);
  const outline = landingDocumentOutline(sections, page);
  const hasHeading = Boolean(outline.h1SectionId || outline.fallbackH1);
  if (!hasHeading) {
    const raw = sections
      .filter((section) => section.type === "text")
      .reduce((n, section) => n + (section.content?.match(/<h1\b/gi)?.length ?? 0), 0);
    return raw;
  }
  return 1;
}

function collectHrefs(page: QualityPage, rooms: readonly QualityRoom[]): string[] {
  const hrefs: string[] = [];
  const push = (value: string | null | undefined) => {
    const href = (value ?? "").trim();
    if (href) hrefs.push(href);
  };
  const sections = publicLandingSections<QualitySection>(page.sections);
  for (const section of sections) {
    push(section.cta_url);
    push(section.url);
    for (const link of section.links ?? []) push(link.url);
    const html = `${section.content ?? ""} ${section.body_content ?? ""}`;
    const matches = html.match(/href\s*=\s*["']([^"']+)["']/gi) ?? [];
    for (const match of matches) {
      const found = /href\s*=\s*["']([^"']+)["']/i.exec(match);
      if (found?.[1]) hrefs.push(found[1]);
    }
    if (section.type === "related_explore") {
      for (const slug of section.slugs ?? []) {
        const clean = slug.trim().replace(/^\/explore\//, "").replace(/^\/+/, "");
        if (clean) hrefs.push(`/explore/${clean}`);
      }
    }
    if (section.type === "filtered_rooms" || section.type === "room_slider") {
      let pool = rooms.filter((room) => room.slug);
      const ids = section.room_type_ids ?? [];
      if (section.type === "filtered_rooms" && ids.length > 0) {
        const wanted = new Set(ids);
        pool = pool.filter((room) => wanted.has(room.id));
      }
      const min = section.min_capacity;
      if (section.type === "filtered_rooms" && typeof min === "number" && min > 0) {
        pool = pool.filter((room) => (room.capacity ?? 0) >= min);
      }
      for (const room of pool) hrefs.push(`/rooms/${room.slug}`);
    }
  }
  if (sections.length === 0) push(page.body_content);
  const bodyHrefs = (page.body_content ?? "").match(/href\s*=\s*["']([^"']+)["']/gi) ?? [];
  for (const match of bodyHrefs) {
    const found = /href\s*=\s*["']([^"']+)["']/i.exec(match);
    if (found?.[1]) hrefs.push(found[1]);
  }
  return hrefs;
}

function pathOnly(href: string): string {
  try {
    if (/^https?:\/\//i.test(href)) return new URL(href).pathname;
  } catch {
    /* keep raw */
  }
  return href.split("?")[0]?.split("#")[0] ?? href;
}

export function internalLinkCoverage(hrefs: readonly string[]): {
  room: boolean;
  book: boolean;
  explore: boolean;
} {
  let room = false;
  let book = false;
  let explore = false;
  for (const href of hrefs) {
    const path = pathOnly(href);
    if (/^\/rooms\/[a-z0-9-]+$/i.test(path)) room = true;
    if (path === "/book" || path.startsWith("/book/")) book = true;
    if (/^\/explore\/[a-z0-9-]+$/i.test(path)) explore = true;
  }
  return { room, book, explore };
}

function imagesMissingAlt(page: QualityPage): string[] {
  const problems: string[] = [];
  const sections = publicLandingSections<QualitySection>(page.sections);
  sections.forEach((section, index) => {
    if (section.type === "hero" && (section.image_url ?? "").trim() && !(section.headline ?? "").trim()) {
      problems.push(`hero ${index + 1} punya gambar tanpa teks alt`);
    }
    const html = section.content ?? "";
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    for (const tag of imgs) {
      const alt = /\balt\s*=\s*(['"])([\s\S]*?)\1/i.exec(tag);
      if (!alt || !alt[2].trim()) problems.push(`gambar di blok teks ${index + 1} tanpa alt`);
    }
  });
  return problems;
}

export function distanceProblems(
  page: QualityPage,
  landmarks: readonly QualityLandmark[],
): string[] {
  const byId = new Map(landmarks.map((row) => [row.id, row]));
  const problems: string[] = [];
  const sections = publicLandingSections<QualitySection>(page.sections);
  for (const section of sections) {
    if (section.type !== "location") continue;
    const ids = section.landmark_ids ?? [];
    if (ids.length === 0) {
      problems.push("blok lokasi tidak memilih landmark");
      continue;
    }
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        problems.push(`landmark ${id} tidak ada di tabel`);
        continue;
      }
      if (!row.verified) problems.push(`${row.name} belum diverifikasi`);
      else if (row.road_distance_km == null || row.travel_minutes == null) {
        problems.push(`${row.name} belum punya jarak atau waktu`);
      }
    }
  }
  const copy = uniqueCopyText(page).toLowerCase();
  for (const row of landmarks) {
    if (row.verified) continue;
    const name = row.name.toLowerCase();
    if (!name) continue;
    const at = copy.indexOf(name);
    if (at < 0) continue;
    const window = copy.slice(Math.max(0, at - 80), at + name.length + 80);
    if (/\d+(?:[.,]\d+)?\s*(km|menit)/i.test(window)) {
      problems.push(`teks menyebut jarak di dekat landmark belum terverifikasi (${row.name})`);
    }
  }
  return problems;
}

function metaProblems(page: QualityPage, others: readonly QualityPage[]): string[] {
  const problems: string[] = [];
  const title = (page.meta_title ?? "").trim();
  const description = (page.meta_description ?? "").trim();
  if (!title) problems.push("meta title kosong");
  if (!description) problems.push("meta description kosong");
  if (title.length > META_TITLE_MAX) problems.push(`meta title ${title.length} karakter (maks ${META_TITLE_MAX})`);
  if (description.length > META_DESCRIPTION_MAX) {
    problems.push(`meta description ${description.length} karakter (maks ${META_DESCRIPTION_MAX})`);
  }
  const reservedTitles = [APPROVED_HOME.title, APPROVED_LP.title, APPROVED_HOME.meta, APPROVED_LP.meta];
  const titleKey = normalizeKeyword(title);
  const descKey = normalizeKeyword(description);
  const takenTitles = [...reservedTitles, ...others.map((row) => row.meta_title ?? "")];
  const takenDesc = [...reservedTitles, ...others.map((row) => row.meta_description ?? "")];
  if (title && takenTitles.some((row) => normalizeKeyword(row) === titleKey && row.trim())) {
    const self = others.find((row) => row.id && row.id === page.id);
    if (!self) problems.push("meta title sama dengan halaman lain");
  }
  if (description && takenDesc.some((row) => normalizeKeyword(row) === descKey && row.trim())) {
    problems.push("meta description sama dengan halaman lain");
  }
  return [...new Set(problems)];
}

export function evaluateLandingQuality(input: {
  page: QualityPage;
  otherPages?: readonly QualityPage[];
  landmarks?: readonly QualityLandmark[];
  rooms?: readonly QualityRoom[];
}): QualityReport {
  const others = (input.otherPages ?? []).filter((row) => row.id !== input.page.id && row.slug !== input.page.slug);
  const sections = publicLandingSections<QualitySection>(input.page.sections);
  const words = countWords(uniqueCopyText(input.page));
  const similarity = maxCopySimilarity(input.page, others);
  const keywordHit = keywordConflicts(input.page.target_keyword, [
    ...reservedKeywordCorpus(),
    ...others.map((row) => row.target_keyword ?? ""),
  ]);
  const h1 = indexedH1Count(input.page);
  const links = internalLinkCoverage(collectHrefs(input.page, input.rooms ?? []));
  const linkMissing = [
    links.room ? null : "halaman kamar",
    links.book ? null : "/book",
    links.explore ? null : "artikel /explore",
  ].filter(Boolean);
  const imageProblems = imagesMissingAlt(input.page);
  const distance = distanceProblems(input.page, input.landmarks ?? []);
  const faqs = sections.length > 0 ? collectLandingFaqs(sections) : [];
  const meta = metaProblems(input.page, others);

  const checks: QualityCheck[] = [
    {
      id: "keyword",
      label: "Keyword utama unik",
      pass: Boolean(normalizeKeyword(input.page.target_keyword)) && !keywordHit,
      detail: !normalizeKeyword(input.page.target_keyword)
        ? "Isi keyword utama."
        : keywordHit
          ? `Bentrok dengan “${keywordHit}”.`
          : "Tidak bentrok dengan beranda, halaman UNNES, atau landing lain.",
    },
    {
      id: "words",
      label: `Salinan unik minimal ${MIN_UNIQUE_WORDS} kata`,
      pass: words >= MIN_UNIQUE_WORDS,
      detail: `${words} kata di luar blok dinamis.`,
    },
    {
      id: "similarity",
      label: "Kemiripan dengan landing lain di bawah 60%",
      pass: similarity < MAX_SIMILARITY,
      detail: `Kemiripan tertinggi ${Math.round(similarity * 100)}%.`,
    },
    {
      id: "h1",
      label: "Tepat satu H1",
      pass: h1 === 1,
      detail: h1 === 1 ? "Dokumen terindeks punya satu H1." : `Terhitung ${h1} H1.`,
    },
    {
      id: "meta",
      label: "Meta title dan description ada, unik, dan sesuai batas",
      pass: meta.length === 0,
      detail: meta.length === 0 ? "Meta siap." : meta.join(" "),
    },
    {
      id: "links",
      label: "Tautan internal: kamar, /book, dan /explore",
      pass: linkMissing.length === 0,
      detail: linkMissing.length === 0 ? "Tiga jenis tautan ada." : `Kurang: ${linkMissing.join(", ")}.`,
    },
    {
      id: "images",
      label: "Semua gambar punya alt",
      pass: imageProblems.length === 0,
      detail: imageProblems.length === 0 ? "Alt lengkap." : imageProblems.join(" "),
    },
    {
      id: "distances",
      label: "Jarak hanya dari landmark terverifikasi",
      pass: distance.length === 0,
      detail: distance.length === 0 ? "Tidak ada klaim jarak yang belum diverifikasi." : distance.join(" "),
    },
    {
      id: "faq",
      label: "FAQ minimal 4",
      pass: faqs.length >= 4,
      detail: `${faqs.length} pertanyaan.`,
    },
  ];

  return {
    pass: checks.every((check) => check.pass),
    checks,
    words,
    similarity,
  };
}
