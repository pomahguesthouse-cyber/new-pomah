/**
 * Component registry for the Visual Page Editor.
 *
 * Every editor element is declared once here: palette metadata, default
 * props, the editable `fields` (which auto-generate the property panel)
 * and a pure `render` function. Both the editor canvas and the public
 * render route consume this same registry — what you see in the editor
 * is exactly what ships.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/public/functions/public.functions";
import {
  Wifi,
  Coffee,
  ShowerHead,
  MapPin,
  Star,
  ShieldCheck,
  Sparkles,
  Heart,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ComponentDef, ElementType } from "./types";

/* ------------------------------------------------------------------ */
/* Prop helpers — read the free-form props bag with safe fallbacks      */
/* ------------------------------------------------------------------ */
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : v == null ? fallback : String(v);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
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

/* ================================================================== */
/* Basic elements                                                      */
/* ================================================================== */

const heading: ComponentDef = {
  type: "heading",
  label: "Heading",
  icon: "Heading",
  description: "A title with a selectable heading level.",
  category: "Basic",
  defaults: {
    text: "A heading that sets the scene",
    level: "h2",
    align: "left",
    color: "#1c1917",
  },
  fields: [
    { key: "text", label: "Text", type: "textarea", group: "Content" },
    {
      key: "level",
      label: "Level",
      type: "select",
      group: "Content",
      options: [
        { label: "H1 — page title", value: "h1" },
        { label: "H2 — section", value: "h2" },
        { label: "H3 — sub-section", value: "h3" },
      ],
    },
    { key: "align", label: "Alignment", type: "select", options: ALIGN_OPTIONS, group: "Layout" },
    { key: "color", label: "Text color", type: "color", group: "Style" },
  ],
  render: (p) => {
    const level = str(p.level, "h2");
    const Tag = (level === "h1" ? "h1" : level === "h3" ? "h3" : "h2") as "h1";
    const size =
      level === "h1"
        ? "text-4xl md:text-5xl"
        : level === "h3"
          ? "text-xl md:text-2xl"
          : "text-2xl md:text-3xl";
    return (
      <Tag
        className={`font-semibold tracking-tight ${size} ${
          ALIGN[str(p.align, "left")]?.split(" ")[0] ?? "text-left"
        }`}
        style={{ color: str(p.color, "#1c1917") }}
      >
        {str(p.text, "Heading")}
      </Tag>
    );
  },
};

const text: ComponentDef = {
  type: "text",
  label: "Text",
  icon: "Type",
  description: "A paragraph of editable copy.",
  category: "Basic",
  defaults: {
    content:
      "Write something meaningful here. This block is perfect for storytelling, descriptions or any longer-form copy your visitors should read.",
    align: "left",
    textColor: "#44403c",
  },
  fields: [
    { key: "content", label: "Content", type: "textarea", group: "Content" },
    { key: "align", label: "Alignment", type: "select", options: ALIGN_OPTIONS, group: "Layout" },
    { key: "textColor", label: "Text color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <p
      className={`text-base leading-relaxed ${
        ALIGN[str(p.align, "left")]?.split(" ")[0] ?? "text-left"
      }`}
      style={{ color: str(p.textColor, "#44403c") }}
    >
      {str(p.content)}
    </p>
  ),
};

const button: ComponentDef = {
  type: "button",
  label: "Button",
  icon: "MousePointerClick",
  description: "A call-to-action link styled as a button.",
  category: "Basic",
  defaults: {
    label: "Book a room",
    href: "/book",
    variant: "solid",
    align: "left",
    bgColor: "#0f766e",
    textColor: "#ffffff",
  },
  fields: [
    { key: "label", label: "Label", type: "text", group: "Content" },
    { key: "href", label: "Link URL", type: "text", group: "Content" },
    {
      key: "variant",
      label: "Style",
      type: "select",
      group: "Style",
      options: [
        { label: "Solid", value: "solid" },
        { label: "Outline", value: "outline" },
      ],
    },
    { key: "align", label: "Alignment", type: "select", options: ALIGN_OPTIONS, group: "Layout" },
    { key: "bgColor", label: "Accent color", type: "color", group: "Style" },
    { key: "textColor", label: "Label color", type: "color", group: "Style" },
  ],
  render: (p) => {
    const outline = str(p.variant, "solid") === "outline";
    const accent = str(p.bgColor, "#0f766e");
    return (
      <div className={ALIGN[str(p.align, "left")]?.split(" ")[1] ?? "items-start"}>
        <a
          href={str(p.href, "#")}
          className="inline-block rounded-lg px-6 py-3 text-sm font-medium transition hover:opacity-90"
          style={
            outline
              ? { border: `1.5px solid ${accent}`, color: accent }
              : { background: accent, color: str(p.textColor, "#ffffff") }
          }
        >
          {str(p.label, "Button")}
        </a>
      </div>
    );
  },
};

const image: ComponentDef = {
  type: "image",
  label: "Image",
  icon: "Image",
  description: "A single responsive image with optional caption.",
  category: "Media",
  defaults: { src: "", alt: "Image", caption: "", rounded: true },
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
  ],
  render: (p) => (
    <figure>
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
  ),
};

const spacer: ComponentDef = {
  type: "spacer",
  label: "Spacer",
  icon: "Minus",
  description: "Empty vertical space for fine-tuning rhythm.",
  category: "Layout",
  defaults: { height: 48 },
  fields: [{ key: "height", label: "Height (px)", type: "number", group: "Layout" }],
  render: (p) => <div style={{ height: num(p.height, 48) }} />,
};

/* ================================================================== */
/* Hero elements                                                       */
/* ================================================================== */

const hero: ComponentDef = {
  type: "hero",
  label: "Hero",
  icon: "LayoutTemplate",
  description: "Large headline block with call-to-action buttons.",
  category: "Hospitality",
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
    accentColor: "#0f766e",
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
      <div
        className="rounded-2xl"
        style={{ background: str(p.bgColor, "#fafaf9"), color: str(p.textColor, "#1c1917") }}
      >
        <div className={`flex flex-col gap-5 px-6 py-20 ${align}`}>
          {str(p.eyebrow) && (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.25em]"
              style={{ color: str(p.accentColor, "#0f766e") }}
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
                style={{ background: str(p.accentColor, "#0f766e") }}
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
      </div>
    );
  },
};

/** Internal stateful slider used by the hero-slider element. */
function HeroSliderView({
  slides,
  height,
  accent,
}: {
  slides: { img: string; heading: string; sub: string }[];
  height: number;
  accent: string;
}) {
  const [i, setI] = useState(0);
  const list = slides.length ? slides : [{ img: "", heading: "Slide", sub: "" }];
  const active = list[Math.min(i, list.length - 1)];
  const go = (d: number) => setI((v) => (v + d + list.length) % list.length);
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-stone-900 text-white"
      style={{ height }}
    >
      {active.img ? (
        <img
          src={active.img}
          alt={active.heading}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900" />
      )}
      <div className="absolute inset-0 bg-black/35" />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
        <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">{active.heading}</h2>
        {active.sub && <p className="max-w-lg text-sm opacity-80 md:text-base">{active.sub}</p>}
      </div>
      {list.length > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 hover:bg-white/35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => go(1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 hover:bg-white/35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {list.map((_, d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: d === i ? accent : "rgba(255,255,255,0.5)" }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const heroSlider: ComponentDef = {
  type: "hero-slider",
  label: "Hero Slider",
  icon: "GalleryHorizontal",
  description: "Rotating full-width banner with up to three slides.",
  category: "Hospitality",
  defaults: {
    height: 420,
    accentColor: "#0f766e",
    s1Img: "",
    s1Heading: "Welcome to your stay",
    s1Sub: "Comfortable rooms, warm hospitality.",
    s2Img: "",
    s2Heading: "Rooms for every traveller",
    s2Sub: "From solo trips to family getaways.",
    s3Img: "",
    s3Heading: "",
    s3Sub: "",
  },
  fields: [
    { key: "height", label: "Height (px)", type: "number", group: "Layout" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
    { key: "s1Img", label: "Slide 1 image", type: "image", group: "Slide 1" },
    { key: "s1Heading", label: "Slide 1 heading", type: "text", group: "Slide 1" },
    { key: "s1Sub", label: "Slide 1 subtext", type: "text", group: "Slide 1" },
    { key: "s2Img", label: "Slide 2 image", type: "image", group: "Slide 2" },
    { key: "s2Heading", label: "Slide 2 heading", type: "text", group: "Slide 2" },
    { key: "s2Sub", label: "Slide 2 subtext", type: "text", group: "Slide 2" },
    { key: "s3Img", label: "Slide 3 image", type: "image", group: "Slide 3" },
    { key: "s3Heading", label: "Slide 3 heading", type: "text", group: "Slide 3" },
    { key: "s3Sub", label: "Slide 3 subtext", type: "text", group: "Slide 3" },
  ],
  render: (p) => {
    const slides = [1, 2, 3]
      .map((n) => ({
        img: str(p[`s${n}Img`]),
        heading: str(p[`s${n}Heading`]),
        sub: str(p[`s${n}Sub`]),
      }))
      .filter((s) => s.heading || s.img);
    return (
      <HeroSliderView
        slides={slides}
        height={num(p.height, 420)}
        accent={str(p.accentColor, "#0f766e")}
      />
    );
  },
};

const datePicker: ComponentDef = {
  type: "date-picker",
  label: "Date Picker",
  icon: "CalendarCheck",
  description: "Check-in / check-out booking widget.",
  category: "Hospitality",
  defaults: {
    heading: "Check availability",
    subheading: "Pick your dates and reserve in seconds.",
    buttonLabel: "Check availability",
    buttonHref: "/book",
    accentColor: "#0f766e",
    bgColor: "#0f766e",
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
    <div
      className="rounded-2xl px-6 py-12 text-center"
      style={{ background: str(p.bgColor, "#0f766e") }}
    >
      <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
        {str(p.heading)}
      </h2>
      <p className="mt-2 text-sm text-white/70">{str(p.subheading)}</p>
      <div className="mx-auto mt-6 flex max-w-xl flex-col gap-3 rounded-2xl bg-white p-4 md:flex-row">
        <label className="flex-1 rounded-lg border border-stone-200 px-4 py-2.5 text-left">
          <span className="block font-mono text-[10px] uppercase tracking-widest text-stone-400">
            Check-in
          </span>
          <input type="date" className="w-full text-sm text-stone-800 outline-none" />
        </label>
        <label className="flex-1 rounded-lg border border-stone-200 px-4 py-2.5 text-left">
          <span className="block font-mono text-[10px] uppercase tracking-widest text-stone-400">
            Check-out
          </span>
          <input type="date" className="w-full text-sm text-stone-800 outline-none" />
        </label>
        <a
          href={str(p.buttonHref, "#")}
          className="flex items-center justify-center rounded-lg px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
          style={{ background: str(p.accentColor, "#0f766e") }}
        >
          {str(p.buttonLabel)}
        </a>
      </div>
    </div>
  ),
};

/* ================================================================== */
/* Hospitality + layout elements                                       */
/* ================================================================== */

const features: ComponentDef = {
  type: "features",
  label: "Features Grid",
  icon: "Grid3x3",
  description: "Three-up grid of icon features.",
  category: "Hospitality",
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
    accentColor: "#0f766e",
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
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => {
    const items = [
      { icon: str(p.f1Icon, "Wifi"), title: str(p.f1Title), desc: str(p.f1Desc) },
      { icon: str(p.f2Icon, "Coffee"), title: str(p.f2Title), desc: str(p.f2Desc) },
      { icon: str(p.f3Icon, "ShowerHead"), title: str(p.f3Title), desc: str(p.f3Desc) },
    ];
    return (
      <div>
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-stone-900">{str(p.heading)}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{str(p.subheading)}</p>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-stone-200 bg-white p-6 text-center">
              <div
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
                style={{ background: str(p.accentColor, "#0f766e") }}
              >
                <FeatureIcon name={it.icon} />
              </div>
              <h3 className="mt-4 font-semibold text-stone-900">{it.title}</h3>
              <p className="mt-1.5 text-sm text-stone-500">{it.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

const roomCard: ComponentDef = {
  type: "room-card",
  label: "Room Card",
  icon: "BedDouble",
  description: "Showcase one room with price and a booking link.",
  category: "Hospitality",
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
    accentColor: "#0f766e",
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
  ],
  render: (p) => (
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
            style={{ background: str(p.accentColor, "#0f766e") }}
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
          <p className="text-lg font-semibold" style={{ color: str(p.accentColor, "#0f766e") }}>
            {str(p.price)}
            <span className="ml-1 text-xs font-normal text-stone-400">{str(p.priceSuffix)}</span>
          </p>
          <a
            href={str(p.ctaHref, "#")}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            style={{ background: str(p.accentColor, "#0f766e") }}
          >
            {str(p.ctaLabel)}
          </a>
        </div>
      </div>
    </article>
  ),
};

const gallery: ComponentDef = {
  type: "gallery",
  label: "Gallery",
  icon: "Images",
  description: "Grid of photos for rooms, food or the property.",
  category: "Media",
  defaults: { heading: "Inside Pomah", img1: "", img2: "", img3: "", img4: "", img5: "", img6: "" },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "img1", label: "Image 1 URL", type: "image", group: "Images" },
    { key: "img2", label: "Image 2 URL", type: "image", group: "Images" },
    { key: "img3", label: "Image 3 URL", type: "image", group: "Images" },
    { key: "img4", label: "Image 4 URL", type: "image", group: "Images" },
    { key: "img5", label: "Image 5 URL", type: "image", group: "Images" },
    { key: "img6", label: "Image 6 URL", type: "image", group: "Images" },
  ],
  render: (p) => {
    const imgs = ["img1", "img2", "img3", "img4", "img5", "img6"].map((k) => str(p[k]));
    return (
      <div>
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
    );
  },
};

const cta: ComponentDef = {
  type: "cta",
  label: "Call to Action",
  icon: "Megaphone",
  description: "Focused banner that drives one action.",
  category: "Hospitality",
  defaults: {
    heading: "Ready to plan your stay?",
    text: "Book direct and get our best rate, confirmed on WhatsApp within hours.",
    buttonLabel: "Book now",
    buttonHref: "/book",
    bgColor: "#0f766e",
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
    <div
      className="rounded-2xl px-6 py-16 text-center"
      style={{ background: str(p.bgColor, "#0f766e"), color: str(p.textColor, "#fff") }}
    >
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
  ),
};

const navbar: ComponentDef = {
  type: "navbar",
  label: "Navbar",
  icon: "PanelTop",
  description: "Top navigation bar with brand and links.",
  category: "Layout",
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
    accentColor: "#0f766e",
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
      className="flex items-center justify-between rounded-xl border px-6 py-4"
      style={{ background: str(p.bgColor, "#fff"), color: str(p.textColor, "#1c1917") }}
    >
      <span className="font-serif text-lg font-semibold">{str(p.brand, "Brand")}</span>
      <div className="flex items-center gap-6 text-sm">
        {str(p.link1Label) && <a href={str(p.link1Href, "#")}>{str(p.link1Label)}</a>}
        {str(p.link2Label) && <a href={str(p.link2Href, "#")}>{str(p.link2Label)}</a>}
        {str(p.ctaLabel) && (
          <a
            href={str(p.ctaHref, "#")}
            className="rounded-lg px-4 py-2 text-xs font-medium text-white"
            style={{ background: str(p.accentColor, "#0f766e") }}
          >
            {str(p.ctaLabel)}
          </a>
        )}
      </div>
    </nav>
  ),
};

const footer: ComponentDef = {
  type: "footer",
  label: "Footer",
  icon: "PanelBottom",
  description: "Closing block with brand and copyright.",
  category: "Layout",
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
    <footer
      className="rounded-2xl px-6 py-12"
      style={{ background: str(p.bgColor, "#1c1917"), color: str(p.textColor, "#e7e5e4") }}
    >
      <p className="font-serif text-xl font-semibold">{str(p.brand, "Brand")}</p>
      <p className="mt-2 max-w-sm text-sm opacity-70">{str(p.tagline)}</p>
      <p className="mt-8 border-t border-white/10 pt-6 text-xs opacity-50">{str(p.copyright)}</p>
    </footer>
  ),
};

/* ================================================================== */
/* Dynamic elements — data pulled live from the database               */
/* ================================================================== */

/** Shape of a room type row returned by `getPublicSiteData`. */
interface RoomTypeRow {
  id: string;
  name: string;
  capacity?: number | null;
  size_sqm?: number | null;
  base_rate?: number | string | null;
  description?: string | null;
  hero_image_url?: string | null;
}

const rupiah = (v: unknown): string => {
  const n = Number(v);
  return Number.isFinite(n) ? `Rp ${n.toLocaleString("id-ID")}` : "";
};

/** One room card — shared by the grid and slider layouts. */
function RoomCardLive({
  room,
  accent,
  showPrice,
  ctaLabel,
  ctaHref,
}: {
  room: RoomTypeRow;
  accent: string;
  showPrice: boolean;
  ctaLabel: string;
  ctaHref: string;
}) {
  const meta = [
    room.capacity ? `${room.capacity} Tamu` : "",
    room.size_sqm ? `${room.size_sqm} m²` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl">
      <div className="aspect-[4/3] w-full overflow-hidden bg-stone-100">
        {room.hero_image_url ? (
          <img src={room.hero_image_url} alt={room.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-stone-400">
            Foto Kamar
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-stone-900">{room.name}</h3>
            {meta && (
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
                {meta}
              </p>
            )}
          </div>
          {showPrice && rupiah(room.base_rate) && (
            <div className="shrink-0 text-right">
              <p className="text-[10px] text-stone-400">Harga hari ini</p>
              <p className="text-lg font-bold" style={{ color: accent }}>
                {rupiah(room.base_rate)}
              </p>
            </div>
          )}
        </div>
        {room.description && (
          <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-500">
            {room.description}
          </p>
        )}
        <a
          href={ctaHref}
          className="mt-auto block rounded-lg py-2.5 text-center text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: accent, marginTop: room.description ? "1.25rem" : "auto" }}
        >
          {ctaLabel}
        </a>
      </div>
    </article>
  );
}

/** Live rooms element — fetches room types and lays them out. */
function RoomsView({
  heading,
  subheading,
  mode,
  columns,
  maxRooms,
  autoplayMs,
  animation,
  showPrice,
  ctaLabel,
  ctaHref,
  accent,
  emptyText,
}: {
  heading: string;
  subheading: string;
  mode: string;
  columns: number;
  maxRooms: number;
  autoplayMs: number;
  animation: string;
  showPrice: boolean;
  ctaLabel: string;
  ctaHref: string;
  accent: string;
  emptyText: string;
}) {
  const fetchData = useServerFn(getPublicSiteData);
  const { data, isLoading } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fetchData(),
  });
  const rooms = ((data?.roomTypes ?? []) as RoomTypeRow[]).slice(0, Math.max(1, maxRooms));

  const [index, setIndex] = useState(0);
  const slider = mode === "slider";
  const fade = animation === "fade";

  useEffect(() => {
    if (!slider || autoplayMs <= 0 || rooms.length < 2) return;
    const t = setInterval(() => setIndex((v) => (v + 1) % rooms.length), autoplayMs);
    return () => clearInterval(t);
  }, [slider, autoplayMs, rooms.length]);

  const header = (
    <div className="text-center">
      <h2 className="text-3xl font-semibold tracking-tight text-stone-900">{heading}</h2>
      {subheading && <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{subheading}</p>}
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <p className="mt-10 text-center text-sm text-stone-400">Memuat kamar…</p>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div>
        {header}
        <p className="mt-10 text-center text-sm text-stone-400">{emptyText}</p>
      </div>
    );
  }

  const card = (room: RoomTypeRow) => (
    <RoomCardLive
      room={room}
      accent={accent}
      showPrice={showPrice}
      ctaLabel={ctaLabel}
      ctaHref={ctaHref}
    />
  );

  if (!slider) {
    return (
      <div>
        {header}
        <div
          className="mt-10 grid gap-6"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))` }}
        >
          {rooms.map((r) => (
            <div key={r.id}>{card(r)}</div>
          ))}
        </div>
      </div>
    );
  }

  const safeIndex = index % rooms.length;
  return (
    <div>
      {header}
      <div className="relative mt-10">
        {fade ? (
          <div key={safeIndex} className="mx-auto max-w-md animate-in fade-in duration-700">
            {card(rooms[safeIndex])}
          </div>
        ) : (
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-500 ease-out"
              style={{ transform: `translateX(-${safeIndex * 100}%)` }}
            >
              {rooms.map((r) => (
                <div key={r.id} className="w-full shrink-0 px-2">
                  <div className="mx-auto max-w-md">{card(r)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {rooms.length > 1 && (
          <div className="mt-5 flex justify-center gap-1.5">
            {rooms.map((r, d) => (
              <button
                key={r.id}
                onClick={() => setIndex(d)}
                aria-label={`Kamar ${d + 1}`}
                className="h-2 w-2 rounded-full transition"
                style={{ background: d === safeIndex ? accent : "#d6d3d1" }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const rooms: ComponentDef = {
  type: "rooms",
  label: "Rooms (Live)",
  icon: "Hotel",
  description: "Room cards pulled live from the database — grid or slider.",
  category: "Hospitality",
  defaults: {
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
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "subheading", label: "Subheading", type: "textarea", group: "Content" },
    {
      key: "mode",
      label: "Layout",
      type: "select",
      group: "Layout",
      options: [
        { label: "Grid", value: "grid" },
        { label: "Slider", value: "slider" },
      ],
    },
    {
      key: "columns",
      label: "Grid columns",
      type: "select",
      group: "Layout",
      options: [
        { label: "2 columns", value: "2" },
        { label: "3 columns", value: "3" },
        { label: "4 columns", value: "4" },
      ],
      hint: "Used in Grid layout.",
    },
    {
      key: "maxRooms",
      label: "Max rooms shown",
      type: "number",
      group: "Layout",
    },
    {
      key: "animation",
      label: "Slider animation",
      type: "select",
      group: "Slider",
      options: [
        { label: "Slide", value: "slide" },
        { label: "Fade", value: "fade" },
      ],
    },
    {
      key: "autoplayMs",
      label: "Slider speed (ms)",
      type: "number",
      group: "Slider",
      hint: "Time between slides. Set 0 to disable autoplay.",
    },
    { key: "showPrice", label: "Show price", type: "boolean", group: "Card" },
    { key: "ctaLabel", label: "Button text", type: "text", group: "Card" },
    { key: "ctaHref", label: "Button URL", type: "text", group: "Card" },
    { key: "emptyText", label: "Empty message", type: "text", group: "Card" },
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <RoomsView
      heading={str(p.heading, "Our Accommodations")}
      subheading={str(p.subheading)}
      mode={str(p.mode, "grid")}
      columns={num(p.columns, 3)}
      maxRooms={num(p.maxRooms, 6)}
      autoplayMs={num(p.autoplayMs, 4000)}
      animation={str(p.animation, "slide")}
      showPrice={bool(p.showPrice, true)}
      ctaLabel={str(p.ctaLabel, "Pesan Kamar")}
      ctaHref={str(p.ctaHref, "/book")}
      accent={str(p.accentColor, "#0f766e")}
      emptyText={str(p.emptyText, "Belum ada kamar tersedia.")}
    />
  ),
};

/** Live location element — Google map + editable nearby-places list. */
function LocationView({
  heading,
  subheading,
  addressOverride,
  mapHeight,
  nearbyHeading,
  places,
  accent,
}: {
  heading: string;
  subheading: string;
  addressOverride: string;
  mapHeight: number;
  nearbyHeading: string;
  places: { name: string; type: string; distance: string; time: string }[];
  accent: string;
}) {
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const liveAddress = (data?.property as { address?: string | null } | undefined)?.address ?? "";
  const address = addressOverride || liveAddress || "Indonesia";
  const list = places.filter((p) => p.name);

  return (
    <div>
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-stone-900">{heading}</h2>
        {subheading && <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">{subheading}</p>}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-stone-200 shadow-sm">
          <iframe
            title={heading}
            src={`https://maps.google.com/maps?q=${encodeURIComponent(address)}&output=embed`}
            className="w-full"
            style={{ height: mapHeight }}
            loading="lazy"
          />
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-lg font-semibold" style={{ color: accent }}>
            <MapPin className="h-5 w-5" />
            {nearbyHeading}
          </p>
          <div className="mt-3 space-y-2">
            {list.length === 0 && (
              <p className="text-sm text-stone-400">Belum ada lokasi terdekat.</p>
            )}
            {list.map((p) => (
              <div
                key={p.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-stone-800">{p.name}</p>
                  {p.type && <p className="text-xs text-stone-400">{p.type}</p>}
                </div>
                <div className="text-right">
                  {p.distance && (
                    <p className="text-sm font-medium" style={{ color: accent }}>
                      {p.distance}
                    </p>
                  )}
                  {p.time && <p className="text-xs text-stone-400">{p.time}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const location: ComponentDef = {
  type: "location",
  label: "Location Map",
  icon: "MapPin",
  description: "Live Google map of the property plus a nearby-places list.",
  category: "Hospitality",
  defaults: {
    heading: "Lokasi Kami",
    subheading: "Temukan kami di lokasi strategis yang mudah diakses.",
    addressOverride: "",
    mapHeight: 320,
    nearbyHeading: "Lokasi Terdekat",
    accentColor: "#0f766e",
    p1Name: "Universitas",
    p1Type: "Kampus",
    p1Distance: "1.3 km",
    p1Time: "~5 menit",
    p2Name: "",
    p2Type: "",
    p2Distance: "",
    p2Time: "",
    p3Name: "",
    p3Type: "",
    p3Distance: "",
    p3Time: "",
    p4Name: "",
    p4Type: "",
    p4Distance: "",
    p4Time: "",
    p5Name: "",
    p5Type: "",
    p5Distance: "",
    p5Time: "",
    p6Name: "",
    p6Type: "",
    p6Distance: "",
    p6Time: "",
  },
  fields: [
    { key: "heading", label: "Heading", type: "text", group: "Content" },
    { key: "subheading", label: "Subheading", type: "textarea", group: "Content" },
    {
      key: "addressOverride",
      label: "Map address",
      type: "text",
      group: "Map",
      hint: "Leave empty to use the property address from Settings.",
    },
    { key: "mapHeight", label: "Map height (px)", type: "number", group: "Map" },
    { key: "nearbyHeading", label: "List heading", type: "text", group: "Nearby" },
    ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
      { key: `p${n}Name`, label: `Place ${n} name`, type: "text" as const, group: `Place ${n}` },
      { key: `p${n}Type`, label: `Place ${n} type`, type: "text" as const, group: `Place ${n}` },
      {
        key: `p${n}Distance`,
        label: `Place ${n} distance`,
        type: "text" as const,
        group: `Place ${n}`,
      },
      { key: `p${n}Time`, label: `Place ${n} time`, type: "text" as const, group: `Place ${n}` },
    ]),
    { key: "accentColor", label: "Accent color", type: "color", group: "Style" },
  ],
  render: (p) => (
    <LocationView
      heading={str(p.heading, "Lokasi Kami")}
      subheading={str(p.subheading)}
      addressOverride={str(p.addressOverride)}
      mapHeight={num(p.mapHeight, 320)}
      nearbyHeading={str(p.nearbyHeading, "Lokasi Terdekat")}
      accent={str(p.accentColor, "#0f766e")}
      places={[1, 2, 3, 4, 5, 6].map((n) => ({
        name: str(p[`p${n}Name`]),
        type: str(p[`p${n}Type`]),
        distance: str(p[`p${n}Distance`]),
        time: str(p[`p${n}Time`]),
      }))}
    />
  ),
};

/* ------------------------------------------------------------------ */
/* Registry export                                                     */
/* ------------------------------------------------------------------ */

export const REGISTRY: Record<ElementType, ComponentDef> = {
  heading,
  text,
  button,
  image,
  spacer,
  hero,
  "hero-slider": heroSlider,
  "date-picker": datePicker,
  features,
  rooms,
  "room-card": roomCard,
  location,
  gallery,
  cta,
  navbar,
  footer,
};

/** Palette order for the Elements panel. */
export const ELEMENT_PALETTE: ElementType[] = [
  "heading",
  "text",
  "button",
  "image",
  "spacer",
  "hero",
  "hero-slider",
  "date-picker",
  "features",
  "rooms",
  "room-card",
  "location",
  "gallery",
  "cta",
  "navbar",
  "footer",
];

/** Look up a component definition, or `undefined` for unknown types. */
export function getComponent(type: ElementType): ComponentDef | undefined {
  return REGISTRY[type];
}
