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

import { Card } from "@/components/ui/card";
import { formatIDR } from "@/lib/utils";

type TrendPoint = {
  label: string;
  bookings: number;
  revenue: number;
  occupancy: number;
  waIn: number;
  waOut: number;
};

/** Recharts-heavy part of the dashboard, split out so recharts is loaded on demand. */
export function DashboardCharts({ trend }: { trend: TrendPoint[] }) {
  const fmtMoney = (n: number) => formatIDR(n);
  return (
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Booking trend" subtitle="New bookings · last 30 days">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="gBookings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip content={<TooltipBox />} />
              <Area
                type="monotone"
                dataKey="bookings"
                stroke="hsl(var(--accent))"
                fill="url(#gBookings)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue trend" subtitle="Confirmed revenue · last 30 days">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <Tooltip content={<TooltipBox formatter={(v) => fmtMoney(Number(v))} />} />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Occupancy trend" subtitle="Daily occupancy %">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
                domain={[0, 100]}
                unit="%"
              />
              <Tooltip content={<TooltipBox formatter={(v) => `${v}%`} />} />
              <Line
                type="monotone"
                dataKey="occupancy"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="WhatsApp conversation flow" subtitle="Inbound vs outbound · 30d">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip content={<TooltipBox />} />
              <Bar dataKey="waIn" stackId="a" fill="hsl(var(--accent))" radius={[0, 0, 0, 0]} />
              <Bar
                dataKey="waOut"
                stackId="a"
                fill="hsl(var(--muted-foreground))"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>
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
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="capitalize">{p.name}</span>
          <span className="ml-auto font-mono">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}
