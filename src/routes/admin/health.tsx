import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, CheckCircle2, Clock, LifeBuoy } from "lucide-react";
import { getChatbotHealthSnapshot } from "@/admin/functions/health.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/health")({
  component: HealthPage,
});

function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function fmtMs(v: number | null) {
  if (v == null) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${v.toFixed(0)} ms`;
}

function HealthPage() {
  const fetchFn = useServerFn(getChatbotHealthSnapshot);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["chatbot-health"],
    queryFn: () => fetchFn(),
    refetchInterval: 60_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Health Chatbot</h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan 24 jam terakhir. Auto-refresh 60 detik.
          </p>
        </div>
      </header>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Memuat…</Card>}
      {isError && (
        <Card className="p-6 text-sm text-destructive">
          Gagal memuat: {(error as Error).message}
        </Card>
      )}

      {data && (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              label="Delivery Rate (24h)"
              value={fmtPct(data.delivery.rate)}
              sub={`${data.delivery.sent}/${data.delivery.total} sent`}
              tone={data.delivery.rate >= 0.9 ? "ok" : data.delivery.rate >= 0.75 ? "warn" : "bad"}
            />
            <KpiCard
              icon={<Clock className="w-4 h-4 text-sky-500" />}
              label="Latency p95"
              value={fmtMs(data.latency.p95Ms)}
              sub={`p50 ${fmtMs(data.latency.p50Ms)} · p99 ${fmtMs(data.latency.p99Ms)}`}
              tone={
                (data.latency.p95Ms ?? 0) <= 8000
                  ? "ok"
                  : (data.latency.p95Ms ?? 0) <= 15000
                    ? "warn"
                    : "bad"
              }
            />
            <KpiCard
              icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
              label="Zombie / Failed"
              value={`${data.queue.zombieCount} / ${data.queue.terminalFailures}`}
              sub={`${data.queue.pending} masih pending`}
              tone={data.queue.zombieCount === 0 && data.queue.terminalFailures < 5 ? "ok" : "warn"}
            />
            <KpiCard
              icon={<LifeBuoy className="w-4 h-4 text-rose-500" />}
              label="Open Handoff Tickets"
              value={String(data.openHandoffTickets)}
              sub="butuh perhatian admin"
              tone={data.openHandoffTickets === 0 ? "ok" : "warn"}
            />
          </section>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">Distribusi intent (1 jam terakhir)</h2>
            {data.intents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada pesan bot dengan metadata intent.</p>
            ) : (
              <ul className="divide-y">
                {data.intents.map((row) => (
                  <li key={row.intent} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="font-mono">{row.intent}</span>
                    <Badge variant="secondary">{row.count}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-muted-foreground">
            Snapshot: {new Date(data.generatedAt).toLocaleString("id-ID")}
          </p>
        </>
      )}
    </div>
  );
}

function KpiCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "ok" | "warn" | "bad";
}) {
  const border =
    props.tone === "ok"
      ? "border-emerald-500/30"
      : props.tone === "warn"
        ? "border-amber-500/40"
        : "border-rose-500/40";
  return (
    <Card className={`p-4 border ${border}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {props.icon}
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{props.value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{props.sub}</div>
    </Card>
  );
}
