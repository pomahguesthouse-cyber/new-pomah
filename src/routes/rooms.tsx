import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/lib/public.functions";
import { PublicNav, PublicFooter } from "./index";
import { isAdminHost } from "@/lib/host";
import { AdminShell } from "@/components/admin/admin-shell";
import { RoomsManageView } from "@/components/admin/rooms-manage-view";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/rooms")({
  head: () => ({
    meta: [
      { title: "Rooms — Pomah Guesthouse" },
      { name: "description", content: "Browse the rooms at Pomah Guesthouse — small, calm, and considered." },
      { property: "og:title", content: "Rooms — Pomah Guesthouse" },
    ],
  }),
  component: RoomsRoute,
});

function RoomsRoute() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isAdmin = isAdminHost(window.location.hostname);
    if (!isAdmin) {
      setAdmin(false);
      return;
    }
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        navigate({ to: "/login" });
        return;
      }
      setAdmin(true);
    });
  }, [navigate]);

  if (admin === null) return null;
  if (admin) {
    return (
      <AdminShell>
        <RoomsManageView />
      </AdminShell>
    );
  }
  return <PublicRooms />;
}

function PublicRooms() {
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fn() });
  const rooms = data?.roomTypes ?? [];


  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">The Rooms</p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight">A small, considered selection</h1>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-px bg-border md:grid-cols-2">
          {rooms.map((rt) => (
            <article key={rt.id} className="bg-card p-8">
              <div className="aspect-[4/3] w-full bg-muted" />
              <div className="mt-6 flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">{rt.name}</h2>
                <span className="font-mono text-sm">${Number(rt.base_rate).toFixed(0)}/night</span>
              </div>
              <p className="mt-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {rt.bed_type} · sleeps {rt.capacity} · {rt.size_sqm}m²
              </p>
              <p className="mt-4 text-sm text-muted-foreground">{rt.description}</p>
              {rt.amenities && rt.amenities.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {rt.amenities.map((a) => (
                    <li key={a} className="border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {a}
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/book" className="mt-6 inline-block text-sm text-accent underline-offset-4 hover:underline">
                Reserve →
              </Link>
            </article>
          ))}
        </div>
      </section>
      <PublicFooter property={data?.property} />
    </div>
  );
}
