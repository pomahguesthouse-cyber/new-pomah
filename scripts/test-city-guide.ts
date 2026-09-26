/**
 * City Guide catalog, sitemap locs, and legacy slug resolution.
 */
import assert from "node:assert/strict";

import {
  cityGuideLastmod,
  cityGuideSitemapUrls,
  collectCityGuidePlaces,
  findCityGuidePlace,
  renderSitemapXml,
} from "../src/public/lib/city-guide";
import { canonicalUrlForPath } from "../src/public/lib/public-seo";
import { resolveExploreLegacyTarget } from "../src/public/lib/seo-redirects";

const places = collectCityGuidePlaces({
  propertyUpdatedAt: "2026-08-01T00:00:00.000Z",
  propertyCreatedAt: "2026-01-01T00:00:00.000Z",
  todayWib: "2026-09-26",
  destinations: [
    { name: "SAM POO KONG", desc: "Kelenteng Cheng Ho" },
    { name: "Obyek Wisata Goa Kreo", desc: "Goa di Semarang" },
  ],
  culinary: [{ name: "Wingko Babat", desc: "Oleh-oleh" }],
  events: [
    { title: "Festival Lama", date: "10 Mei 2020", desc: "sudah lewat" },
    { title: "Pasar Tiap Hari", date: "Tiap Hari", desc: "rutin" },
  ],
  news: [{ title: "Berita Lama", date: "1 Januari 2020", desc: "tetap tampil" }],
  items: [
    {
      title: "Bandeng Presto",
      category: "kuliner",
      is_published: true,
      description: "Ikan bandeng",
      updated_at: "2026-07-02T03:04:05.000Z",
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      title: "Draft Kuliner",
      category: "kuliner",
      is_published: false,
      updated_at: "2026-07-02T03:04:05.000Z",
    },
    {
      title: "Gedongsongo Festival",
      category: "event",
      is_published: true,
      date_text: "22 Oktober 2020",
      updated_at: "2026-08-12T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      title: "SAM POO KONG",
      category: "destinasi",
      is_published: true,
      description: "",
      updated_at: "2026-09-01T12:00:00.000Z",
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ],
});

const slugs = places.map((place) => place.slug).sort();
assert.deepEqual(slugs, [
  "bandeng-presto",
  "berita-lama",
  "obyek-wisata-goa-kreo",
  "pasar-tiap-hari",
  "sam-poo-kong",
  "wingko-babat",
]);
assert.equal(
  places.find((place) => place.slug === "festival-lama"),
  undefined,
);
assert.equal(
  places.find((place) => place.slug === "gedongsongo-festival"),
  undefined,
);
assert.equal(
  places.find((place) => place.slug === "draft-kuliner"),
  undefined,
);

const sam = findCityGuidePlace(places, "sam-poo-kong");
assert.ok(sam);
assert.equal(cityGuideLastmod(sam), "2026-09-01T12:00:00.000Z");
assert.equal(findCityGuidePlace(places, "goa-kreo")?.slug, "obyek-wisata-goa-kreo");
assert.equal(findCityGuidePlace(places, "wingko-babat")?.slug, "wingko-babat");
assert.equal(findCityGuidePlace(places, "tidak-ada"), null);

const bandeng = places.find((place) => place.slug === "bandeng-presto");
assert.equal(cityGuideLastmod(bandeng!), "2026-07-02T03:04:05.000Z");
const goa = places.find((place) => place.slug === "obyek-wisata-goa-kreo");
assert.equal(cityGuideLastmod(goa!), "2026-08-01T00:00:00.000Z");

assert.equal(
  resolveExploreLegacyTarget(
    "goa-kreo",
    places.map((place) => ({ name: place.name, slug: place.slug })),
  ),
  "/explore/obyek-wisata-goa-kreo",
);
assert.equal(
  resolveExploreLegacyTarget(
    "bandeng-presto",
    places.map((place) => ({ name: place.name, slug: place.slug })),
  ),
  "/explore/bandeng-presto",
);
assert.equal(resolveExploreLegacyTarget("tidak-ada", places), "/explore");

const urls = cityGuideSitemapUrls(places);
assert.equal(urls.length, places.length);
for (const url of urls) {
  assert.match(url.loc, /^https:\/\/pomahguesthouse\.com\/explore\//);
  assert.doesNotMatch(url.loc, /www\.|explore-semarang|\?/);
  assert.ok(url.lastmod);
}
assert.equal(
  urls.find((url) => url.loc.endsWith("/bandeng-presto"))?.lastmod,
  "2026-07-02T03:04:05.000Z",
);

const xml = renderSitemapXml([
  { loc: canonicalUrlForPath("/explore"), lastmod: "2026-09-26T00:00:00.000Z" },
  ...urls,
  { loc: "https://www.pomahguesthouse.com/explore/nope", lastmod: "2026-01-01T00:00:00.000Z" },
  { loc: "http://pomahguesthouse.com/explore/nope", lastmod: "2026-01-01T00:00:00.000Z" },
]);
assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
assert.equal(xml.split("<loc>").length - 1, 1 + places.length);
assert.doesNotMatch(xml, /www\.pomahguesthouse/);
assert.doesNotMatch(xml, /http:\/\/pomahguesthouse/);
assert.match(xml, /<lastmod>2026-07-02T03:04:05.000Z<\/lastmod>/);
assert.match(xml, /<loc>https:\/\/pomahguesthouse.com\/explore\/sam-poo-kong<\/loc>/);

console.log("test-city-guide: ok");
