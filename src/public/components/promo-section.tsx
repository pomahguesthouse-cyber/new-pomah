import { Link } from "@tanstack/react-router";
import { MessageCircle, Sparkles } from "lucide-react";
import { PROMOS, PROMO_TERMS_NOTE, promoWhatsAppHref } from "@/public/content/promos";

type PromoSectionProps = {
  whatsappNumber?: string | null;
  /** Versi ringkas untuk beranda: tiga promo + link ke /promo. */
  compact?: boolean;
  headingLevel?: "h1" | "h2";
};

export function PromoSection({ whatsappNumber, compact = false, headingLevel = "h2" }: PromoSectionProps) {
  const items = compact ? PROMOS.slice(0, 3) : PROMOS;
  const Heading = headingLevel;
  return (
    <section className="bg-[#f3ece0] px-4 py-14 sm:px-6 md:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center text-center">
          <Heading className="font-serif text-3xl font-bold tracking-tight text-stone-800 md:text-4xl">
            Promo menginap di Pomah
          </Heading>
          <span className="mt-3 h-1 w-16 rounded-full bg-amber-600" />
          <p className="mt-4 max-w-2xl text-sm text-stone-600">
            Penawaran spesial untuk tamu yang booking langsung. Tanyakan detailnya ke tim kami.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((promo) => {
            const waHref = promoWhatsAppHref(whatsappNumber, promo);
            return (
              <article
                key={promo.id}
                className="flex h-full flex-col rounded-2xl border border-stone-200 bg-white p-6 shadow-sm transition hover:shadow-xl"
              >
                <p className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-amber-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  {promo.rooms}
                </p>
                <h3 className="mt-2 font-serif text-xl font-semibold text-stone-900">{promo.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-stone-600">{promo.description}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {waHref && (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Tanya via WhatsApp
                    </a>
                  )}
                  <Link
                    to="/book"
                    className="inline-flex items-center justify-center rounded-full border border-amber-700 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-700 hover:text-white"
                  >
                    Cek ketersediaan
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-stone-500">{PROMO_TERMS_NOTE}</p>
        {compact && (
          <div className="mt-4 text-center">
            <Link to="/promo" className="text-sm font-semibold text-amber-800 underline-offset-4 hover:underline">
              Lihat semua promo
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
