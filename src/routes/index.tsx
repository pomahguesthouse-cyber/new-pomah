import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, MessageCircle, Sparkles } from "lucide-react";
import { getPublicSiteData } from "@/lib/public.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pomah Guesthouse — Boutique stays, AI-native hospitality" },
      {
        name: "description",
        content:
          "A small house run with great care. Book directly, message us on WhatsApp, and our AI front office answers in seconds.",
      },
      { property: "og:title", content: "Pomah Guesthouse" },
      {
        property: "og:description",
        content: "Boutique stays with AI-native hospitality.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const fetchData = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fetchData() });
  const property = data?.property;
  const rooms = data?.roomTypes ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNav />

      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Est. — A boutique guesthouse
          </p>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            {property?.tagline ?? "A quiet house, kept with care."}
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            {property?.description ??
              "Pomah is a small guesthouse where every detail is considered, every guest answered. Book directly. Message us on WhatsApp. Our AI front office never sleeps."}
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/book">
                Reserve a room <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/rooms">Browse rooms</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-px bg-border md:grid-cols-3">
          {[
            { icon: MessageCircle, title: "WhatsApp first", body: "Reach a real human (and our AI) on the channel guests already use." },
            { icon: Sparkles, title: "AI front office", body: "Drafts replies, surfaces insights, and never forgets a request." },
            { icon: ArrowRight, title: "Book direct", body: "No commissions. Better rates. A faster confirmation." },
          ].map((f) => (
            <div key={f.title} className="bg-background p-10">
              <f.icon className="h-5 w-5 text-accent" />
              <h3 className="mt-6 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              The Rooms
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">A small, considered selection</h2>
          </div>
          <Link to="/rooms" className="text-sm text-accent underline-offset-4 hover:underline">
            View all
          </Link>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {rooms.slice(0, 3).map((rt) => (
            <article key={rt.id} className="border border-border bg-card p-6">
              <div className="aspect-[4/3] w-full bg-muted" />
              <div className="mt-5 flex items-baseline justify-between">
                <h3 className="font-semibold">{rt.name}</h3>
                <span className="font-mono text-sm">${Number(rt.base_rate).toFixed(0)}/n</span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{rt.description}</p>
              <div className="mt-4">
                <Link to="/book" className="text-sm text-accent underline-offset-4 hover:underline">
                  Reserve →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <PublicFooter property={property} />
    </div>
  );
}

export function PublicNav() {
  return (
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="font-mono text-sm font-semibold tracking-tight">
          POMAH<span className="text-accent">.</span>
        </Link>
        <div className="flex items-center gap-6 text-sm">
          <Link to="/rooms" className="text-muted-foreground hover:text-foreground">Rooms</Link>
          <Link to="/book" className="text-muted-foreground hover:text-foreground">Book</Link>
          <Link to="/login" className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
            Staff
          </Link>
        </div>
      </div>
    </nav>
  );
}

export function PublicFooter({ property }: { property?: { name?: string; address?: string | null; whatsapp_number?: string | null; email?: string | null } | null }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-3">
        <div>
          <p className="font-mono text-sm font-semibold">POMAH<span className="text-accent">.</span></p>
          <p className="mt-2 text-sm text-muted-foreground">{property?.name ?? "Pomah Guesthouse"}</p>
        </div>
        <div className="text-sm text-muted-foreground">
          <p>{property?.address ?? ""}</p>
          <p className="mt-1">{property?.email}</p>
          <p>{property?.whatsapp_number}</p>
        </div>
        <div className="text-sm text-muted-foreground md:text-right">
          <p>© {new Date().getFullYear()} Pomah Guesthouse</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-widest">Curated Ledger</p>
        </div>
      </div>
    </footer>
  );
}
