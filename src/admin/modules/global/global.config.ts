import { NavLink } from "../homepage/homepage.config";

export interface GlobalHeaderConfig {
  style: "pill" | "transparent" | "solid" | "minimal";
  bgColor: string;
  bookLabel: string;
  links: NavLink[];
  transparent: boolean;
  opacity: number;
  dropShadow: boolean;
  blur: boolean;
  blurAmount: number;
  scrollBehavior: "scroll" | "freeze" | "disappear" | "fade";
  logoSize: number;
  logoPosition: "left" | "center" | "right";
}

export interface GlobalFooterConfig {
  enabled: boolean;
  bgColor: string;
  textColor: string;
  text: string;
  showSocials: boolean;
  companyLinks: NavLink[];
  serviceLinks: NavLink[];
}

export interface GlobalWhatsappConfig {
  enabled: boolean;
  phoneNumber: string;
  message: string;
  position: "bottom-left" | "bottom-right";
}

export interface GlobalCookieBannerConfig {
  enabled: boolean;
  text: string;
  buttonText: string;
}

export interface GlobalConfig {
  header: GlobalHeaderConfig;
  footer: GlobalFooterConfig;
  whatsapp: GlobalWhatsappConfig;
  cookieBanner: GlobalCookieBannerConfig;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  header: {
    style: "pill",
    bgColor: "#7c4a21",
    bookLabel: "Pesan Kamar",
    links: [
      { label: "Home", href: "/" },
      { label: "Rooms", href: "/rooms" },
      { label: "Facilities", href: "/book" },
      { label: "Lokasi", href: "/book" },
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
  footer: {
    enabled: true,
    bgColor: "#134e4a",
    textColor: "#ccfbf1",
    text: "Experience comfort and hospitality.",
    showSocials: true,
    companyLinks: [
      { label: "Home", href: "/" },
      { label: "Rooms", href: "/rooms" },
    ],
    serviceLinks: [
      { label: "Amenities", href: "#facilities" },
      { label: "Lokasi", href: "#lokasi" },
    ],
  },
  whatsapp: {
    enabled: true,
    phoneNumber: "628112651818",
    message: "Halo, saya ingin bertanya tentang Pomah Guesthouse.",
    position: "bottom-right",
  },
  cookieBanner: {
    enabled: false,
    text: "Kami menggunakan cookie untuk memastikan Anda mendapatkan pengalaman terbaik di situs web kami.",
    buttonText: "Mengerti",
  },
};

export function mergeGlobalConfig(raw: unknown): GlobalConfig {
  const c = (raw ?? {}) as Partial<GlobalConfig>;
  const d = DEFAULT_GLOBAL_CONFIG;
  return {
    header: { ...d.header, ...(c.header || {}) },
    footer: { ...d.footer, ...(c.footer || {}) },
    whatsapp: { ...d.whatsapp, ...(c.whatsapp || {}) },
    cookieBanner: { ...d.cookieBanner, ...(c.cookieBanner || {}) },
  };
}
