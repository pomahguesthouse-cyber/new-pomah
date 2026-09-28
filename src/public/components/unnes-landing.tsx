import {
  Building2,
  CalendarDays,
  Car,
  Clock,
  GraduationCap,
  Home,
  MapPin,
  Users,
  Utensils,
  Wifi,
  Wind,
} from "lucide-react";
import { APPROVED_LP } from "@/public/content/approved-seo";
import { HeroSlider } from "@/public/components/public-shell";
import type { HomepageConfig } from "@/admin/modules/homepage/homepage.config";
import { buildStorageImageUrl } from "@/lib/storage-image";
import {
  unnesLandingGraph,
  type FaqItem,
  type SchemaReviews,
  type SchemaRoom,
} from "@/public/lib/structured-data";

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">{children}</h2>
      <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
    </div>
  );
}

const WHY_ICONS = [Users, GraduationCap, Home] as const;
const FACILITY_ICONS = [Wifi, Wind, Car, Utensils, Building2, Clock] as const;

type LandingRoom = SchemaRoom & { hero_image_url?: string | null };

function roomImage(href: string, rooms?: LandingRoom[] | null) {
  const slug = href.replace(/^\/rooms\//, "").replace(/\/$/, "");
  return rooms?.find((room) => room.slug === slug)?.hero_image_url ?? null;
}

/** Approved /lp/penginapan-dekat-unnes article. Replaces the section builder for this slug. */
export function UnnesLanding({
  rooms,
  property,
  reviews,
  hero,
  ctaHref = "/book",
  ctaText = "Pesan kamar",
}: {
  rooms?: LandingRoom[] | null;
  property?: {
    whatsapp_number?: string | null;
    email?: string | null;
    instagram_url?: string | null;
    tiktok_url?: string | null;
    facebook_url?: string | null;
    youtube_url?: string | null;
  } | null;
  reviews?: SchemaReviews | null;
  /** Homepage hero treatment. Slide headings are replaced by the approved H1. */
  hero?: HomepageConfig["hero"];
  ctaHref?: string;
  ctaText?: string;
}) {
  const page = APPROVED_LP;
  const graph = unnesLandingGraph({
    rooms,
    property,
    reviews,
    faqs: page.faq as FaqItem[],
  });
  const heroConfig: HomepageConfig["hero"] | null = hero
    ? {
        ...hero,
        accent: "",
        height: Math.max(hero.height || 0, 640),
        slides: (hero.slides.length
          ? hero.slides
          : [{ imageUrl: "", videoUrl: "", heading: page.h1, subheading: page.cardIntro }]
        ).map((slide) => ({
          ...slide,
          heading: page.h1,
          subheading: page.cardIntro,
        })),
      }
    : null;

  return (
    <>
      {heroConfig ? (
        <HeroSlider
          hero={heroConfig}
          fallbackTitle={page.h1}
          h1Text={page.h1}
          actions={
            <a
              href={ctaHref}
              className="inline-flex items-center gap-2 rounded-full bg-amber-700 px-7 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-amber-800"
            >
              <CalendarDays className="h-4 w-4" aria-hidden />
              {ctaText}
            </a>
          }
        />
      ) : (
        <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
          <h1 className="font-serif text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{page.h1}</h1>
          <p className="mt-4 text-lg leading-relaxed text-stone-600">{page.cardIntro}</p>
        </div>
      )}

      <main>
        <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 md:py-20">
          <p className="text-base leading-relaxed text-stone-500">{page.intro}</p>
        </section>

        <section className="bg-[#f3ece0] py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading>{page.why.heading}</SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
              {page.why.paragraphs.map((paragraph, index) => {
                const Icon = WHY_ICONS[index] ?? Users;
                return (
                  <article
                    key={paragraph.slice(0, 24)}
                    className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm"
                  >
                    <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-700 text-white shadow-sm">
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <p className="text-sm leading-relaxed text-stone-600 md:text-base">
                      <RichText text={paragraph} />
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="lokasi" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-16 sm:px-6 md:py-20">
          <SectionHeading>{page.distance.heading}</SectionHeading>
          <p className="mt-8 text-center text-base leading-relaxed text-stone-600">{page.distance.intro}</p>
          <ul className="mt-6 space-y-2">
            {page.distance.bullets.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 shadow-sm"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
                <span className="text-sm leading-relaxed text-stone-700 md:text-base">
                  <RichText text={item} />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center text-sm leading-relaxed text-stone-500 md:text-base">{page.distance.note}</p>
        </section>

        <section id="rooms" className="bg-[#f3ece0] py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading>{page.roomsHeading}</SectionHeading>
            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {page.rooms.map((room) => {
                const image = roomImage(room.href, rooms);
                return (
                  <article
                    key={room.href}
                    className="flex h-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-xl"
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-amber-50">
                      {image ? (
                        <img
                          src={buildStorageImageUrl(image, { width: 640, quality: 60 })}
                          width={640}
                          height={480}
                          alt={room.name}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center px-4 text-center font-serif text-lg text-amber-800/70">
                          {room.name}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-5 sm:p-6">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-medium text-stone-400">Kamar</p>
                          <h3 className="font-serif text-xl font-semibold text-stone-900">
                            <a href={room.href} className="transition hover:text-amber-800">
                              {room.name}
                            </a>
                          </h3>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[11px] font-medium text-stone-400">Harga mulai dari</p>
                          <p className="text-lg font-bold text-amber-700">{room.price}</p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-stone-100 pt-3 text-sm">
                        <div>
                          <dt className="text-[11px] font-medium text-stone-400">Kapasitas</dt>
                          <dd className="text-stone-700">{room.capacity}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-medium text-stone-400">Ukuran</dt>
                          <dd className="text-stone-700">{room.size}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                );
              })}
            </div>
            <ul className="mx-auto mt-8 max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-stone-600 md:text-base">
              {page.rooms.map((room) => (
                <li key={`${room.href}-note`}>
                  <a href={room.href} className="font-semibold text-amber-800 hover:underline">
                    {room.name}
                  </a>
                  : {room.note}
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-4 max-w-3xl text-sm leading-relaxed text-stone-600 md:text-base">
              Harga bisa berbeda di tanggal tertentu. Untuk harga pasti, pilih tanggal di{" "}
              <a href="/book" className="font-semibold text-amber-800 hover:underline">
                halaman pemesanan
              </a>
              .
            </p>
          </div>
        </section>

        <section id="facilities" className="scroll-mt-24 py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading>{page.facilities.heading}</SectionHeading>
            <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {page.facilities.bullets.map((item, index) => {
                const Icon = FACILITY_ICONS[index] ?? Wifi;
                return (
                  <li
                    key={item}
                    className="rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-sm"
                  >
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                      <Icon className="h-6 w-6" aria-hidden />
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-stone-700">{item}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="bg-[#f3ece0] py-16 md:py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHeading>{page.booking.heading}</SectionHeading>
            <ol className="mt-10 space-y-3">
              {page.booking.steps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-start gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-700 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <span className="pt-1 text-sm leading-relaxed text-stone-700 md:text-base">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-center text-sm leading-relaxed text-stone-500 md:text-base">{page.booking.note}</p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-20">
          <SectionHeading>{page.faqTitle}</SectionHeading>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />
          <dl className="mt-8 space-y-4">
            {page.faq.map((item) => (
              <div key={item.question} className="rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
                <dt className="font-semibold text-stone-900">{item.question}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-600 md:text-base">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6 md:pb-20">
          <SectionHeading>Lihat juga</SectionHeading>
          <ul className="mt-8 flex flex-wrap justify-center gap-2">
            {page.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-amber-800 shadow-sm transition hover:border-amber-300 hover:bg-amber-50"
                >
                  {link.anchor}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
