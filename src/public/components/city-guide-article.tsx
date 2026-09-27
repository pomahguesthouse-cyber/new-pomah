import type { CityGuideArticle } from "@/public/content/approved-seo";
import { canonicalUrlForPath } from "@/public/lib/public-seo";
import { faqPageGraph } from "@/public/lib/structured-data";

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

/** Approved City Guide body: H2 sections, visible FAQ, and crawlable links. */
export function CityGuideArticleBody({ article }: { article: CityGuideArticle }) {
  const pageUrl = canonicalUrlForPath(`/explore/${article.canonicalSlug}`);
  return (
    <div className="mt-6 space-y-8 text-base leading-relaxed text-stone-700">
      {article.sections.map((section) => (
        <section key={section.heading}>
          <h2 className="text-xl font-bold text-stone-950">{section.heading}</h2>
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
    </div>
  );
}
