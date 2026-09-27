import { APPROVED_LP } from "@/public/content/approved-seo";
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

/** Approved /lp/penginapan-dekat-unnes article. Replaces the section builder for this slug. */
export function UnnesLanding() {
  const page = APPROVED_LP;
  const pageUrl = canonicalUrlForPath(`/lp/${page.slug}`);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-stone-800">
      <h1 className="font-serif text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{page.h1}</h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-600">{page.cardIntro}</p>
      <p className="mt-6 leading-relaxed">{page.intro}</p>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.why.heading}</h2>
        {page.why.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="mt-4 leading-relaxed">
            <RichText text={paragraph} />
          </p>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.distance.heading}</h2>
        <p className="mt-4 leading-relaxed">{page.distance.intro}</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          {page.distance.bullets.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed">{page.distance.note}</p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.roomsHeading}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-300 text-left">
                <th className="py-2 pr-3 font-semibold">Kamar</th>
                <th className="py-2 pr-3 font-semibold">Kapasitas</th>
                <th className="py-2 pr-3 font-semibold">Ukuran</th>
                <th className="py-2 font-semibold">Harga mulai dari</th>
              </tr>
            </thead>
            <tbody>
              {page.rooms.map((room) => (
                <tr key={room.href} className="border-b border-stone-200">
                  <td className="py-2 pr-3 font-semibold">
                    <a href={room.href} className="text-teal-800 hover:underline">
                      {room.name}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{room.capacity}</td>
                  <td className="py-2 pr-3">{room.size}</td>
                  <td className="py-2">{room.price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 list-disc space-y-2 pl-5 leading-relaxed">
          {page.rooms.map((room) => (
            <li key={`${room.href}-note`}>
              <a href={room.href} className="font-semibold text-teal-800 hover:underline">
                {room.name}
              </a>
              : {room.note}
            </li>
          ))}
        </ul>
        <p className="mt-4 leading-relaxed">
          Harga bisa berbeda di tanggal tertentu. Untuk harga pasti, pilih tanggal di{" "}
          <a href="/book" className="font-semibold text-teal-800 hover:underline">
            halaman pemesanan
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.facilities.heading}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
          {page.facilities.bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.booking.heading}</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 leading-relaxed">
          {page.booking.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 leading-relaxed">{page.booking.note}</p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">{page.faqTitle}</h2>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageGraph(pageUrl, page.faq)) }}
        />
        <dl className="mt-4 space-y-4">
          {page.faq.map((item) => (
            <div key={item.question}>
              <dt className="font-semibold text-stone-900">{item.question}</dt>
              <dd className="mt-1 leading-relaxed">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-stone-950">Lihat juga</h2>
        <ul className="mt-3 space-y-2 font-semibold">
          {page.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-teal-800 hover:underline">
                {link.anchor}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
