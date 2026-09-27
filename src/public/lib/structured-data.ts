/**
 * Per-page JSON-LD. Prices and review counts must come from the same
 * objects the page renders — do not hardcode room rates here.
 */
import { CANONICAL_ORIGIN, canonicalUrlForPath } from "@/public/lib/public-seo";
import {
  POMAH_GEO,
  POMAH_LOCALITY,
  POMAH_NAME,
  POMAH_POSTAL_CODE,
  POMAH_REGION,
  POMAH_STREET,
  pomahHasMapUrl,
  sameAsLinks,
  schemaTelephone,
} from "@/public/lib/site-identity";

const ORG_ID = `${CANONICAL_ORIGIN}/#organization`;
const WEBSITE_ID = `${CANONICAL_ORIGIN}/#website`;
const LODGING_ID = `${CANONICAL_ORIGIN}/#lodging`;

export type SchemaRoom = {
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  base_rate?: number | string | null;
  capacity?: number | null;
  bed_type?: string | null;
};

export type SchemaReviews = {
  rating?: number | null;
  total?: number | null;
};

export type FaqItem = { question: string; answer: string };

export const HOMEPAGE_FAQS: FaqItem[] = [
  {
    question: "Di mana lokasi Pomah Guesthouse?",
    answer: "Pomah Guesthouse berlokasi di Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, Jawa Tengah.",
  },
  {
    question: "Jam berapa check-in dan check-out?",
    answer: "Check-in mulai pukul 14.00 WIB dan check-out maksimal pukul 12.00 WIB.",
  },
  {
    question: "Apakah tersedia WiFi gratis?",
    answer: "Ya, Pomah Guesthouse menyediakan WiFi gratis untuk tamu.",
  },
  {
    question: "Apakah tersedia parkir?",
    answer: "Ya, tersedia area parkir untuk tamu Pomah Guesthouse.",
  },
  {
    question: "Bagaimana cara booking kamar?",
    answer: "Tamu dapat memesan lewat situs resmi Pomah Guesthouse atau WhatsApp yang tertera di halaman.",
  },
];

type SocialProperty = {
  instagram_url?: string | null;
  tiktok_url?: string | null;
  facebook_url?: string | null;
  youtube_url?: string | null;
  whatsapp_number?: string | null;
  email?: string | null;
};

function priceNumber(value: number | string | null | undefined): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function roomId(slug: string): string {
  return `${CANONICAL_ORIGIN}/#room-${slug}`;
}

export function postalAddress() {
  return {
    "@type": "PostalAddress",
    streetAddress: `${POMAH_STREET} Sampangan`,
    addressLocality: "Semarang",
    addressRegion: POMAH_REGION,
    postalCode: POMAH_POSTAL_CODE,
    addressCountry: "ID",
  };
}

export function siteIdentityGraph(property?: SocialProperty | null) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: POMAH_NAME,
        url: `${CANONICAL_ORIGIN}/`,
        email: property?.email || "info@pomahguesthouse.com",
        telephone: schemaTelephone(property?.whatsapp_number),
        address: postalAddress(),
        sameAs: sameAsLinks(property),
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: `${CANONICAL_ORIGIN}/`,
        name: POMAH_NAME,
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}

function hotelRoomNode(room: SchemaRoom) {
  const name = (room.name ?? "").trim() || "Kamar";
  const slug = (room.slug ?? "").trim();
  const price = priceNumber(room.base_rate);
  const node: Record<string, unknown> = {
    "@type": "HotelRoom",
    "@id": slug ? roomId(slug) : undefined,
    name,
    description: (room.description ?? "").trim() || `${name} di ${POMAH_NAME} Semarang.`,
    url: slug ? canonicalUrlForPath(`/rooms/${slug}`) : `${CANONICAL_ORIGIN}/`,
    containedInPlace: { "@id": LODGING_ID },
  };
  if (room.capacity) {
    node.occupancy = { "@type": "QuantitativeValue", value: room.capacity };
  }
  if (room.bed_type) {
    node.bed = { "@type": "BedDetails", typeOfBed: room.bed_type };
  }
  if (price != null) {
    node.offers = {
      "@type": "Offer",
      price,
      priceCurrency: "IDR",
      availability: "https://schema.org/InStock",
      url: slug ? canonicalUrlForPath(`/rooms/${slug}`) : `${CANONICAL_ORIGIN}/`,
    };
  }
  return node;
}

export function homepageLodgingGraph(input: {
  rooms: SchemaRoom[];
  reviews?: SchemaReviews | null;
  property?: SocialProperty | null;
  faqs?: FaqItem[] | null;
}) {
  const rooms = input.rooms.filter((room) => (room.slug ?? "").trim() && (room.name ?? "").trim());
  const prices = rooms
    .map((room) => priceNumber(room.base_rate))
    .filter((price): price is number => price != null);
  const rating = Number(input.reviews?.rating);
  const reviewCount = Number(input.reviews?.total);
  const graph: Record<string, unknown>[] = [
    {
      "@type": "LodgingBusiness",
      "@id": LODGING_ID,
      name: POMAH_NAME,
      description: `Guesthouse keluarga di ${POMAH_LOCALITY}. Dekat UNNES Sekaran.`,
      url: `${CANONICAL_ORIGIN}/`,
      telephone: schemaTelephone(input.property?.whatsapp_number),
      email: input.property?.email || "info@pomahguesthouse.com",
      address: postalAddress(),
      geo: {
        "@type": "GeoCoordinates",
        latitude: POMAH_GEO.latitude,
        longitude: POMAH_GEO.longitude,
      },
      hasMap: pomahHasMapUrl(),
      sameAs: sameAsLinks(input.property),
      checkinTime: "14:00",
      checkoutTime: "12:00",
      ...(prices.length
        ? { priceRange: `IDR ${Math.min(...prices)} - ${Math.max(...prices)}` }
        : {}),
      ...(Number.isFinite(rating) && rating > 0 && Number.isFinite(reviewCount) && reviewCount > 0
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: String(rating),
              reviewCount,
              bestRating: "5",
              worstRating: "1",
            },
          }
        : {}),
      containsPlace: rooms.map((room) => ({ "@id": roomId(room.slug!.trim()) })),
    },
    ...rooms.map(hotelRoomNode),
  ];
  const faqs = input.faqs ?? [];
  if (faqs.length > 0) {
    graph.push(faqPageNode(`${CANONICAL_ORIGIN}/#faq`, faqs));
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export function faqPageGraph(pageUrl: string, faqs: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [faqPageNode(pageUrl, faqs)],
  };
}

function faqPageNode(pageUrl: string, faqs: FaqItem[]) {
  return {
    "@type": "FAQPage",
    "@id": `${pageUrl}#faq`,
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export function roomPageGraph(room: SchemaRoom) {
  const name = (room.name ?? "").trim() || "Kamar";
  const slug = (room.slug ?? "").trim();
  const pageUrl = canonicalUrlForPath(`/rooms/${slug}`);
  return {
    "@context": "https://schema.org",
    "@graph": [
      hotelRoomNode(room),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Beranda", item: `${CANONICAL_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Kamar", item: `${CANONICAL_ORIGIN}/#rooms` },
          { "@type": "ListItem", position: 3, name, item: pageUrl },
        ],
      },
    ],
  };
}

export type GuideSchemaInput = {
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  dateText?: string | null;
};

function guideType(category: string | null | undefined): string {
  if (category === "kuliner") return "Restaurant";
  if (category === "event") return "Event";
  if (category === "destinasi") return "TouristAttraction";
  return "Place";
}

/**
 * /lp/penginapan-dekat-unnes: LodgingBusiness + BreadcrumbList + the page FAQ.
 * Room prices come from the same public room rows the rest of the site renders.
 */
export function unnesLandingGraph(input: {
  rooms?: SchemaRoom[] | null;
  reviews?: SchemaReviews | null;
  property?: SocialProperty | null;
  faqs: FaqItem[];
}) {
  const pageUrl = canonicalUrlForPath("/lp/penginapan-dekat-unnes");
  const lodging = homepageLodgingGraph({
    rooms: input.rooms ?? [],
    reviews: input.reviews,
    property: input.property,
  });
  return {
    "@context": "https://schema.org",
    "@graph": [
      ...(lodging["@graph"] as unknown[]),
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Beranda", item: `${CANONICAL_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Penginapan dekat UNNES", item: pageUrl },
        ],
      },
      faqPageNode(pageUrl, input.faqs),
    ],
  };
}

export function cityGuideGraph(place: GuideSchemaInput) {
  const pageUrl = canonicalUrlForPath(`/explore/${place.slug}`);
  const type = guideType(place.category);
  const node: Record<string, unknown> = {
    "@type": type,
    name: place.name,
    description: (place.description ?? "").trim() || place.name,
    url: pageUrl,
  };
  if (place.imageUrl && !/images\.unsplash\.com/i.test(place.imageUrl)) {
    node.image = place.imageUrl;
  }
  if (place.location) {
    node.address = place.location;
  }
  if (type === "Event" && place.dateText) {
    node.startDate = place.dateText;
    node.eventAttendanceMode = "https://schema.org/OfflineEventAttendanceMode";
    node.location = {
      "@type": "Place",
      name: place.location || place.name,
      address: place.location || "Semarang",
    };
  }
  return {
    "@context": "https://schema.org",
    "@graph": [
      node,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Beranda", item: `${CANONICAL_ORIGIN}/` },
          { "@type": "ListItem", position: 2, name: "Jelajahi Semarang", item: canonicalUrlForPath("/explore") },
          { "@type": "ListItem", position: 3, name: place.name, item: pageUrl },
        ],
      },
    ],
  };
}
