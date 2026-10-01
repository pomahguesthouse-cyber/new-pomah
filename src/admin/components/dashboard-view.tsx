import * as React from "react";
import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  BedDouble,
  MessageCircle,
  DollarSign,
  Sparkles,
  ArrowRight,
  Wallet,
  TrendingUp,
  Bot,
} from "lucide-react";

import { getDashboardOverview, getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateID, formatDateLongID, formatIDR } from "@/lib/utils";

const DashboardCharts = React.lazy(() =>
  import("@/admin/components/dashboard-charts").then((m) => ({ default: m.DashboardCharts })),
);

function ChartsSkeleton() {
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-48" />
          <Skeleton className="mt-4 h-[220px] w-full" />
        </Card>
      ))}
    </section>
  );
}

export function DashboardView() {
  const queryClient = useQueryClient();
  const overviewFn = useServerFn(getDashboardOverview);
  const metricsFn = useServerFn(getDashboardMetrics);

  const overview = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => overviewFn(),
  });
  const metrics = useQuery({
    queryKey: ["dashboard", "metrics"],
    queryFn: () => metricsFn(),
    refetchInterval: 60_000,
  });

  // Realtime invalidation: bookings + WhatsApp + AI logs
  useEffect(() => {
    const ch = supabase
      .channel("dashboard-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_threads" }, () =>
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () =>
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_conversation_logs" }, () =>
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queryClient]);

  if (overview.isLoading || !overview.data || metrics.isLoading || !metrics.data) {
    return <div className="p-10 text-sm text-muted-foreground">Loading the operations center…</div>;
  }

  const { kpis, arrivals, departures, recent, threads } = overview.data;
  const { trend, summary, pendingPayments, pendingPaymentTotal } = metrics.data;

  const fmtMoney = (n: number) => formatIDR(n);

  return (
    <div className="space-y-8 p-6 md:p-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Operations Center · Today
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {formatDateLongID(new Date())}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Realtime · synced
          </span>
        </div>
      </header>

      {/* KPI strip */}
      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Occupancy"
          value={`${kpis.occupancy}%`}
          sub={`${summary.occupiedToday}/${summary.totalRooms} rooms today`}
          icon={BedDouble}
        />
        <Kpi
          label="Bookings · 30d"
          value={String(summary.bookings30d)}
          sub={`${kpis.totalBookings} all time`}
          icon={CalendarDays}
        />
        <Kpi
          label="Revenue · 30d"
          value={fmtMoney(summary.revenue30d)}
          sub={`${fmtMoney(kpis.revenue)} total`}
          icon={DollarSign}
        />
        <Kpi
          label="Pending payments"
          value={fmtMoney(pendingPaymentTotal)}
          sub={`${pendingPayments.length} awaiting`}
          icon={Wallet}
        />
      </section>

      {/* AI + WhatsApp activity */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MiniStat
          label="AI activity · 30d"
          value={String(summary.aiTotal30d)}
          sub={`${summary.aiAdoptionPct}% used by staff`}
          icon={Bot}
          accent="text-violet-500"
        />
        <MiniStat
          label="AI adoption"
          value={`${summary.aiAdoptionPct}%`}
          sub={`${summary.aiUsed30d} accepted suggestions`}
          icon={Sparkles}
          accent="text-amber-500"
        />
        <MiniStat
          label="WhatsApp · 30d"
          value={String(summary.waIn30d + summary.waOut30d)}
          sub={`${summary.waIn30d} in · ${summary.waOut30d} out`}
          icon={MessageCircle}
          accent="text-emerald-500"
        />
        <MiniStat
          label="WA → booking"
          value={`${summary.waConversionPct}%`}
          sub={`${summary.waThreads} threads tracked`}
          icon={TrendingUp}
          accent="text-sky-500"
        />
      </section>

      {/* Charts — recharts loads lazily so the dashboard shell paints first */}
      <React.Suspense fallback={<ChartsSkeleton />}>
        <DashboardCharts trend={trend} />
      </React.Suspense>

      {/* Operational widgets */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent bookings</h2>
            <Link to="/admin/bookings" className="text-xs text-accent hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {recent.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">{b.guests?.full_name ?? "Guest"}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatDateID(b.check_in)} → {formatDateID(b.check_out)} · {b.rooms_label}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs">{fmtMoney(Number(b.total_amount))}</span>
                  <Badge variant="outline">{b.status}</Badge>
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No bookings yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Today's flow</h2>
          <div className="mt-4 space-y-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Arrivals · {arrivals.length}
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {arrivals.length === 0 && <li className="text-muted-foreground">— none</li>}
                {arrivals.map((a) => (
                  <li key={a.id}>
                    {a.guests?.full_name}{" "}
                    <span className="text-muted-foreground">· {a.rooms_label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Departures · {departures.length}
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {departures.length === 0 && <li className="text-muted-foreground">— none</li>}
                {departures.map((d) => (
                  <li key={d.id}>
                    {d.guests?.full_name}{" "}
                    <span className="text-muted-foreground">· {d.rooms_label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Room availability
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {summary.availableToday}
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / {summary.totalRooms} free
                </span>
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Wallet className="h-4 w-4 text-amber-500" /> Pending payments
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              {fmtMoney(pendingPaymentTotal)}
            </span>
          </div>
          <ul className="mt-4 space-y-2">
            {pendingPayments.length === 0 && (
              <li className="text-sm text-muted-foreground">All settled.</li>
            )}
            {pendingPayments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="truncate">{p.guests?.full_name ?? "Guest"}</span>
                <span className="font-mono text-xs">{fmtMoney(Number(p.total_amount ?? 0))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Payments module · coming soon
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageCircle className="h-4 w-4 text-emerald-500" /> Recent conversations
            </h2>
            <Link to="/admin/whatsapp" className="text-xs text-accent hover:underline">
              Open <ArrowRight className="ml-1 inline h-3 w-3" />
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {threads.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">No conversations yet.</li>
            )}
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
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </Card>
  );
}
