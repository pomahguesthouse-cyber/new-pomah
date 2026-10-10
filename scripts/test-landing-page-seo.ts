/**
 * Builder landing-page SEO: one H1, robots/noindex, slug redirects, FAQ schema.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  allLandingSections,
  blockHeadingTag,
  buildLandingHeadExtras,
  collectLandingFaqs,
  filterIndexableLandingRows,
  demoteContentH1,
  firstHeroImageUrl,
  jsonLdScriptText,
  landingDocumentOutline,
  landingNeedsGoogleReviews,
  landingRobotsContent,
  omitDuplicateJsonLd,
  parseCustomHeadMarkup,
  parseCustomJsonLd,
  publicLandingSections,
} from "../src/public/lib/landing-page-seo";
import {
  isMissingSchemaError,
  planSlugRedirectUpdates,
  resolveLandingSlugRedirect,
} from "../src/public/lib/lp-slug-redirects";
import { buildSeoRedirect } from "../src/public/lib/seo-redirects";
import { canonicalUrlForPath } from "../src/public/lib/public-seo";

const hero = (id: string, headline: string, image = "") => ({
  id,
  type: "hero" as const,
  headline,
  image_url: image,
});
const slider = (id: string, heading: string, image = "") => ({
  id,
  type: "slider" as const,
  slides: [{ heading, imageUrl: image, subheading: "" }],
});

const twoHeroes = [hero("a", "Pertama", "https://cdn.example/a.jpg"), hero("b", "Kedua")];
const outline = landingDocumentOutline(twoHeroes, { hero_headline: "Panel", meta_title: "Meta", title: "Judul" });
assert.equal(outline.h1SectionId, "a");
assert.equal(outline.eagerSectionId, "a");
assert.equal(outline.fallbackH1, null);
assert.equal(blockHeadingTag("a", outline.h1SectionId), "h1");
assert.equal(blockHeadingTag("b", outline.h1SectionId), "h2");
assert.equal(blockHeadingTag("a", outline.h1SectionId, true), "h2");
assert.equal(demoteContentH1("<h1 class=\"x\">Judul</h1><p>teks</p>"), "<h2 class=\"x\">Judul</h2><p>teks</p>");
assert.equal(demoteContentH1("<H1>A</H1></h1>"), "<h2>A</h2></h2>");

const sliderFirst = landingDocumentOutline(
  [slider("s", "Slider"), hero("h", "Hero")],
  { hero_headline: "Panel" },
);
assert.equal(sliderFirst.h1SectionId, "s");
assert.equal(blockHeadingTag("h", sliderFirst.h1SectionId), "h2");

const emptyThenHero = landingDocumentOutline(
  [hero("empty", "  "), hero("real", "Nyata")],
  { hero_headline: "Panel" },
);
assert.equal(emptyThenHero.h1SectionId, "real");

const noHero = landingDocumentOutline(
  [{ id: "t", type: "text", headline: "Bukan hero" }],
  { hero_headline: "Dari panel", meta_title: "Meta", title: "Judul" },
);
assert.equal(noHero.h1SectionId, null);
assert.equal(noHero.fallbackH1, "Dari panel");
assert.equal(
  landingDocumentOutline([{ id: "t", type: "text" }], { hero_headline: "  ", meta_title: "Meta saja", title: "Judul" }).fallbackH1,
  "Meta saja",
);
assert.equal(
  landingDocumentOutline([{ id: "t", type: "text" }], { hero_headline: "", meta_title: "", title: "Judul halaman" }).fallbackH1,
  "Judul halaman",
);

const split = {
  split: true,
  desktop: [hero("d", "Desktop")],
  mobile: [hero("d", "Mobile"), hero("m", "Lain")],
};
assert.equal(publicLandingSections(split).length, 1);
assert.equal(publicLandingSections(split)[0]?.headline, "Desktop");
assert.equal(publicLandingSections({ split: true, desktop: [], mobile: [hero("m", "Mobile")] }).length, 1);
assert.equal(allLandingSections(split).length, 3);
assert.equal(publicLandingSections([hero("only", "Satu")]).length, 1);

assert.equal(
  firstHeroImageUrl([hero("a", "A", "https://cdn.example/hero.jpg"), slider("s", "S", "https://cdn.example/slide.jpg")]),
  "https://cdn.example/hero.jpg",
);
assert.equal(
  firstHeroImageUrl([hero("a", "A", "  "), slider("s", "S", "https://cdn.example/slide.jpg")]),
  "https://cdn.example/slide.jpg",
);
assert.equal(firstHeroImageUrl([hero("a", "A")]), null);

const faqs = collectLandingFaqs([
  { id: "f", type: "faq", items: [{ question: " Di mana? ", answer: "<p>Sampangan</p>" }, { question: "", answer: "x" }] },
]);
assert.deepEqual(faqs, [{ question: "Di mana?", answer: "Sampangan" }]);
assert.equal(
  landingNeedsGoogleReviews([{ type: "testimonials", source: "google" }, { type: "testimonials", source: "manual" }]),
  true,
);
assert.equal(landingNeedsGoogleReviews([{ type: "testimonials", source: "manual" }]), false);

assert.equal(landingRobotsContent("index, follow", false), "index, follow");
assert.equal(landingRobotsContent("  ", false), null);
assert.equal(landingRobotsContent(null, true), "noindex, follow");
assert.equal(landingRobotsContent("index, nofollow", true), "noindex, nofollow");
assert.equal(landingRobotsContent("noindex, nofollow", false), "noindex, nofollow");

assert.deepEqual(
  filterIndexableLandingRows([
    { slug: "a", noindex: false },
    { slug: "b", noindex: true },
    { slug: "c" },
  ]).map((row) => row.slug),
  ["a", "c"],
);

assert.equal(parseCustomJsonLd("not json"), null);
assert.equal(parseCustomJsonLd("\"string\""), null);
assert.equal(parseCustomJsonLd(""), null);
assert.deepEqual(parseCustomJsonLd("{\"@type\":\"Hotel\"}"), { "@type": "Hotel" });
assert.equal(
  omitDuplicateJsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Pomah" }, ["Organization", "WebSite"]),
  null,
);
const mixed = omitDuplicateJsonLd(
  {
    "@context": "https://schema.org",
    "@graph": [{ "@type": "WebSite", name: "Pomah" }, { "@type": "Hotel", name: "Pomah" }],
  },
  ["Organization", "WebSite"],
) as { "@graph": Array<{ "@type": string }> };
assert.deepEqual(mixed["@graph"].map((node) => node["@type"]), ["Hotel"]);

const pageUrl = canonicalUrlForPath("/lp/contoh");
const head = buildLandingHeadExtras({
  approved: false,
  pageUrl,
  name: "Contoh",
  description: "Deskripsi",
  sections: [
    hero("h", "Judul hero"),
    {
      id: "f",
      type: "faq",
      items: [{ question: "Ada parkir?", answer: "Ya, tersedia parkir." }],
    },
  ],
  customRobots: "index, follow",
  noindex: false,
  jsonLdEnabled: true,
  customJsonLd: "{\"@context\":\"https://schema.org\",\"@type\":\"Organization\",\"name\":\"Pomah\"}",
  customHead:
    "<meta name=\"google-site-verification\" content=\"abc\">" +
    "<script type=\"application/ld+json\">{bad</script>" +
    "<script type=\"application/ld+json\">{\"@type\":\"Hotel\",\"name\":\"Pomah\"}</script>" +
    "<style>.x{color:red}</style>",
  property: { whatsapp_number: "6285190986169" },
});
assert.equal(head.meta.find((item) => item.name === "google-site-verification")?.content, "abc");
assert.equal(head.meta.at(-1)?.content, "index, follow");
assert.equal(head.styles[0]?.children, ".x{color:red}");
const documents = head.scripts
  .filter((script) => script.type === "application/ld+json")
  .map((script) => JSON.parse(script.children ?? ""));
const blob = JSON.stringify(documents);
assert.match(blob, /FAQPage/);
assert.match(blob, /Ada parkir\?/);
assert.match(blob, /LodgingBusiness/);
assert.match(blob, /WebPage/);
assert.match(blob, /BreadcrumbList/);
assert.doesNotMatch(blob, /"@type":"Organization"/);
assert.match(blob, /"@type":"Hotel"/);
assert.doesNotMatch(blob, /\{bad/);
assert.equal(jsonLdScriptText({ a: "<script>" }).includes("<"), false);

const noindexHead = buildLandingHeadExtras({
  approved: false,
  pageUrl,
  name: "Contoh",
  sections: [],
  customRobots: "index, nofollow",
  noindex: true,
  jsonLdEnabled: false,
  customJsonLd: "{\"@type\":\"Hotel\",\"name\":\"Rahasia\"}",
  customHead: "<meta name=\"robots\" content=\"index, follow\">",
});
assert.equal(noindexHead.meta.filter((item) => item.name === "robots").length, 1);
assert.equal(noindexHead.meta.at(-1)?.content, "noindex, nofollow");
assert.equal(
  noindexHead.scripts.some((script) => (script.children ?? "").includes("Rahasia")),
  false,
);
assert.match(JSON.stringify(noindexHead.scripts), /WebPage/);

const approvedHead = buildLandingHeadExtras({
  approved: true,
  pageUrl: canonicalUrlForPath("/lp/penginapan-dekat-unnes"),
  name: "Penginapan",
  sections: [{ id: "f", type: "faq", items: [{ question: "Duplikat?", answer: "Tidak" }] }],
  jsonLdEnabled: true,
  customJsonLd: "{\"@context\":\"https://schema.org\",\"@type\":\"FAQPage\",\"mainEntity\":[]}",
});
const approvedBlob = JSON.stringify(approvedHead.scripts);
assert.doesNotMatch(approvedBlob, /FAQPage/);
assert.doesNotMatch(approvedBlob, /LodgingBusiness/);

const parsedHead = parseCustomHeadMarkup("<script src=\"https://example.com/a.js\" async></script>");
assert.equal(parsedHead.scripts[0]?.src, "https://example.com/a.js");
assert.equal(parsedHead.scripts[0]?.async, true);

assert.equal(resolveLandingSlugRedirect("lama", [{ from_slug: "lama", to_slug: "baru" }]), "baru");
assert.equal(
  resolveLandingSlugRedirect("a", [
    { from_slug: "a", to_slug: "b" },
    { from_slug: "b", to_slug: "c" },
  ]),
  "c",
);
assert.equal(
  resolveLandingSlugRedirect("a", [
    { from_slug: "a", to_slug: "b" },
    { from_slug: "b", to_slug: "a" },
  ]),
  null,
);
assert.equal(resolveLandingSlugRedirect("hidup", [{ from_slug: "lama", to_slug: "baru" }]), null);

const renamed = planSlugRedirectUpdates([{ from_slug: "a", to_slug: "b" }], "b", "c");
assert.deepEqual(
  renamed.upserts.sort((x, y) => x.from_slug.localeCompare(y.from_slug)),
  [
    { from_slug: "a", to_slug: "c" },
    { from_slug: "b", to_slug: "c" },
  ],
);
const unloop = planSlugRedirectUpdates([{ from_slug: "b", to_slug: "a" }], "a", "b");
assert.deepEqual(unloop.deletes, ["b"]);
assert.deepEqual(unloop.upserts, [{ from_slug: "a", to_slug: "b" }]);
assert.equal(
  resolveLandingSlugRedirect("a", unloop.upserts.filter((row) => !unloop.deletes.includes(row.from_slug))),
  "b",
);
assert.deepEqual(planSlugRedirectUpdates([], "sama", "sama"), { upserts: [], deletes: [] });

assert.equal(isMissingSchemaError({ code: "PGRST204", message: "schema cache" }), true);
assert.equal(isMissingSchemaError({ code: "PGRST205", message: "Could not find the table" }), true);
assert.equal(isMissingSchemaError({ code: "23505", message: "duplicate key" }), false);
assert.equal(isMissingSchemaError(null), false);

const redirects = [{ from_slug: "lama", to_slug: "baru" }];
assert.equal(
  buildSeoRedirect({ requestUrl: "https://pomahguesthouse.com/lp/lama?utm=1", landingRedirects: redirects })?.location,
  "https://pomahguesthouse.com/lp/baru?utm=1",
);
assert.match(
  buildSeoRedirect({ requestUrl: "https://www.pomahguesthouse.com/lp/lama", landingRedirects: redirects })?.reason ?? "",
  /lp-slug/,
);
assert.equal(
  buildSeoRedirect({ requestUrl: "https://www.pomahguesthouse.com/lp/lama", landingRedirects: redirects })?.location,
  "https://pomahguesthouse.com/lp/baru",
);
assert.equal(
  buildSeoRedirect({ requestUrl: "http://localhost:5173/lp/lama", landingRedirects: redirects })?.location,
  "/lp/baru",
);
assert.equal(buildSeoRedirect({ requestUrl: "https://pomahguesthouse.com/lp/baru", landingRedirects: redirects }), null);
assert.equal(
  buildSeoRedirect({ requestUrl: "https://pomahguesthouse.com/guesthouse-dekat-unnes" })?.location,
  "https://pomahguesthouse.com/lp/penginapan-dekat-unnes",
);
assert.equal(
  buildSeoRedirect({ requestUrl: "https://www.pomahguesthouse.com/guesthouse-dekat-unnes/" })?.location,
  "https://pomahguesthouse.com/lp/penginapan-dekat-unnes",
);
assert.equal(
  buildSeoRedirect({ requestUrl: "http://localhost:5173/guesthouse-dekat-unnes" })?.location,
  "/lp/penginapan-dekat-unnes",
);

const route = readFileSync(new URL("../src/routes/lp.$slug.tsx", import.meta.url), "utf8");
assert.match(route, /buildLandingHeadExtras/);
assert.match(route, /publicLandingSections/);
assert.match(route, /useBlockHeading\(s\.id\)/);
assert.match(route, /fetchPriority=\{eager \? "high" : "low"\}/);
assert.match(route, /loading=\{eager \? "eager" : "lazy"\}/);
assert.match(route, /initialData: seeded/);
assert.match(route, /useContext\(LpRenderCtx\)\.rooms/);
assert.doesNotMatch(route, /mountCustomHead/);
assert.doesNotMatch(route, /queryKey: \["lp-site-data"\]/);
const sitemap = readFileSync(new URL("../src/routes/sitemap[.]xml.ts", import.meta.url), "utf8");
assert.match(sitemap, /filterIndexableLandingRows/);
assert.match(sitemap, /isMissingSchemaError/);

console.log("test-landing-page-seo: ok");
