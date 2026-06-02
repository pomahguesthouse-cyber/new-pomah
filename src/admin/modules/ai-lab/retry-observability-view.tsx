import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Activity,
  History,
  AlertTriangle,
  Cpu,
  Phone,
  Clock,
} from "lucide-react";
import { getRetryStats, getRetryLogs } from "./ai-lab.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Format date helper
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

function getAgentLabel(agentKey: string): string {
  const labels: Record<string, string> = {
    "front-office": "Front Office",
    pricing: "Pricing",
    "customer-care": "Customer Care",
    finance: "Finance",
    content: "Content Manager",
    manager: "Manager",
  };
  return labels[agentKey] ?? agentKey;
}

export function RetryObservabilityView() {
  const statsFn = useServerFn(getRetryStats);
  const logsFn = useServerFn(getRetryLogs);

  const { data: stats = [], isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["ai-retry-stats"],
    queryFn: () => statsFn(),
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["ai-retry-logs"],
    queryFn: () => logsFn(),
  });

  const [agentFilter, setAgentFilter] = React.useState("all");
  const [reasonFilter, setReasonFilter] = React.useState("all");
  const [resolvedFilter, setResolvedFilter] = React.useState("all");
  const [searchPhone, setSearchPhone] = React.useState("");

  const refreshAll = () => {
    refetchStats();
    refetchLogs();
  };

  // Filter logs locally
  const filteredLogs = logs.filter((log) => {
    if (agentFilter !== "all" && log.agent_key !== agentFilter) return false;
    if (reasonFilter !== "all" && log.reason !== reasonFilter) return false;
    if (resolvedFilter === "yes" && !log.resolved) return false;
    if (resolvedFilter === "no" && log.resolved) return false;
    if (searchPhone.trim() && !log.phone.includes(searchPhone.trim())) return false;
    return true;
  });

  // Unique reasons for filtering
  const uniqueReasons = Array.from(new Set(logs.map((l) => l.reason)));

  return (
    <div className="flex flex-col h-full bg-stone-100 overflow-y-auto p-6 md:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">AI Gateway & LLM Retry Audit</h2>
          <p className="text-muted-foreground text-sm">
            Pantau dan analisis kegagalan API, timeout 18 detik, status code HTTP (429/5xx), dan performa gateway LLM.
          </p>
        </div>
        <Button onClick={refreshAll} variant="outline" className="gap-2 shrink-0">
          <RefreshCw className={`h-4 w-4 ${statsLoading || logsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {/* STATS SUMMARY CARDS */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Retry Events</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{logs.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1">100 turn LLM terakhir</p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Resolved Retries</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 font-mono">
              {logs.filter(l => l.resolved).length}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {logs.length > 0 
                ? `${Math.round((logs.filter(l => l.resolved).length / logs.length) * 100)}% berhasil diselesaikan pada retry berikutnya`
                : "0%"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Unresolved Failures</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive font-mono">
              {logs.filter(l => !l.resolved).length}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Gagal total dan memerlukan intervensi staf</p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Average Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {logs.length > 0 
                ? `${Math.round(logs.reduce((acc, curr) => acc + (curr.latency_ms ?? 0), 0) / logs.length)} ms`
                : "—"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Rata-rata waktu tunggu response error</p>
          </CardContent>
        </Card>
      </div>

      {/* STATS ROLLUP VIEW */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Statistik Akumulasi (Hourly Rollup)</CardTitle>
          <CardDescription>Rollup data kegagalan LLM per jam dikelompokkan berdasarkan divisi agent dan alasan error.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-3">Jam (WIB)</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Penyebab / Status</th>
                  <th className="px-4 py-3 text-center">Total Percobaan</th>
                  <th className="px-4 py-3 text-center">Terselesaikan</th>
                  <th className="px-4 py-3 text-center">Rata-rata Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {statsLoading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading stats rollup...</td>
                  </tr>
                )}
                {!statsLoading && stats.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Tidak ada data rollup saat ini.</td>
                  </tr>
                )}
                {stats.slice(0, 15).map((stat, i) => (
                  <tr key={i} className="hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-mono text-xs tabular-nums">
                      {formatDateTime(stat.hour_wib)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="font-sans text-[11px]">
                        {getAgentLabel(stat.agent_key)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={
                        stat.reason === "timeout" 
                          ? "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"
                          : stat.reason.startsWith("http_5") 
                            ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-100"
                            : "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100"
                      }>
                        {stat.reason}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-center tabular-nums">{stat.total}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={stat.resolved_count === stat.total ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-100"}>
                        {stat.resolved_count} / {stat.total}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-center tabular-nums">{stat.avg_latency_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* DETAIL LOG LIST & FILTER BAR */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Audit Logs Detail</CardTitle>
          <CardDescription>Audit detail per event kegagalan LLM untuk pelacakan spesifik per thread/nomor telepon.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <div className="relative w-44">
              <Input
                placeholder="Cari No HP..."
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                className="h-9 font-mono text-xs"
              />
            </div>

            <Select value={agentFilter} onValueChange={setAgentFilter}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="Semua Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Agent</SelectItem>
                <SelectItem value="front-office">Front Office</SelectItem>
                <SelectItem value="pricing">Pricing</SelectItem>
                <SelectItem value="customer-care">Customer Care</SelectItem>
                <SelectItem value="finance">Finance</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
              </SelectContent>
            </Select>

            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="Semua Error" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Error</SelectItem>
                {uniqueReasons.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="yes">Resolved (Sukses Nanti)</SelectItem>
                <SelectItem value="no">Unresolved (Gagal)</SelectItem>
              </SelectContent>
            </Select>

            {(agentFilter !== "all" || reasonFilter !== "all" || resolvedFilter !== "all" || searchPhone) && (
              <Button variant="ghost" size="sm" onClick={() => {
                setAgentFilter("all");
                setReasonFilter("all");
                setResolvedFilter("all");
                setSearchPhone("");
              }} className="h-9 text-xs text-muted-foreground hover:text-foreground">
                Reset Filter
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-3">Waktu (WIB)</th>
                  <th className="px-4 py-3">Guest HP</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3 text-center">Attempt</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Penyebab</th>
                  <th className="px-4 py-3 text-right">Latency</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logsLoading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading details logs...</td>
                  </tr>
                )}
                {!logsLoading && filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Tidak ada logs yang cocok.</td>
                  </tr>
                )}
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/10 text-xs">
                    <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {log.phone}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="font-sans text-[10px]">
                        {getAgentLabel(log.agent_key)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-center tabular-nums">
                      Attempt {log.attempt}
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {log.model ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={
                        log.reason === "timeout" 
                          ? "bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"
                          : log.reason.startsWith("http_5") 
                            ? "bg-red-100 text-red-800 border-red-200 hover:bg-red-100"
                            : "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100"
                      }>
                        {log.reason}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-right tabular-nums text-muted-foreground">
                      {log.latency_ms !== null ? `${log.latency_ms} ms` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={
                        log.resolved 
                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                          : "bg-red-100 text-red-800 hover:bg-red-100"
                      }>
                        {log.resolved ? "Resolved" : "Failed"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
