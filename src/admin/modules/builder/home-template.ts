/**
 * Default homepage document.
 *
 * The public homepage (`/`) is rendered through the visual editor's
 * `PageRenderer`. If a published landing page with slug `home` exists in
 * the database it is used; otherwise this built-in template is the
 * fallback — so the homepage never breaks, even before an admin has
 * opened the editor.
 *
 * To make the homepage editable, create a page with slug `home` in the
 * editor (or seed one); its published content then overrides this.
 */
import type { PageContent } from "./types";

/** Slug of the landing page that backs the public homepage. */
export const HOME_SLUG = "home";

export const HOME_TEMPLATE: PageContent = {
  version: 2,
  theme: {
    primaryColor: "#0f766e",
    textColor: "#1c1917",
    bgColor: "#f6f1e8",
    fontFamily: "sans",
    radius: 14,
  },
  sections: [
    {
      id: "s-nav",
      name: "Navigation",
      columns: 1,
      gap: 0,
      paddingY: 16,
      width: "wide",
      bgColor: "#0f766e",
      elements: [
        {
          id: "e-nav",
          type: "navbar",
          colSpan: 1,
          props: {
            brand: "Pomah Guesthouse",
            link1Label: "Rooms",
            link1Href: "/rooms",
            link2Label: "Book",
            link2Href: "/book",
            ctaLabel: "Pesan Kamar",
            ctaHref: "/book",
            bgColor: "#0f766e",
            textColor: "#ffffff",
            accentColor: "#ffffff",
          },
        },
      ],
    },
    {
      id: "s-hero",
      name: "Hero",
      columns: 1,
      gap: 0,
      paddingY: 0,
      width: "full",
      bgColor: "#0f766e",
      elements: [
        {
          id: "e-hero",
          type: "hero",
          colSpan: 1,
          props: {
            eyebrow: "Penginapan Murah di Kota Semarang",
            heading: "Selamat Datang Di Pomah Guesthouse",
            subheading:
              "Kamar bersih, pelayanan ramah, lokasi strategis di Semarang — Venice of Java.",
            primaryLabel: "Pesan Kamar",
            primaryHref: "/book",
            secondaryLabel: "Lihat Kamar",
            secondaryHref: "/rooms",
            align: "center",
            bgColor: "#0f766e",
            textColor: "#ffffff",
            accentColor: "#f6f1e8",
          },
        },
      ],
    },
    {
      id: "s-booking",
      name: "Booking widget",
      columns: 1,
      gap: 0,
      paddingY: 48,
      width: "narrow",
      bgColor: "#f6f1e8",
      elements: [
        {
          id: "e-datepicker",
          type: "date-picker",
          colSpan: 1,
          props: {
            heading: "Cek Ketersediaan",
            subheading: "Pilih tanggal check-in dan check-out untuk melihat kamar tersedia.",
            buttonLabel: "Cek Ketersediaan",
            buttonHref: "/book",
            accentColor: "#0f766e",
            bgColor: "#0f766e",
          },
        },
      ],
    },
    {
      id: "s-story",
      name: "Your Perfect Stay",
      columns: 1,
      gap: 16,
      paddingY: 64,
      width: "narrow",
      bgColor: "#f6f1e8",
      elements: [
        {
          id: "e-story-heading",
          type: "heading",
          colSpan: 1,
          props: { text: "Your Perfect Stay", level: "h2", align: "center", color: "#1c1917" },
        },
        {
          id: "e-story-text",
          type: "text",
          colSpan: 1,
          props: {
            content:
              "Kata Pomah dalam bahasa Jawa berarti Rumah. Terletak sedikit di pinggir kota Semarang, Pomah Guesthouse memiliki filosofi yang mencerminkan kehangatan, kenyamanan dan standar pelayanan terbaik. Setiap perjalanan seharusnya memberikan cerita baru, kenangan indah, dan momen kebersamaan.",
            align: "center",
            textColor: "#57534e",
          },
        },
      ],
    },
    {
      id: "s-rooms",
      name: "Our Accommodations",
      columns: 1,
      gap: 0,
      paddingY: 72,
      width: "wide",
      bgColor: "#f3ece0",
      elements: [
        {
          id: "e-rooms",
          type: "rooms",
          colSpan: 1,
          props: {
            heading: "Our Accommodations",
            subheading: "Pilih kamar yang paling sesuai untuk menginap Anda.",
            mode: "grid",
            columns: 3,
            maxRooms: 6,
            autoplayMs: 4000,
            animation: "slide",
            showPrice: true,
            ctaLabel: "Pesan Kamar",
            ctaHref: "/book",
            accentColor: "#0f766e",
            emptyText: "Belum ada kamar tersedia.",
          },
        },
      ],
    },
    {
      id: "s-facilities",
      name: "Facilities",
      columns: 1,
      gap: 0,
      paddingY: 72,
      width: "wide",
      bgColor: "#f6f1e8",
      elements: [
        {
          id: "e-facilities",
          type: "features",
          colSpan: 1,
          props: {
            heading: "Facilities",
            subheading: "Fasilitas yang dirancang untuk membuat menginap Anda nyaman dan berkesan.",
            f1Icon: "Wifi",
            f1Title: "Free Wi-Fi",
            f1Desc: "Wi-Fi gratis di seluruh area penginapan.",
            f2Icon: "Coffee",
            f2Title: "Mini Cafe",
            f2Desc: "Kopi dan sarapan untuk memulai hari Anda.",
            f3Icon: "ShieldCheck",
            f3Title: "Parkir Aman",
            f3Desc: "Area parkir luas dan gratis untuk tamu.",
            accentColor: "#0f766e",
          },
        },
      ],
    },
    {
      id: "s-location",
      name: "Lokasi Kami",
      columns: 1,
      gap: 0,
      paddingY: 72,
      width: "wide",
      bgColor: "#f3ece0",
      elements: [
        {
          id: "e-location",
          type: "location",
          colSpan: 1,
          props: {
            heading: "Lokasi Kami",
            subheading: "Temukan kami di lokasi strategis yang mudah diakses.",
            addressOverride: "",
            mapHeight: 320,
            nearbyHeading: "Lokasi Terdekat (Radius 5km)",
            accentColor: "#0f766e",
            p1Name: "Unwahas Menoreh",
            p1Type: "Universitas",
            p1Distance: "1.3 km",
            p1Time: "~5 menit",
            p2Name: "Jatidiri GOR",
            p2Type: "Olahraga",
            p2Distance: "3.7 km",
            p2Time: "~10 menit",
            p3Name: "Pintu Tol Jatingaleh",
            p3Type: "Pintu Tol",
            p3Distance: "5 km",
            p3Time: "~12 menit",
            p4Name: "Unnes Sekaran",
            p4Type: "Universitas",
            p4Distance: "8 km",
            p4Time: "~13 menit",
            p5Name: "Undip Tembalang",
            p5Type: "Universitas",
            p5Distance: "8 km",
            p5Time: "~20 menit",
          },
        },
      ],
    },
    {
      id: "s-cta",
      name: "Call to Action",
      columns: 1,
      gap: 0,
      paddingY: 64,
      width: "wide",
      bgColor: "#f6f1e8",
      elements: [
        {
          id: "e-cta",
          type: "cta",
          colSpan: 1,
          props: {
            heading: "Siap merencanakan menginap Anda?",
            text: "Pesan langsung dan dapatkan harga terbaik kami, dikonfirmasi via WhatsApp.",
            buttonLabel: "Pesan Sekarang",
            buttonHref: "/book",
            bgColor: "#0f766e",
            textColor: "#ffffff",
          },
        },
      ],
    },
    {
      id: "s-footer",
      name: "Footer",
      columns: 1,
      gap: 0,
      paddingY: 0,
      width: "full",
      bgColor: "#115e59",
      elements: [
        {
          id: "e-footer",
          type: "footer",
          colSpan: 1,
          props: {
            brand: "Pomah Guesthouse",
            tagline: "Penginapan murah & nyaman di Kota Semarang.",
            copyright: "© 2026 Pomah Guesthouse. Semua hak dilindungi.",
            bgColor: "#115e59",
            textColor: "#ccfbf1",
          },
        },
      ],
    },
  ],
};
