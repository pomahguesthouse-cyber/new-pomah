/**
 * Component registry for the Visual Page Builder.
 *
 * Every builder component is declared once here: its palette metadata,
 * default props, the editable `fields` (which auto-generate the property
 * panel) and a pure `render` function. Both the editor canvas and the
 * public render route consume this same registry, so what you see in the
 * editor is exactly what ships.
 */
import { Wifi, Coffee, ShowerHead, MapPin, Star, ShieldCheck, Sparkles, Heart } from "lucide-react";
import type { ComponentDef, ComponentType } from "./types";

/* ------------------------------------------------------------------ */
/* Prop helpers — read the free-form props bag with safe fallbacks      */
/* ------------------------------------------------------------------ */
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : v == null ? fallback : String(v);
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);

const ALIGN: Record<string, string> = {
  left: "text-left items-start",
  center: "text-center items-center",
  right: "text-right items-end",
};

const FEATURE_ICONS = { Wifi, Coffee, ShowerHead, MapPin, Star, ShieldCheck, Sparkles, Heart };
type FeatureIconName = keyof typeof FEATURE_ICONS;

function FeatureIcon({ name }: { name: string }) {
  const Icon =
    FEATURE_ICONS[(name as FeatureIconName) in FEATURE_ICONS ? (name as FeatureIconName) : "Star"];
  return <Icon className="h-5 w-5" />;
}

const ICON_OPTIONS = Object.keys(FEATURE_ICONS).map((k) => ({ label: k, value: k }));
const ALIGN_OPTIONS = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
];

/* ------------------------------------------------------------------ */
/* Component definitions                                                */
/* ------------------------------------------------------------------ */

const hero: ComponentDef = {
  type: "hero",
  label: "Hero",
  icon: "LayoutTemplate",
  description: "Large headline section with call-to-action buttons.",
  defaults: {
    eyebrow: "Boutique Guesthouse",
    heading: "A place to rest that feels like home",
    subheading: "Calm, considered rooms in the heart of the city. Book direct — no commissions.",
    primaryLabel: "Book a room",
    primaryHref: "/book",
    secondaryLabel: "View rooms",
    secondaryHref: "/rooms",
    align: "center",
    bgColor: "#fafaf9",
    textColor: "#1c1917",
    accentColor: "#b45309",
  },
  fields: [
    { key: "eyebrow", label: "Eyebrow", type: "text", group: "Content" },
    { key: "heading", label: "Heading", type: "textarea", group: "Content" },
    { key: "subheading", label: "Subheading", type: "textarea", group: "Content" },
    { key: "primaryLabel", label: "Primary button", type: "text", group: "Buttons" },
    { key: "primaryHref", label: "Primary link", type: "text", group: "Buttons" },
    { key: "secondaryLabel", label: "Secondary button", type: "text", group: "Buttons" },
    { key: "secondaryHref", label: "Secondary link", type: "text", group: "Buttons" },
    { key: "align", label: "Alignment", type: "select", options: ALIGN_OPTIONS, group: "Layout" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => {
    const align = ALIGN[str(p.align, "center")] ?? ALIGN.center;
    return (
      <section
        style={{ background: str(p.bgColor, "#fafaf9"), color: str(p.textColor, "#1c1917") }}
      >
        <div className={`mx-auto flex max-w-4xl flex-col gap-5 px-6 py-24 ${align}`}>
          {str(p.eyebrow) && (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.25em]"
              style={{ color: str(p.accentColor, "#b45309") }}
            >
              {str(p.eyebrow)}
            </span>
          )}
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            {str(p.heading)}
          </h1>
          <p className="max-w-xl text-base opacity-70 md:text-lg">{str(p.subheading)}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {str(p.primaryLabel) && (
              <a
                href={str(p.primaryHref, "#")}
                className="rounded-lg px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
                style={{ background: str(p.accentColor, "#b45309") }}
              >
                {str(p.primaryLabel)}
              </a>
            )}
            {str(p.secondaryLabel) && (
              <a
                href={str(p.secondaryHref, "#")}
                className="rounded-lg border px-6 py-3 text-sm font-medium transition hover:opacity-70"
                style={{ borderColor: "currentColor" }}
              >
                {str(p.secondaryLabel)}
              </a>
            )}
          </div>
        </div>
      </section>
    );
  },
};

const navbar: ComponentDef = {
  type: "navbar",
  label: "Navbar",
  icon: "PanelTop",
  description: "Top navigation bar with brand and links.",
  defaults: {
    brand: "Pomah Living",
    link1Label: "Rooms",
    link1Href: "/rooms",
    link2Label: "Book",
    link2Href: "/book",
    ctaLabel: "Reserve",
    ctaHref: "/book",
    bgColor: "#ffffff",
    textColor: "#1c1917",
    accentColor: "#b45309",
  },
  fields: [
    { key: "brand", label: "Brand name", type: "text", group: "Content" },
    { key: "link1Label", label: "Link 1 text", type: "text", group: "Links" },
    { key: "link1Href", label: "Link 1 URL", type: "text", group: "Links" },
    { key: "link2Label", label: "Link 2 text", type: "text", group: "Links" },
    { key: "link2Href", label: "Link 2 URL", type: "text", group: "Links" },
    { key: "ctaLabel", label: "CTA text", type: "text", group: "Links" },
    { key: "ctaHref", label: "CTA URL", type: "text", group: "Links" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <nav
      className="border-b"
      style={{ background: str(p.bgColor, "#fff"), color: str(p.textColor, "#1c1917") }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="font-serif text-lg font-semibold">{str(p.brand, "Brand")}</span>
        <div className="flex items-center gap-6 text-sm">
          {str(p.link1Label) && <a href={str(p.link1Href, "#")}>{str(p.link1Label)}</a>}
          {str(p.link2Label) && <a href={str(p.link2Href, "#")}>{str(p.link2Label)}</a>}
          {str(p.ctaLabel) && (
            <a
              href={str(p.ctaHref, "#")}
              className="rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: str(p.accentColor, "#b45309") }}
            >
              {str(p.ctaLabel)}
            </a>
          )}
        </div>
      </div>
    </nav>
  ),
};

const footer: ComponentDef = {
  type: "footer",
  label: "Footer",
  icon: "PanelBottom",
  description: "Closing section with brand and copyright.",
  defaults: {
    brand: "Pomah Living",
    tagline: "Boutique guesthouse with a personal touch.",
    copyright: "© 2026 Pomah Living. All rights reserved.",
    bgColor: "#1c1917",
    textColor: "#e7e5e4",
  },
  fields: [
    { key: "brand", label: "Brand name", type: "text", group: "Content" },
    { key: "tagline", label: "Tagline", type: "textarea", group: "Content" },
    { key: "copyright", label: "Copyright", type: "text", group: "Content" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <footer style={{ background: str(p.bgColor, "#1c1917"), color: str(p.textColor, "#e7e5e4") }}>
      <div className="mx-auto max-w-6xl px-6 py-14">
        <p className="font-serif text-xl font-semibold">{str(p.brand, "Brand")}</p>
        <p className="mt-2 max-w-sm text-sm opacity-70">{str(p.tagline)}</p>
        <p className="mt-8 border-t border-white/10 pt-6 text-xs opacity-50">{str(p.copyright)}</p>
      </div>
    </footer>
  ),
};

const cta: ComponentDef = {
  type: "cta",
  label: "Call to Action",
  icon: "Megaphone",
  description: "Focused banner that drives one action.",
  defaults: {
    heading: "Ready to plan your stay?",
    text: "Book direct and get our best rate, confirmed on WhatsApp within hours.",
    buttonLabel: "Book now",
    buttonHref: "/book",
    bgColor: "#b45309",
    textColor: "#ffffff",
  },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "text", label: "Text", type: "textarea", group: "Content" },
    { key: "buttonLabel", label: "Button text", type: "text", group: "Content" },
    { key: "buttonHref", label: "Button URL", type: "text", group: "Content" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <section style={{ background: str(p.bgColor, "#b45309"), color: str(p.textColor, "#fff") }}>
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">{str(p.heading)}</h2>
        <p className="mt-3 opacity-80">{str(p.text)}</p>
        {str(p.buttonLabel) && (
          <a
            href={str(p.buttonHref, "#")}
            className="mt-7 inline-block rounded-lg bg-white px-7 py-3 text-sm font-medium text-stone-900 transition hover:opacity-90"
          >
            {str(p.buttonLabel)}
          </a>
        )}
      </div>
    </section>
  ),
};

const text: ComponentDef = {
  type: "text",
  label: "Text Block",
  icon: "Type",
  description: "Rich paragraph of editable copy.",
  defaults: {
    content:
      "Write something meaningful here. This block is perfect for storytelling, descriptions, or any longer-form copy your visitors should read.",
    align: "left",
    bgColor: "#ffffff",
    textColor: "#44403c",
  },
  fields: [
    { key: "content", label: "Content", type: "textarea", group: "Content" },
    { key: "align", label: "Alignment", type: "select", options: ALIGN_OPTIONS, group: "Layout" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <section style={{ background: str(p.bgColor, "#fff"), color: str(p.textColor, "#44403c") }}>
      <div
        className={`mx-auto max-w-2xl px-6 py-14 text-base leading-relaxed ${
          ALIGN[str(p.align, "left")]?.split(" ")[0] ?? "text-left"
        }`}
      >
        {str(p.content)}
      </div>
    </section>
  ),
};

const image: ComponentDef = {
  type: "image",
  label: "Image",
  icon: "Image",
  description: "A single responsive image with optional caption.",
  defaults: {
    src: "",
    alt: "Image",
    caption: "",
    rounded: true,
    bgColor: "#ffffff",
  },
  fields: [
    { key: "src", label: "Image URL", type: "image", group: "Content" },
    {
      key: "alt",
      label: "Alt text",
      type: "text",
      group: "Content",
      hint: "Describe the image for accessibility & SEO.",
    },
    { key: "caption", label: "Caption", type: "text", group: "Content" },
    { key: "rounded", label: "Rounded corners", type: "boolean", group: "Style" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
  ],
  render: (p) => (
    <section style={{ background: str(p.bgColor, "#fff") }}>
      <figure className="mx-auto max-w-4xl px-6 py-12">
        {str(p.src) ? (
          <img
            src={str(p.src)}
            alt={str(p.alt, "Image")}
            className={`w-full object-cover ${bool(p.rounded, true) ? "rounded-2xl" : ""}`}
          />
        ) : (
          <div
            className={`flex aspect-[16/9] w-full items-center justify-center bg-stone-100 text-xs uppercase tracking-widest text-stone-400 ${
              bool(p.rounded, true) ? "rounded-2xl" : ""
            }`}
          >
            No image set
          </div>
        )}
        {str(p.caption) && (
          <figcaption className="mt-3 text-center text-xs text-stone-500">
            {str(p.caption)}
          </figcaption>
        )}
      </figure>
    </section>
  ),
};

const features: ComponentDef = {
  type: "features",
  label: "Features Grid",
  icon: "Grid3x3",
  description: "Three-up grid of icon features.",
  defaults: {
    heading: "Everything you need",
    subheading: "Thoughtful touches that make every stay comfortable.",
    f1Icon: "Wifi",
    f1Title: "Fast Wi-Fi",
    f1Desc: "Reliable internet throughout the property.",
    f2Icon: "Coffee",
    f2Title: "Breakfast",
    f2Desc: "Fresh local breakfast served every morning.",
    f3Icon: "ShowerHead",
    f3Title: "Ensuite bath",
    f3Desc: "A private bathroom in every room.",
    bgColor: "#ffffff",
    accentColor: "#b45309",
  },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "subheading", label: "Subheading", type: "textarea", group: "Content" },
    {
      key: "f1Icon",
      label: "Feature 1 icon",
      type: "select",
      options: ICON_OPTIONS,
      group: "Feature 1",
    },
    { key: "f1Title", label: "Feature 1 title", type: "text", group: "Feature 1" },
    { key: "f1Desc", label: "Feature 1 text", type: "textarea", group: "Feature 1" },
    {
      key: "f2Icon",
      label: "Feature 2 icon",
      type: "select",
      options: ICON_OPTIONS,
      group: "Feature 2",
    },
    { key: "f2Title", label: "Feature 2 title", type: "text", group: "Feature 2" },
    { key: "f2Desc", label: "Feature 2 text", type: "textarea", group: "Feature 2" },
    {
      key: "f3Icon",
      label: "Feature 3 icon",
      type: "select",
      options: ICON_OPTIONS,
      group: "Feature 3",
    },
    { key: "f3Title", label: "Feature 3 title", type: "text", group: "Feature 3" },
    { key: "f3Desc", label: "Feature 3 text", type: "textarea", group: "Feature 3" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => {
    const items = [
      { icon: str(p.f1Icon, "Wifi"), title: str(p.f1Title), desc: str(p.f1Desc) },
      { icon: str(p.f2Icon, "Coffee"), title: str(p.f2Title), desc: str(p.f2Desc) },
      { icon: str(p.f3Icon, "ShowerHead"), title: str(p.f3Title), desc: str(p.f3Desc) },
    ];
    return (
      <section style={{ background: str(p.bgColor, "#fff") }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-stone-900">
              {str(p.heading)}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{str(p.subheading)}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl border border-stone-200 bg-white p-6 text-center">
                <div
                  className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
                  style={{ background: str(p.accentColor, "#b45309") }}
                >
                  <FeatureIcon name={it.icon} />
                </div>
                <h3 className="mt-4 font-semibold text-stone-900">{it.title}</h3>
                <p className="mt-1.5 text-sm text-stone-500">{it.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  },
};

const roomCard: ComponentDef = {
  type: "room-card",
  label: "Room Card",
  icon: "BedDouble",
  description: "Showcase one room with price and a booking link.",
  defaults: {
    name: "Garden Room",
    badge: "Most popular",
    price: "Rp 450.000",
    priceSuffix: "/ night",
    bedType: "Queen bed",
    capacity: "2 guests",
    imageUrl: "",
    description: "A quiet room overlooking the garden, with an ensuite bath and fast Wi-Fi.",
    ctaLabel: "Book this room",
    ctaHref: "/book",
    accentColor: "#b45309",
    bgColor: "#fafaf9",
  },
  fields: [
    { key: "name", label: "Room name", type: "text", group: "Content" },
    { key: "badge", label: "Badge", type: "text", group: "Content" },
    { key: "price", label: "Price", type: "text", group: "Content" },
    { key: "priceSuffix", label: "Price suffix", type: "text", group: "Content" },
    { key: "bedType", label: "Bed type", type: "text", group: "Content" },
    { key: "capacity", label: "Capacity", type: "text", group: "Content" },
    { key: "description", label: "Description", type: "textarea", group: "Content" },
    { key: "imageUrl", label: "Image URL", type: "image", group: "Content" },
    { key: "ctaLabel", label: "Button text", type: "text", group: "Action" },
    { key: "ctaHref", label: "Button URL", type: "text", group: "Action" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
  ],
  render: (p) => (
    <section style={{ background: str(p.bgColor, "#fafaf9") }}>
      <div className="mx-auto max-w-4xl px-6 py-16">
        <article className="grid overflow-hidden rounded-2xl border border-stone-200 bg-white md:grid-cols-2">
          <div className="aspect-[4/3] bg-stone-100 md:aspect-auto">
            {str(p.imageUrl) ? (
              <img src={str(p.imageUrl)} alt={str(p.name)} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center text-xs uppercase tracking-widest text-stone-400">
                Room photo
              </div>
            )}
          </div>
          <div className="flex flex-col p-7">
            {str(p.badge) && (
              <span
                className="mb-2 w-fit rounded-full px-3 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                style={{ background: str(p.accentColor, "#b45309") }}
              >
                {str(p.badge)}
              </span>
            )}
            <h3 className="text-xl font-semibold text-stone-900">{str(p.name)}</h3>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
              {[str(p.bedType), str(p.capacity)].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-stone-500">{str(p.description)}</p>
            <div className="mt-auto flex items-center justify-between pt-6">
              <p className="text-lg font-semibold" style={{ color: str(p.accentColor, "#b45309") }}>
                {str(p.price)}
                <span className="ml-1 text-xs font-normal text-stone-400">
                  {str(p.priceSuffix)}
                </span>
              </p>
              <a
                href={str(p.ctaHref, "#")}
                className="rounded-lg px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                style={{ background: str(p.accentColor, "#b45309") }}
              >
                {str(p.ctaLabel)}
              </a>
            </div>
          </div>
        </article>
      </div>
    </section>
  ),
};

const bookingWidget: ComponentDef = {
  type: "booking-widget",
  label: "Booking Widget",
  icon: "CalendarCheck",
  description: "Date-style booking prompt with a check-availability action.",
  defaults: {
    heading: "Check availability",
    subheading: "Pick your dates and reserve in seconds.",
    buttonLabel: "Check availability",
    buttonHref: "/book",
    accentColor: "#b45309",
    bgColor: "#1c1917",
  },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "subheading", label: "Subheading", type: "textarea", group: "Content" },
    { key: "buttonLabel", label: "Button text", type: "text", group: "Content" },
    { key: "buttonHref", label: "Button URL", type: "text", group: "Content" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
  ],
  render: (p) => (
    <section style={{ background: str(p.bgColor, "#1c1917") }}>
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-white">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{str(p.heading)}</h2>
        <p className="mt-2 text-sm text-white/60">{str(p.subheading)}</p>
        <div className="mx-auto mt-7 flex max-w-xl flex-col gap-3 rounded-2xl bg-white p-4 md:flex-row">
          <div className="flex-1 rounded-lg border border-stone-200 px-4 py-3 text-left">
            <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">
              Check-in
            </p>
            <p className="text-sm text-stone-800">Select date</p>
          </div>
          <div className="flex-1 rounded-lg border border-stone-200 px-4 py-3 text-left">
            <p className="font-mono text-[10px] uppercase tracking-widest text-stone-400">
              Check-out
            </p>
            <p className="text-sm text-stone-800">Select date</p>
          </div>
          <a
            href={str(p.buttonHref, "#")}
            className="flex items-center justify-center rounded-lg px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: str(p.accentColor, "#b45309") }}
          >
            {str(p.buttonLabel)}
          </a>
        </div>
      </div>
    </section>
  ),
};

const gallery: ComponentDef = {
  type: "gallery",
  label: "Gallery",
  icon: "Images",
  description: "Grid of photos for rooms, food or the property.",
  defaults: {
    heading: "Inside Pomah",
    img1: "",
    img2: "",
    img3: "",
    img4: "",
    img5: "",
    img6: "",
    bgColor: "#ffffff",
  },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "img1", label: "Image 1 URL", type: "image", group: "Images" },
    { key: "img2", label: "Image 2 URL", type: "image", group: "Images" },
    { key: "img3", label: "Image 3 URL", type: "image", group: "Images" },
    { key: "img4", label: "Image 4 URL", type: "image", group: "Images" },
    { key: "img5", label: "Image 5 URL", type: "image", group: "Images" },
    { key: "img6", label: "Image 6 URL", type: "image", group: "Images" },
    { key: "bgColor", label: "Background", type: "color", group: "Style" },
  ],
  render: (p) => {
    const imgs = ["img1", "img2", "img3", "img4", "img5", "img6"].map((k) => str(p[k]));
    return (
      <section style={{ background: str(p.bgColor, "#fff") }}>
        <div className="mx-auto max-w-6xl px-6 py-20">
          {str(p.heading) && (
            <h2 className="mb-8 text-center text-3xl font-semibold tracking-tight text-stone-900">
              {str(p.heading)}
            </h2>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {imgs.map((src, i) =>
              src ? (
                <img
                  key={i}
                  src={src}
                  alt={`Gallery ${i + 1}`}
                  className="aspect-square w-full rounded-xl object-cover"
                />
              ) : (
                <div
                  key={i}
                  className="flex aspect-square w-full items-center justify-center rounded-xl bg-stone-100 text-[10px] uppercase tracking-widest text-stone-400"
                >
                  Photo {i + 1}
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    );
  },
};

/* ------------------------------------------------------------------ */
/* Registry export                                                     */
/* ------------------------------------------------------------------ */

export const REGISTRY: Record<ComponentType, ComponentDef> = {
  hero,
  navbar,
  footer,
  cta,
  text,
  image,
  features,
  "room-card": roomCard,
  "booking-widget": bookingWidget,
  gallery,
};

/** Palette order — what the user sees in the "Add component" list. */
export const PALETTE: ComponentType[] = [
  "navbar",
  "hero",
  "features",
  "room-card",
  "gallery",
  "booking-widget",
  "cta",
  "text",
  "image",
  "footer",
];

/** Look up a component definition, or `undefined` for unknown types. */
export function getComponent(type: ComponentType): ComponentDef | undefined {
  return REGISTRY[type];
}
