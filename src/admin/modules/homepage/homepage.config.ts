/**
 * Homepage Builder — configuration model (pure, no server imports).
 *
 * The public homepage is customised through a single JSONB document
 * (`HomepageConfig`) stored on the first `properties` row. This module
 * is shared by both the public homepage and the admin builder, so it
 * must stay free of server-only imports.
 */

export interface NavLink {
  label: string;
  href: string;
}

/** Reorderable homepage content sections (between hero/date-picker and footer). */
export type HomeSectionKey =
  | "badges"
  | "story"
  | "reviews"
  | "rooms"
  | "facilities"
  | "lokasi"
  | "news"
  | "cta";

/** Human labels for the section-order editor. */
export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  badges: "Ikon Fitur",
  story: "Teks (Your Perfect Stay)",
  reviews: "Google Rating & Ulasan",
  rooms: "Our Room (Kamar)",
  facilities: "Facilities",
  lokasi: "Lokasi Kami",
  news: "News & Event",
  cta: "CTA Banner",
};

/** Default render order, matching the current layout. */
export const DEFAULT_SECTION_ORDER: HomeSectionKey[] = [
  "badges",
  "story",
  "reviews",
  "rooms",
  "facilities",
  "lokasi",
  "news",
  "cta",
];

export interface HeroSlide {
  imageUrl: string;
  /** Optional background video — takes precedence over the image. */
  videoUrl: string;
  heading: string;
  subheading: string;
}

export interface HomepageConfig {
  header: {
    /**
     * Visual preset:
     *  - "pill"        floating white pill over the hero (overlaps)
     *  - "transparent" transparent bar over the hero, white text (overlaps)
     *  - "solid"       solid colored bar in flow (no overlap)
     *  - "minimal"     white bar with dark text in flow (no overlap)
     */
    style: "pill" | "transparent" | "solid" | "minimal";
    bgColor: string;
    bookLabel: string;
    links: NavLink[];
    /** Overlay the hero with a see-through header. */
    transparent: boolean;
    /** Background opacity (0–100) used when `transparent` is on. */
    opacity: number;
    /** Render a drop shadow under the header. */
    dropShadow: boolean;
    /** Blur the page content showing behind the header. */
    blur: boolean;
    /** Blur strength in pixels, used when `blur` is on. */
    blurAmount: number;
    /** How the header behaves when the visitor scrolls. */
    scrollBehavior: "scroll" | "freeze" | "disappear" | "fade";
    /** Logo height in pixels. */
    logoSize: number;
    /** Logo placement within the header. */
    logoPosition: "left" | "center" | "right";
  };
  hero: {
    slides: HeroSlide[];
    autoplayMs: number;
    height: number;
    /** Transition animation between slides. */
    transition: "fade" | "slide" | "zoom" | "none";
    /** Stacking order (CSS z-index) of the section. */
    layer: number;
    /** Heading font family (tipe). */
    fontFamily: "sans" | "serif" | "mono";
    /** Heading font size in pixels (Desktop). */
    fontSize: number;
    /** Heading font size in pixels (Mobile). */
    fontSizeMobile?: number;
    /** Heading font style. */
    fontStyle: "normal" | "bold" | "italic";
    /** Gold script accent line under the heading (e.g. "di Semarang"). */
    accent: string;
    /** Horizontal alignment of the hero content. */
    textAlign: "left" | "center" | "right";
  };
  bookingHero: {
    slides: HeroSlide[];
    autoplayMs: number;
    height: number;
    transition: "fade" | "slide" | "zoom" | "none";
    layer: number;
    fontFamily: "sans" | "serif" | "mono";
    fontSize: number;
    fontSizeMobile?: number;
    fontStyle: "normal" | "bold" | "italic";
    accent: string;
    textAlign: "left" | "center" | "right";
  };
  datePicker: {
    enabled: boolean;
    heading: string;
    buttonLabel: string;
    /** Heading font family. */
    fontFamily: "sans" | "serif" | "mono";
    /** Heading font size in pixels. */
    fontSize: number;
    /** Heading font style. */
    fontStyle: "normal" | "bold" | "italic";
    /** Stacking order (CSS z-index) of the section. */
    layer: number;
  };
  story: {
    heading: string;
    paragraphs: string[];
    fontFamily: "sans" | "serif" | "mono";
    fontSize: number;
    fontStyle: "normal" | "bold" | "italic";
  };
  roomCarousel: {
    heading: string;
    subheading: string;
    cardsPerView: number;
    slideMs: number;
    autoplay: boolean;
    /** Stacking order (CSS z-index) of the section. */
    layer: number;
    bgColor?: string;
    bgImageUrl?: string;
    fontFamily: "sans" | "serif" | "mono";
    fontSize: number;
    fontStyle: "normal" | "bold" | "italic";
  };
  lokasi: {
    heading: string;
    subheading: string;
    /** Title of the "nearby places" card. */
    nearbyTitle: string;
    nearby: { name: string; type: string; distance: string; time: string }[];
  };
  /**
   * Render order of the homepage content sections (between the hero/date-picker
   * and the footer). Reorderable from the Page Builder. Unknown keys are
   * ignored; missing known keys simply aren't rendered.
   */
  sectionOrder: HomeSectionKey[];
  /** SEO settings for the home page (edited in Page Builder → Page Settings). */
  seo: {
    metaTitle: string;
    metaDescription: string;
    targetKeyword: string;
    ogImageUrl: string;
    customHead: string;
    customRobots: string;
    jsonLdEnabled: boolean;
    customJsonLd: string;
  };
  bookingSeo: {
    metaTitle: string;
    metaDescription: string;
    targetKeyword: string;
    ogImageUrl: string;
    customHead: string;
    customRobots: string;
    jsonLdEnabled: boolean;
    customJsonLd: string;
  };
}

/** Lowest / highest z-index a section layer can take. */
export const LAYER_MIN = 0;
export const LAYER_MAX = 50;

/** Sensible defaults used before an admin has saved anything. */
export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
  header: {
    style: "pill",
    bgColor: "#7c4a21",
    bookLabel: "Pesan Kamar",
    links: [
      { label: "Home", href: "/" },
      { label: "Rooms", href: "/rooms" },
      { label: "Facilities", href: "#facilities" },
      { label: "Lokasi", href: "#lokasi" },
    ],
    transparent: false,
    opacity: 60,
    dropShadow: true,
    blur: false,
    blurAmount: 8,
    scrollBehavior: "freeze",
    logoSize: 40,
    logoPosition: "left",
  },
  hero: {
    slides: [
      {
        imageUrl: "",
        videoUrl: "",
        heading: "Selamat Datang Di Pomah Guesthouse",
        subheading: "Penginapan Murah di Kota Semarang",
      },
    ],
    autoplayMs: 5000,
    height: 480,
    transition: "fade",
    layer: 10,
    fontFamily: "serif",
    fontSize: 48,
    fontSizeMobile: 32,
    fontStyle: "bold",
    accent: "",
    textAlign: "center",
  },
  bookingHero: {
    slides: [
      {
        imageUrl: "",
        videoUrl: "",
        heading: "Pesan kamar dengan mudah",
        subheading: "Cek ketersediaan, pilih kamar, dan konfirmasi booking dalam beberapa langkah.",
      },
    ],
    autoplayMs: 5000,
    height: 480,
    transition: "fade",
    layer: 10,
    fontFamily: "serif",
    fontSize: 48,
    fontSizeMobile: 32,
    fontStyle: "bold",
    accent: "",
    textAlign: "center",
  },
  datePicker: {
    enabled: true,
    heading: "Cek Ketersediaan",
    buttonLabel: "Cek Ketersediaan",
    fontFamily: "serif",
    fontSize: 18,
    fontStyle: "bold",
    layer: 30,
  },
  story: {
    heading: "Your Perfect Stay",
    paragraphs: [
      "Kata Pomah dalam bahasa Jawa berarti Rumah. Terletak sedikit di pinggir kota Semarang yang dijuluki Venice of Java, Pomah Guesthouse memiliki filosofi yang mencerminkan kehangatan, kenyamanan dan standar pelayanan terbaik yang kami sajikan kepada tamu.",
      "Kami di Pomah yakin bahwa setiap perjalanan seharusnya memberikan cerita-cerita baru dimulai, kenangan indah tercipta dan momen kebersamaan terjalin.",
    ],
    fontFamily: "serif",
    fontSize: 32,
    fontStyle: "bold",
  },
  roomCarousel: {
    heading: "Our Room",
    subheading: "Pilih tanggal check-in dan check-out untuk melihat ketersediaan kamar",
    cardsPerView: 3,
    slideMs: 4000,
    autoplay: true,
    layer: 10,
    bgColor: "#f3ece0",
    bgImageUrl: "",
    fontFamily: "serif",
    fontSize: 32,
    fontStyle: "bold",
  },
  lokasi: {
    heading: "Lokasi Kami",
    subheading: "Temukan kami di lokasi strategis yang mudah diakses",
    nearbyTitle: "Lokasi Terdekat (Radius 5km)",
    nearby: [
      { name: "Unnes Sekaran", type: "Universitas", distance: "8 km", time: "~13 menit" },
      { name: "Unwahas Menoreh", type: "Universitas", distance: "1.3 km", time: "~5 menit" },
      { name: "Jatidiri GOR", type: "Olahraga", distance: "3.7 km", time: "~10 menit" },
      { name: "Pintu Tol Jatingaleh", type: "Pintu Tol", distance: "5 km", time: "~12 menit" },
      { name: "Undip Tembalang", type: "Universitas", distance: "8 km", time: "~20 menit" },
    ],
  },
  sectionOrder: [...DEFAULT_SECTION_ORDER],
  seo: {
    metaTitle: "Pomah Guesthouse Semarang | Hotel Murah & Nyaman di Semarang",
    metaDescription:
      "Pomah Guesthouse — penginapan murah dan nyaman di Kota Semarang. Kamar bersih, pelayanan ramah, lokasi strategis.",
    targetKeyword: "",
    ogImageUrl: "",
    customHead: "",
    customRobots: "",
    jsonLdEnabled: true,
    customJsonLd: "",
  },
  bookingSeo: {
    metaTitle: "Booking Kamar | Pomah Guesthouse Semarang",
    metaDescription:
      "Booking kamar di Pomah Guesthouse Semarang. Cek ketersediaan dan pesan kamar dengan harga terbaik langsung dari website resmi kami.",
    targetKeyword: "",
    ogImageUrl: "",
    customHead: "",
    customRobots: "",
    jsonLdEnabled: true,
    customJsonLd: "",
  },
};

/**
 * Normalise a stored section order: keep valid known keys in their saved order,
 * then append any known keys that were missing — so new sections always appear
 * and removed/duplicate entries can't break the layout.
 */
export function sanitizeSectionOrder(raw: unknown): HomeSectionKey[] {
  const valid = new Set<HomeSectionKey>(DEFAULT_SECTION_ORDER);
  const seen = new Set<HomeSectionKey>();
  const result: HomeSectionKey[] = [];
  if (Array.isArray(raw)) {
    for (const k of raw) {
      if (valid.has(k as HomeSectionKey) && !seen.has(k as HomeSectionKey)) {
        seen.add(k as HomeSectionKey);
        result.push(k as HomeSectionKey);
      }
    }
  }
  for (const k of DEFAULT_SECTION_ORDER) if (!seen.has(k)) result.push(k);
  return result;
}

/** Merge a stored (possibly partial) config onto the defaults. */
export function mergeHomepageConfig(raw: unknown): HomepageConfig {
  const c = (raw ?? {}) as Partial<HomepageConfig>;
  const d = DEFAULT_HOMEPAGE_CONFIG;
  return {
    header: { ...d.header, ...c.header },
    hero: { ...d.hero, ...c.hero },
    bookingHero: { ...d.bookingHero, ...c.bookingHero },
    datePicker: { ...d.datePicker, ...c.datePicker },
    story: { ...d.story, ...c.story },
    roomCarousel: { ...d.roomCarousel, ...c.roomCarousel },
    lokasi: { ...d.lokasi, ...c.lokasi },
    sectionOrder: sanitizeSectionOrder(c.sectionOrder),
    seo: { ...d.seo, ...c.seo },
    bookingSeo: { ...d.bookingSeo, ...c.bookingSeo },
  };
}
