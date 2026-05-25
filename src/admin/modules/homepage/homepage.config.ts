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

export interface HeroSlide {
  imageUrl: string;
  /** Optional background video — takes precedence over the image. */
  videoUrl: string;
  heading: string;
  subheading: string;
}

export interface HomepageConfig {
  header: {
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
    /** Heading font size in pixels. */
    fontSize: number;
    /** Heading font style. */
    fontStyle: "normal" | "bold" | "italic";
  };
  bookingHero: {
    slides: HeroSlide[];
    autoplayMs: number;
    height: number;
    transition: "fade" | "slide" | "zoom" | "none";
    layer: number;
    fontFamily: "sans" | "serif" | "mono";
    fontSize: number;
    fontStyle: "normal" | "bold" | "italic";
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
    bgColor: "#0f766e",
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
    fontStyle: "bold",
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
    fontStyle: "bold",
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
    seo: { ...d.seo, ...c.seo },
    bookingSeo: { ...d.bookingSeo, ...c.bookingSeo },
  };
}
