import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, BedDouble, MessageCircle, DollarSign, Sparkles, ArrowRight } from "lucide-react";
import { getDashboardOverview } from "@/lib/dashboard.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/")({
  component: DashboardPage,
});

function DashboardPage() {
  const fn = useServerFn(getDashboardOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fn(),
  });

  if (isLoading || !data) return <div className="p-10 text-sm text-muted-foreground">Loading the ledger…</div>;

  const { kpis, arrivals, departures, recent, suggestions, threads } = data;

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header className="flex items-end justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Today</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </h1>
        </div>
      </header>

      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        <Kpi label="Occupancy" value={`${kpis.occupancy}%`} sub={`${kpis.occupied}/${kpis.totalRooms} rooms`} icon={BedDouble} />
        <Kpi label="Bookings" value={String(kpis.totalBookings)} sub="all time" icon={CalendarDays} />
        <Kpi label="Revenue" value={`$${kpis.revenue.toFixed(0)}`} sub="all time" icon={DollarSign} />
        <Kpi label="WhatsApp" value={String(kpis.unread)} sub="unread messages" icon={MessageCircle} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent bookings</h2>
            <Link to="/admin/bookings" className="text-xs text-accent hover:underline">View all →</Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {recent.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">{b.guests?.full_name ?? "Guest"}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {b.check_in} → {b.check_out} · {b.room_types?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs">${Number(b.total_amount).toFixed(0)}</span>
                  <Badge variant="outline">{b.status}</Badge>
                </div>
              </div>
            ))}
            {recent.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No bookings yet.</p>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Today's flow</h2>
          <div className="mt-4 space-y-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Arrivals</p>
              <ul className="mt-1 space-y-1 text-sm">
                {arrivals.length === 0 && <li className="text-muted-foreground">— none</li>}
                {arrivals.map((a) => (
                  <li key={a.id}>{a.guests?.full_name} · <span className="text-muted-foreground">{a.room_types?.name}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Departures</p>
              <ul className="mt-1 space-y-1 text-sm">
                {departures.length === 0 && <li className="text-muted-foreground">— none</li>}
                {departures.map((d) => (
                  <li key={d.id}>{d.guests?.full_name} · <span className="text-muted-foreground">{d.room_types?.name}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-accent" /> AI Suggestions</h2>
            <Link to="/admin/ai" className="text-xs text-accent hover:underline">More →</Link>
          </div>
          <ul className="mt-4 space-y-3">
            {suggestions.map((s) => (
              <li key={s.id} className="border-l-2 border-accent pl-3">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.body}</p>
              </li>
            ))}
            {suggestions.length === 0 && <p className="text-sm text-muted-foreground">All clear.</p>}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4" /> Inbox</h2>
            <Link to="/admin/whatsapp" className="text-xs text-accent hover:underline">Open <ArrowRight className="ml-1 inline h-3 w-3" /></Link>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {threads.map((t) => (
              <li key={t.id} className="flex items-start justify-between py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.display_name ?? "Guest"}</p>
                  <p className="truncate text-xs text-muted-foreground">{t.last_message_preview}</p>
                </div>
                {t.unread_count > 0 && <Badge>{t.unread_count}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
