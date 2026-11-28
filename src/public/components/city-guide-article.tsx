import type { ApprovedSection, CityGuideArticle } from "@/public/content/approved-seo";
import { Button } from "@/components/ui/button";
import { canonicalUrlForPath } from "@/public/lib/public-seo";
import { faqPageGraph } from "@/public/lib/structured-data";

const CITY_GUIDE_STAY_CTA_SLUGS = new Set(["lawang-sewu-semarang", "nasi-ayam-bu-wido"]);

/** Stay prompt for the two city guides that should send guests to /rooms. */
export function CityGuideStayCta() {
  return (
    <aside className="rounded-2xl border border-stone-200 bg-white p-6">
      <p className="text-sm leading-relaxed text-stone-600">
        Istirahat di Pomah, guest house keluarga di Sampangan. Cek kamar yang masih tersedia.
      </p>
      <Button asChild size="sm" className="mt-4 bg-amber-700 hover:bg-amber-800">
        <a href="/rooms">Cek kamar di Pomah</a>
      </Button>
    </aside>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
          return (
            <a key={index} href={link[2]} className="font-semibold text-emerald-800 hover:underline">
              {link[1]}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function SectionBody({ section }: { section: ApprovedSection }) {
  if (section.blocks && section.blocks.length > 0) {
    return (
      <>
        {section.blocks.map((block, index) =>
          block.type === "paragraph" ? (
            <p key={`${section.heading}-block-${index}`} className="mt-3">
              <RichText text={block.text} />
            </p>
          ) : (
            <ul key={`${section.heading}-block-${index}`} className="mt-3 list-disc space-y-2 pl-5">
              {block.items.map((item) => (
                <li key={item}>
                  <RichText text={item} />
                </li>
              ))}
            </ul>
          ),
        )}
      </>
    );
  }
  return (
    <>
      {section.paragraphs.map((paragraph, index) => (
        <p key={`${section.heading}-${index}`} className="mt-3">
          <RichText text={paragraph} />
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {section.bullets.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Approved City Guide body: H2 sections, visible FAQ, and crawlable links. */
export function CityGuideArticleBody({ article }: { article: CityGuideArticle }) {
  const pageUrl = canonicalUrlForPath(`/explore/${article.canonicalSlug}`);
  const showStayCta = CITY_GUIDE_STAY_CTA_SLUGS.has(article.canonicalSlug);
  return (
    <div className="mt-6 space-y-8 text-base leading-relaxed text-stone-700">
      {showStayCta ? <CityGuideStayCta /> : null}
      {article.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="text-xl font-bold text-stone-950">{section.heading}</h2>
          <SectionBody section={section} />
        </section>
      ))}
      {article.faq.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-stone-950">Pertanyaan yang sering ditanyakan</h2>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageGraph(pageUrl, article.faq)) }}
          />
          <dl className="mt-4 space-y-4">
            {article.faq.map((item) => (
              <div key={item.question}>
                <dt className="font-semibold text-stone-900">{item.question}</dt>
                <dd className="mt-1">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section>
        <h2 className="text-xl font-bold text-stone-950">Lihat juga</h2>
        <ul className="mt-3 space-y-2 text-sm font-semibold">
          <li>
            <a href="/" className="text-emerald-800 hover:underline">
              Pomah Guesthouse
            </a>
          </li>
          {article.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-emerald-800 hover:underline">
                {link.anchor}
              </a>
            </li>
          ))}
        </ul>
      </section>
      {showStayCta ? <CityGuideStayCta /> : null}
    </div>
  );
}
