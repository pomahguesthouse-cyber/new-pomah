import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { getAnalytics } from "@/modules/analytics/analytics.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const fn = useServerFn(getAnalytics);
  const { data } = useQuery({
    queryKey: ["analytics", 30],
    queryFn: () => fn({ data: { days: 30 } }),
  });

  if (!data) return <div className="p-10 text-sm text-muted-foreground">Crunching…</div>;

  const sourceData = Object.entries(data.sourceMix).map(([source, count]) => ({ source, count }));

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Analytics</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Last 30 days</h1>
      </header>

      <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
        <Kpi label="Revenue" value={`$${data.kpis.totalRevenue.toLocaleString()}`} />
        <Kpi label="ADR" value={`$${data.kpis.adr}`} sub="avg daily rate" />
        <Kpi label="RevPAR" value={`$${data.kpis.revpar}`} sub="per available room" />
        <Kpi label="Bookings" value={String(data.kpis.bookings)} />
      </section>

      <Card className="p-5">
        <h2 className="font-semibold">Occupancy %</h2>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer>
            <AreaChart data={data.series}>
              <defs>
                <linearGradient id="occ" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeOpacity={0.1} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Area type="monotone" dataKey="occupancy" stroke="hsl(var(--accent))" fill="url(#occ)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold">Daily revenue</h2>
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer>
              <BarChart data={data.series}>
                <CartesianGrid strokeOpacity={0.1} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="revenue" fill="hsl(var(--foreground))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Booking sources</h2>
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer>
              <BarChart data={sourceData}>
                <CartesianGrid strokeOpacity={0.1} />
                <XAxis dataKey="source" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
