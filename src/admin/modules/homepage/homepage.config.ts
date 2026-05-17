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
  };
  datePicker: {
    enabled: boolean;
    heading: string;
    buttonLabel: string;
  };
  roomCarousel: {
    cardsPerView: number;
    slideMs: number;
    autoplay: boolean;
  };
}

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
        heading: "Selamat Datang Di Pomah Guesthouse",
        subheading: "Penginapan Murah di Kota Semarang",
      },
    ],
    autoplayMs: 5000,
    height: 480,
  },
  datePicker: {
    enabled: true,
    heading: "Cek Ketersediaan",
    buttonLabel: "Cek Ketersediaan",
  },
  roomCarousel: {
    cardsPerView: 3,
    slideMs: 4000,
    autoplay: true,
  },
};

/** Merge a stored (possibly partial) config onto the defaults. */
export function mergeHomepageConfig(raw: unknown): HomepageConfig {
  const c = (raw ?? {}) as Partial<HomepageConfig>;
  const d = DEFAULT_HOMEPAGE_CONFIG;
  return {
    header: { ...d.header, ...c.header },
    hero: { ...d.hero, ...c.hero },
    datePicker: { ...d.datePicker, ...c.datePicker },
    roomCarousel: { ...d.roomCarousel, ...c.roomCarousel },
  };
}
