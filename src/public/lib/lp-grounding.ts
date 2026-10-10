/**
 * Grounded landing-page prompt and draft assembly.
 * The model only sees facts passed in. Prices, facilities, and distances
 * that are not in those facts are stripped before the page is saved.
 */
import type { LPSection } from "@/admin/modules/seo/landing-page.functions";
// Type-only import. The draft is assembled here and saved by the server function.

export type GroundingRoom = {
  id: string;
  name: string;
  slug: string;
  capacity: number | null;
  baseRate: number | null;
  bedType?: string | null;
  amenities: string[];
};

export type GroundingLandmark = {
  id: string;
  name: string;
  category?: string | null;
  roadDistanceKm: number | null;
  travelMinutes: number | null;
  verified: boolean;
};

export type GroundingExplore = { slug: string; title: string };

export type GroundingBrief = {
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent: string;
  slug: string;
  targetAudience: string;
  uniqueAngle: string;
  faqSeeds: string[];
  reviewKeywords: string[];
  exploreSlugs: string[];
  landmarkIds: string[];
  roomTypeIds: string[];
  minCapacity: number | null;
};

export type GroundingFacts = {
  propertyName: string;
  address: string;
  lat: number;
  lng: number;
  whatsappDigits: string;
  checkIn: string;
  checkOut: string;
  rooms: GroundingRoom[];
  landmarks: GroundingLandmark[];
  explore: GroundingExplore[];
  propertyFaqs: Array<{ question: string; answer: string }>;
  brief: GroundingBrief;
};

export type GroundingPrompt = { system: string; user: string };

const HOT_WATER_RE = /\b(?:air\s+panas|air\s+hangat|hot\s+water|water\s+heater|pemanas\s+air)\b/i;

function money(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

export function allowedRates(facts: GroundingFacts): number[] {
  return [...new Set(facts.rooms.map((room) => room.baseRate).filter((rate): rate is number => rate != null && rate > 0))];
}

export function allowedAmenities(facts: GroundingFacts): string[] {
  const set = new Set<string>();
  for (const room of facts.rooms) {
    for (const amenity of room.amenities) {
      const clean = amenity.trim();
      if (clean) set.add(clean);
    }
  }
  return [...set];
}

export function buildGroundingPrompt(facts: GroundingFacts): GroundingPrompt {
  const verified = facts.landmarks.filter(
    (row) => row.verified && row.roadDistanceKm != null && row.travelMinutes != null,
  );
  const unverified = facts.landmarks.filter((row) => !row.verified);
  const amenities = allowedAmenities(facts);
  const rates = allowedRates(facts);
  const payload = {
    brief: facts.brief,
    property: {
      name: facts.propertyName,
      address: facts.address,
      coordinates: { lat: facts.lat, lng: facts.lng },
      whatsapp: facts.whatsappDigits,
      checkIn: facts.checkIn,
      checkOut: facts.checkOut,
    },
    rooms: facts.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      slug: room.slug,
      capacity: room.capacity,
      priceFrom: room.baseRate,
      bedType: room.bedType ?? null,
      amenities: room.amenities,
    })),
    verifiedLandmarks: verified.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category ?? "",
      roadDistanceKm: row.roadDistanceKm,
      travelMinutes: row.travelMinutes,
    })),
    landmarkNamesWithoutDistance: unverified.map((row) => row.name),
    propertyFaqs: facts.propertyFaqs,
    explore: facts.explore,
    allowedAmenities: amenities,
    allowedPricesIdr: rates,
  };

  const system = [
    "Anda menulis draf landing page Pomah Guesthouse dalam Bahasa Indonesia.",
    "Balas JSON saja, tanpa markdown.",
    "Pakai HANYA fakta di pesan pengguna. Jangan mengarang fasilitas, harga, jarak, waktu tempuh, atau alamat.",
    "Dilarang menulis air panas, air hangat, hot water, atau pemanas air kecuali frasa itu ada di allowedAmenities.",
    "Jangan menulis angka kilometer atau menit untuk nama di landmarkNamesWithoutDistance.",
    "Jangan menulis harga yang tidak ada di allowedPricesIdr.",
    "H1 (hero.headline) wajib memuat primary keyword.",
    "Tulis 2 sampai 3 blok type=text. Gabungan teks unik (hero, text, faq, features) minimal 500 kata.",
    "Jangan pakai tag h1 di dalam HTML. Pakai p, h2, h3, ul, li, a.",
    "meta_title maksimal 60 karakter. meta_description maksimal 160 karakter. Keduanya unik dan memuat keyword secara alami.",
    "Slug halaman sudah ditentukan. Jangan menggantinya.",
    "FAQ minimal 4, dikembangkan dari faqSeeds dan propertyFaqs. Jawaban tidak menambah fasilitas baru.",
    "Sertakan tautan HTML ke satu /rooms/{slug}, ke /book, dan ke satu /explore/{slug} yang ada di data.",
  ].join(" ");

  const user = [
    "Buat objek JSON dengan bentuk:",
    JSON.stringify({
      meta_title: "string <= 60",
      meta_description: "string <= 160",
      sections: [
        { type: "hero", headline: "", subheadline: "", cta_text: "Pesan kamar", cta_url: "/book" },
        { type: "text", title: "", content: "<p>...</p>" },
        { type: "faq", title: "Pertanyaan umum", items: [{ question: "", answer: "" }] },
      ],
    }),
    "Fakta yang boleh dipakai:",
    JSON.stringify(payload),
  ].join("\n");

  return { system, user };
}

export function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI mengembalikan JSON yang bukan objek.");
  }
  return parsed as Record<string, unknown>;
}

function allowsHotWater(facts: GroundingFacts): boolean {
  return allowedAmenities(facts).some((item) => HOT_WATER_RE.test(item));
}

function sentenceAllowed(sentence: string, facts: GroundingFacts): boolean {
  if (!allowsHotWater(facts) && HOT_WATER_RE.test(sentence)) return false;
  const rates = new Set(allowedRates(facts));
  const prices = sentence.match(/rp\s*[\d.]+/gi) ?? [];
  for (const token of prices) {
    const digits = Number(token.replace(/[^\d]/g, ""));
    if (digits > 0 && !rates.has(digits)) return false;
  }
  const verifiedNames = facts.landmarks
    .filter((row) => row.verified)
    .map((row) => row.name.toLowerCase());
  if (/\d+(?:[.,]\d+)?\s*(km|menit)/i.test(sentence)) {
    const lower = sentence.toLowerCase();
    const mentionsUnverified = facts.landmarks.some(
      (row) => !row.verified && row.name && lower.includes(row.name.toLowerCase()),
    );
    const mentionsVerified = verifiedNames.some((name) => name && lower.includes(name));
    if (mentionsUnverified && !mentionsVerified) return false;
  }
  return true;
}

export function stripUngroundedText(html: string, facts: GroundingFacts): string {
  const chunks = html.split(/(?<=[.!?])\s+|(?=<\/p>)|(?<=<p[^>]*>)/i);
  const kept = chunks.filter((chunk) => sentenceAllowed(chunk, facts));
  return kept.join(" ").replace(/\s+/g, " ").replace(/\s+<\/p>/g, "</p>").trim();
}

function clamp(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

function nid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function assembleLandingDraft(
  facts: GroundingFacts,
  model: Record<string, unknown>,
): { metaTitle: string; metaDescription: string; sections: LPSection[] } {
  const keyword = facts.brief.primaryKeyword.trim();
  const rawSections = Array.isArray(model.sections) ? model.sections : [];
  const textBlocks: LPSection[] = [];
  const faqItems: Array<{ question: string; answer: string }> = [];

  for (const entry of rawSections) {
    const row = asRecord(entry);
    if (!row) continue;
    if (row.type === "text") {
      const content = stripUngroundedText(textOf(row.content).replace(/<(\/?)h1\b/gi, "<$1h2"), facts);
      if (content) {
        textBlocks.push({
          id: nid(),
          type: "text",
          title: textOf(row.title).slice(0, 160) || undefined,
          content,
          align: "left",
        });
      }
    }
    if (row.type === "faq" && Array.isArray(row.items)) {
      for (const item of row.items) {
        const faq = asRecord(item);
        if (!faq) continue;
        const question = textOf(faq.question).trim();
        const answer = stripUngroundedText(textOf(faq.answer), facts);
        if (question && answer) faqItems.push({ question, answer });
      }
    }
  }

  const contact = facts.whatsappDigits
    ? `Hubungi Pomah Guesthouse lewat WhatsApp ${facts.whatsappDigits}.`
    : "Hubungi Pomah Guesthouse lewat halaman pemesanan.";
  for (const seed of facts.brief.faqSeeds) {
    const question = seed.trim();
    if (!question) continue;
    if (faqItems.some((item) => item.question.toLowerCase() === question.toLowerCase())) continue;
    const known = facts.propertyFaqs.find((item) => item.question.toLowerCase() === question.toLowerCase());
    faqItems.push({
      question,
      answer: known?.answer?.trim() || `${contact} Kami jawab pertanyaan ini berdasarkan data yang ada di resepsionis.`,
    });
  }
  while (faqItems.length < 4) {
    const fallback = facts.propertyFaqs[faqItems.length];
    if (fallback) faqItems.push({ question: fallback.question, answer: fallback.answer });
    else {
      faqItems.push({
        question: `Pertanyaan ${faqItems.length + 1} tentang ${keyword}?`,
        answer: contact,
      });
    }
  }

  let headline = "";
  for (const entry of rawSections) {
    const row = asRecord(entry);
    if (row?.type === "hero") headline = textOf(row.headline).trim();
  }
  if (keyword && !headline.toLowerCase().includes(keyword.toLowerCase())) {
    headline = headline ? `${keyword}: ${headline}` : keyword;
  }

  const room = facts.rooms.find((item) => facts.brief.roomTypeIds.includes(item.id)) ?? facts.rooms[0];
  const explore =
    facts.explore.find((item) => facts.brief.exploreSlugs.includes(item.slug)) ?? facts.explore[0];
  const linkBits: string[] = [];
  if (room?.slug) {
    const price = room.baseRate != null ? ` mulai ${money(room.baseRate)}` : "";
    linkBits.push(`<a href="/rooms/${room.slug}">${room.name}</a>${price}`);
  }
  linkBits.push(`<a href="/book">pesan kamar</a>`);
  if (explore?.slug) linkBits.push(`<a href="/explore/${explore.slug}">${explore.title}</a>`);
  const linkParagraph = `<p>Tamu bisa melihat ${linkBits.join(", ")}.</p>`;
  if (textBlocks.length === 0) {
    textBlocks.push({ id: nid(), type: "text", title: keyword, content: linkParagraph, align: "left" });
  } else if (!textBlocks.some((block) => block.type === "text" && /href=/.test(block.content))) {
    const last = textBlocks[textBlocks.length - 1];
    if (last.type === "text") last.content = `${last.content}${linkParagraph}`;
  }

  const verifiedIds = new Set(
    facts.landmarks.filter((row) => row.verified).map((row) => row.id),
  );
  const selectedIds = facts.brief.landmarkIds.filter((id) => id);
  const locationIds = selectedIds.length > 0 ? selectedIds : [...verifiedIds];

  const wa = facts.whatsappDigits ? `https://wa.me/${facts.whatsappDigits}` : "/book";
  const sections: LPSection[] = [
    {
      id: nid(),
      type: "hero",
      headline: headline.slice(0, 180),
      subheadline: `Pomah Guesthouse di ${facts.address}`,
      cta_text: "Pesan kamar",
      cta_url: "/book",
      overlay: 40,
    },
    ...textBlocks.slice(0, 3),
    { id: nid(), type: "location", title: "Jarak dari Pomah", landmark_ids: locationIds },
    {
      id: nid(),
      type: "filtered_rooms",
      title: "Kamar yang cocok",
      min_capacity: facts.brief.minCapacity,
      room_type_ids: facts.brief.roomTypeIds,
    },
    { id: nid(), type: "starting_price", title: "Mulai dari" },
    { id: nid(), type: "datepicker", heading: "Cek ketersediaan", buttonLabel: "Cek ketersediaan" },
    {
      id: nid(),
      type: "filtered_reviews",
      title: "Ulasan tamu",
      keywords: facts.brief.reviewKeywords,
      limit: 3,
    },
    { id: nid(), type: "faq", title: "Pertanyaan umum", items: faqItems.slice(0, 8) },
    {
      id: nid(),
      type: "related_explore",
      title: "Baca juga di Jelajahi Semarang",
      slugs: explore ? [explore.slug] : facts.brief.exploreSlugs.slice(0, 3),
    },
    {
      id: nid(),
      type: "cta_banner",
      headline: `Siap menginap untuk ${keyword}?`,
      subheadline: "Cek tanggal di situs resmi.",
      cta_text: "Pesan kamar",
      cta_url: "/book",
      style: "teal",
    },
    {
      id: nid(),
      type: "button",
      text: "WhatsApp",
      url: wa,
      align: "center",
      variant: "solid",
      color: "teal",
    },
  ];

  return {
    metaTitle: clamp(textOf(model.meta_title) || `${keyword} | Pomah`, 60),
    metaDescription: clamp(textOf(model.meta_description) || `${keyword} di ${facts.address}. Pesan kamar langsung.`, 160),
    sections,
  };
}
