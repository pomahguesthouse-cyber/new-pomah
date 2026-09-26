/**
 * Host canonicalization, legacy URL mapping, and canonical URL generation.
 * Pure functions only — no network, no secrets.
 */
import assert from "node:assert/strict";

import { canonicalUrlForPath } from "../src/public/lib/public-seo";
import {
  buildSeoRedirect,
  placeSlugMatches,
  resolveDeluxeRoomPath,
  resolveExploreLegacyTarget,
} from "../src/public/lib/seo-redirects";

const places = [
  { name: "SAM POO KONG" },
  { name: "Obyek Wisata Goa Kreo" },
  { name: "Lawang Sewu Semarang" },
];

const rooms = [
  { name: "Grand Deluxe", slug: "grand-deluxe", is_published: true },
  { name: "Deluxe", slug: "deluxe", is_published: true },
  { name: "Single", slug: "kamar-single", is_published: true },
];

assert.equal(resolveDeluxeRoomPath(rooms), "/rooms/deluxe");
assert.equal(resolveDeluxeRoomPath([]), "/rooms/deluxe");
assert.equal(
  resolveDeluxeRoomPath([{ name: "Grand Deluxe", slug: "grand-deluxe", is_published: true }]),
  "/rooms/deluxe",
);

assert.equal(placeSlugMatches("sam-poo-kong", "SAM POO KONG"), true);
assert.equal(placeSlugMatches("goa-kreo", "Obyek Wisata Goa Kreo"), true);
assert.equal(placeSlugMatches("wingko-babat", "SAM POO KONG"), false);
assert.equal(placeSlugMatches("bandeng-presto", "Obyek Wisata Goa Kreo"), false);

assert.equal(resolveExploreLegacyTarget("sam-poo-kong", places), "/explore/sam-poo-kong");
assert.equal(resolveExploreLegacyTarget("goa-kreo", places), "/explore/obyek-wisata-goa-kreo");
assert.equal(resolveExploreLegacyTarget("wingko-babat", places), "/explore");
assert.equal(resolveExploreLegacyTarget("bandeng-presto", places), "/explore");
assert.equal(
  resolveExploreLegacyTarget("wingko-babat", [{ name: "Wingko Babat", slug: "wingko-babat" }]),
  "/explore/wingko-babat",
);

function location(
  requestUrl: string,
  extra: Parameters<typeof buildSeoRedirect>[0] = { requestUrl },
) {
  return buildSeoRedirect({
    deluxeRoomPath: "/rooms/deluxe",
    explorePlaces: places,
    ...extra,
    requestUrl,
  });
}

assert.equal(
  location("https://www.pomahguesthouse.com/rooms/deluxe?x=1")?.location,
  "https://pomahguesthouse.com/rooms/deluxe?x=1",
);
assert.equal(
  location("http://www.pomahguesthouse.com/explore")?.location,
  "https://pomahguesthouse.com/explore",
);
assert.equal(
  location("http://pomahguesthouse.com/book?room=deluxe")?.location,
  "https://pomahguesthouse.com/book?room=deluxe",
);
assert.equal(location("https://pomahguesthouse.com/explore"), null);
assert.equal(location("https://pomahguesthouse.com/"), null);

assert.equal(location("https://www.pomahguesthouse.com/api/public/whatsapp/webhook"), null);
assert.equal(location("http://pomahguesthouse.com/api/evolution"), null);
assert.equal(location("https://www.pomahguesthouse.com/api/cron/process-wa-queue"), null);

assert.equal(location("http://localhost:5173/explore"), null);
assert.equal(location("https://id-preview--abc.lovable.app/book"), null);
assert.equal(
  location("https://id-preview--abc.lovable.app/rooms/deluxe-ocean-view")?.location,
  "/rooms/deluxe",
);

assert.equal(
  location("https://pomahguesthouse.com/explore-semarang")?.location,
  "https://pomahguesthouse.com/explore",
);
assert.equal(
  location("https://pomahguesthouse.com/explore-semarang/")?.location,
  "https://pomahguesthouse.com/explore",
);
assert.equal(
  location("https://www.pomahguesthouse.com/explore-semarang/sam-poo-kong?utm=1")?.location,
  "https://pomahguesthouse.com/explore/sam-poo-kong?utm=1",
);
assert.equal(
  location("https://pomahguesthouse.com/explore-semarang/goa-kreo")?.location,
  "https://pomahguesthouse.com/explore/obyek-wisata-goa-kreo",
);
assert.equal(
  location("https://pomahguesthouse.com/explore-semarang/wingko-babat")?.location,
  "https://pomahguesthouse.com/explore",
);
assert.equal(
  location("https://pomahguesthouse.com/explore-semarang/bandeng-presto")?.location,
  "https://pomahguesthouse.com/explore",
);
assert.equal(
  location("https://pomahguesthouse.com/explore-semarang/bandeng-presto", {
    requestUrl: "https://pomahguesthouse.com/explore-semarang/bandeng-presto",
    explorePlaces: [{ name: "Bandeng Presto", slug: "bandeng-presto" }],
  })?.location,
  "https://pomahguesthouse.com/explore/bandeng-presto",
);

assert.equal(
  location("https://pomahguesthouse.com/rooms/deluxe-ocean-view")?.location,
  "https://pomahguesthouse.com/rooms/deluxe",
);
assert.equal(
  location("https://www.pomahguesthouse.com/rooms/deluxe-ocean-view?checkIn=2026-10-01")?.location,
  "https://pomahguesthouse.com/rooms/deluxe?checkIn=2026-10-01",
);
assert.match(
  location("https://pomahguesthouse.com/rooms/deluxe-ocean-view")?.reason ?? "",
  /legacy-url/,
);
assert.match(location("https://www.pomahguesthouse.com/")?.reason ?? "", /host-canonical/);

assert.equal(canonicalUrlForPath("/rooms/deluxe"), "https://pomahguesthouse.com/rooms/deluxe");
assert.equal(canonicalUrlForPath("/"), "https://pomahguesthouse.com/");
assert.doesNotMatch(canonicalUrlForPath("/explore"), /www/);

console.log("test-seo-redirects: ok");
