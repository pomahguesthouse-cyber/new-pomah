/**
 * Tool: audit_page_seo
 *
 * Fetch a Pomah page (path or full URL), extract on-page SEO elements
 * (title, meta description, canonical, robots, H1 list, og tags, word
 * count), and flag obvious issues for the manager.
 *
 * Scope guard: only fetches URLs on the configured public_domain to
 * avoid the LLM being tricked into SSRF.
 */

import type { ToolContext, ToolHandler } from "@/tools/types";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 800_000; // ~800 KB cap

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function buildUrl(input: string, domain: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const path = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  return `https://${domain}${path}`;
}

interface ExtractedMeta {
  title:           string | null;
  metaDescription: string | null;
  canonical:       string | null;
  robots:          string | null;
  ogTitle:         string | null;
  ogDescription:   string | null;
  ogImage:         string | null;
  h1s:             string[];
  h2Count:         number;
  wordCount:       number;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const m = tag.match(re);
  return m ? m[1].trim() : null;
}

function extractMeta(html: string): ExtractedMeta {
  // Title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null;

  // Meta tags — iterate <meta ...> tags once.
  let metaDescription: string | null = null;
  let robots: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;

  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const name = (attr(tag, "name") || "").toLowerCase();
    const property = (attr(tag, "property") || "").toLowerCase();
    const content = attr(tag, "content");
    if (!content) continue;
    if (name === "description") metaDescription = content;
    else if (name === "robots") robots = content;
    else if (property === "og:title") ogTitle = content;
    else if (property === "og:description") ogDescription = content;
    else if (property === "og:image") ogImage = content;
  }

  // Canonical
  const canonicalMatch = html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
  const canonical = canonicalMatch ? attr(canonicalMatch[0], "href") : null;

  // Headings
  const h1s: string[] = [];
  const h1Re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  while ((m = h1Re.exec(html)) !== null) {
    h1s.push(m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  }
  const h2Matches = html.match(/<h2\b/gi);
  const h2Count = h2Matches ? h2Matches.length : 0;

  // Word count (rough): strip script/style/tags.
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = textOnly ? textOnly.split(/\s+/).length : 0;

  return {
    title,
    metaDescription,
    canonical,
    robots,
    ogTitle,
    ogDescription,
    ogImage,
    h1s,
    h2Count,
    wordCount,
  };
}

function buildIssues(meta: ExtractedMeta): string[] {
  const issues: string[] = [];

  if (!meta.title) issues.push("Title tag tidak ditemukan.");
  else if (meta.title.length < 25)
    issues.push(`Title terlalu pendek (${meta.title.length} chars; ideal 50-60).`);
  else if (meta.title.length > 65)
    issues.push(`Title terlalu panjang (${meta.title.length} chars; ideal 50-60, akan terpotong di SERP).`);

  if (!meta.metaDescription) issues.push("Meta description hilang — Google akan menggenerate sendiri.");
  else if (meta.metaDescription.length < 80)
    issues.push(`Meta description pendek (${meta.metaDescription.length} chars; ideal 140-160).`);
  else if (meta.metaDescription.length > 170)
    issues.push(`Meta description panjang (${meta.metaDescription.length} chars; akan terpotong).`);

  if (meta.h1s.length === 0) issues.push("Tidak ada <h1> di halaman — penting untuk topik utama.");
  else if (meta.h1s.length > 1) issues.push(`Ada ${meta.h1s.length} <h1> (idealnya 1).`);

  if (!meta.canonical) issues.push("Canonical link tidak ada — risiko duplicate content.");

  if (meta.robots && /noindex/i.test(meta.robots))
    issues.push(`Robots meta = "${meta.robots}" — halaman TIDAK akan di-index.`);

  if (!meta.ogTitle || !meta.ogDescription || !meta.ogImage)
    issues.push("Open Graph tags belum lengkap (og:title/og:description/og:image) — preview share medsos jelek.");

  if (meta.wordCount < 300)
    issues.push(`Konten tipis (${meta.wordCount} kata) — Google preferensi konten >300 kata.`);

  return issues;
}

export const auditPageSeo: ToolHandler = async (
  args: Record<string, unknown>,
  ctx:  ToolContext,
): Promise<string> => {
  if (ctx.isManager !== true) {
    return JSON.stringify({
      ok: false,
      error: "Hanya manajer/super admin yang boleh menjalankan audit SEO halaman.",
    });
  }

  const input = str(args.path) || str(args.url);
  if (!input) {
    return JSON.stringify({
      ok: false,
      error: "Parameter `path` (mis. '/rooms') atau `url` wajib diisi.",
    });
  }

  // Resolve target domain.
  const { data: prop } = await (ctx.supabaseAdmin as any)
    .from("properties")
    .select("public_domain")
    .limit(1)
    .maybeSingle();
  const domain =
    ((prop?.public_domain as string | null) || "pomahguesthouse.com")
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");

  const url = buildUrl(input, domain);
  if (!url) {
    return JSON.stringify({ ok: false, error: "URL tidak valid." });
  }

  // SSRF guard: must be same registrable domain as the configured property.
  const host = normalizeHost(url);
  const targetHost = normalizeHost(`https://${domain}`);
  if (!host || (host !== targetHost && !host.endsWith("." + targetHost))) {
    return JSON.stringify({
      ok: false,
      error: `URL harus berada di domain properti (${targetHost}). Got: ${host || "(invalid)"}`,
    });
  }

  // Fetch page.
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html = "";
  let status = 0;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "PomahSEOBot/1.0 (+content-manager-agent)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    status = res.status;
    if (!res.ok) {
      return JSON.stringify({
        ok: false,
        error: `Halaman tidak bisa diambil (HTTP ${res.status}).`,
        url,
      });
    }
    const reader = res.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        total += value.byteLength;
        if (total >= MAX_BODY_BYTES) break;
      }
      html = new TextDecoder("utf-8").decode(concat(chunks));
    } else {
      html = await res.text();
    }
  } catch (e: any) {
    return JSON.stringify({
      ok: false,
      error: `Gagal fetch halaman: ${e?.message ?? String(e)}`,
      url,
    });
  } finally {
    clearTimeout(to);
  }

  const meta = extractMeta(html);
  const issues = buildIssues(meta);

  // Audit-log this run.
  await (ctx.supabaseAdmin as any).from("seo_agent_logs").insert({
    agent_key: "content",
    task_description: `Audit SEO halaman ${url}`,
    status: "completed",
    details: `${issues.length} issue ditemukan.`,
  });

  return JSON.stringify({
    ok: true,
    url,
    http_status: status,
    meta: {
      title:            meta.title,
      title_length:     meta.title?.length ?? 0,
      meta_description: meta.metaDescription,
      meta_description_length: meta.metaDescription?.length ?? 0,
      canonical:        meta.canonical,
      robots:           meta.robots,
      og_title:         meta.ogTitle,
      og_description:   meta.ogDescription,
      og_image:         meta.ogImage,
      h1s:              meta.h1s,
      h2_count:         meta.h2Count,
      word_count:       meta.wordCount,
    },
    issues,
    issue_count: issues.length,
  });
};

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
