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
  Activity,
  Wallet,
  TrendingUp,
  Bot,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getDashboardOverview,
  getDashboardMetrics,
} from "@/lib/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateID, formatDateLongID } from "@/lib/utils";

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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_threads" },
        () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ai_conversation_logs" },
        () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queryClient]);

  if (overview.isLoading || !overview.data || metrics.isLoading || !metrics.data) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Loading the operations center…
      </div>
    );
  }

  const { kpis, arrivals, departures, recent, suggestions, threads } =
    overview.data;
  const { trend, summary, pendingPayments, pendingPaymentTotal } = metrics.data;

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

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

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Booking trend"
          subtitle="New bookings · last 30 days"
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gBookings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" allowDecimals={false} />
              <Tooltip content={<TooltipBox />} />
              <Area type="monotone" dataKey="bookings" stroke="hsl(var(--accent))" fill="url(#gBookings)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue trend" subtitle="Confirmed revenue · last 30 days">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <Tooltip content={<TooltipBox formatter={(v) => fmtMoney(Number(v))} />} />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Occupancy trend" subtitle="Daily occupancy %">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" domain={[0, 100]} unit="%" />
              <Tooltip content={<TooltipBox formatter={(v) => `${v}%`} />} />
              <Line type="monotone" dataKey="occupancy" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="WhatsApp conversation flow" subtitle="Inbound vs outbound · 30d">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
              <YAxis tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" allowDecimals={false} />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="waIn" stackId="a" fill="hsl(var(--accent))" radius={[0, 0, 0, 0]} />
              <Bar dataKey="waOut" stackId="a" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>

      {/* Operational widgets */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent bookings</h2>
            <Link to="/bookings" className="text-xs text-accent hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {recent.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">{b.guests?.full_name ?? "Guest"}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatDateID(b.check_in)} → {formatDateID(b.check_out)} · {b.room_types?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs">
                    {fmtMoney(Number(b.total_amount))}
                  </span>
                  <Badge variant="outline">{b.status}</Badge>
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No bookings yet.
              </p>
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
                {arrivals.length === 0 && (
                  <li className="text-muted-foreground">— none</li>
                )}
                {arrivals.map((a) => (
                  <li key={a.id}>
                    {a.guests?.full_name}{" "}
                    <span className="text-muted-foreground">· {a.room_types?.name}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Departures · {departures.length}
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {departures.length === 0 && (
                  <li className="text-muted-foreground">— none</li>
                )}
                {departures.map((d) => (
                  <li key={d.id}>
                    {d.guests?.full_name}{" "}
                    <span className="text-muted-foreground">· {d.room_types?.name}</span>
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
                <span className="font-mono text-xs">
                  {fmtMoney(Number(p.total_amount ?? 0))}
                </span>
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
              <Activity className="h-4 w-4 text-violet-500" /> AI activity
            </h2>
            <Link to="/ai" className="text-xs text-accent hover:underline">
              More →
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {suggestions.map((s) => (
              <li key={s.id} className="border-l-2 border-accent pl-3">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {s.body}
                </p>
              </li>
            ))}
            {suggestions.length === 0 && (
              <p className="text-sm text-muted-foreground">All clear.</p>
            )}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageCircle className="h-4 w-4 text-emerald-500" /> Recent
              conversations
            </h2>
            <Link to="/whatsapp" className="text-xs text-accent hover:underline">
              Open <ArrowRight className="ml-1 inline h-3 w-3" />
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {threads.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">
                No conversations yet.
              </li>
            )}
            {threads.map((t) => (
              <li key={t.id} className="flex items-start justify-between py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.display_name ?? "Guest"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.last_message_preview}
                  </p>
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
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">
        {value}
      </p>
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

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (v: number | string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="capitalize">{p.name}</span>
          <span className="ml-auto font-mono">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}
