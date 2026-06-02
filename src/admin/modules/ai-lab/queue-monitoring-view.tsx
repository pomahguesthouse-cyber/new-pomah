import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  RefreshCw,
  Clock,
  Cpu,
  Activity,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Search,
  Zap,
  Timer,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { getQueueMetricsStats, getQueueJobs } from "./ai-lab.functions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Helper to format ISO dates to WIB timezone
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

// Calculate percentile helper
function getPercentile(arr: number[], pct: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function QueueMonitoringView() {
  const statsFn = useServerFn(getQueueMetricsStats);
  const jobsFn = useServerFn(getQueueJobs);

  const { data: stats = [], isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["wa-queue-metrics-stats"],
    queryFn: () => statsFn(),
  });

  const { data: jobs = [], isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ["wa-queue-jobs"],
    queryFn: () => jobsFn(),
    refetchInterval: 10000, // Auto refresh every 10s
  });

  const [searchPhone, setSearchPhone] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");

  const refreshAll = () => {
    refetchStats();
    refetchJobs();
  };

  // Filter jobs locally
  const filteredJobs = jobs.filter((job) => {
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (searchPhone.trim() && !job.phone.includes(searchPhone.trim())) return false;
    return true;
  });

  // Calculate stats from the recent 100 jobs
  const completedJobs = jobs.filter(j => j.started_at && j.completed_at);
  const claimedJobs = jobs.filter(j => j.started_at);

  const queueLatencies = claimedJobs.map(j => {
    const start = new Date(j.started_at!).getTime();
    const created = new Date(j.created_at).getTime();
    return Math.max(0, (start - created) / 1000); // in seconds
  });

  const llmDurations = completedJobs.map(j => {
    const end = new Date(j.completed_at!).getTime();
    const start = new Date(j.started_at!).getTime();
    return Math.max(0, (end - start) / 1000); // in seconds
  });

  // Percentiles for summary cards
  const qLatencyP95 = getPercentile(queueLatencies, 95);
  const qLatencyP99 = getPercentile(queueLatencies, 99);
  const llmDurationP95 = getPercentile(llmDurations, 95);
  const llmDurationP99 = getPercentile(llmDurations, 99);

  // Zombie status counts from the recent jobs
  const activeZombieRetries = jobs.filter(
    j => j.status === "retrying" && j.last_error?.toLowerCase().includes("zombie")
  ).length;

  const totalZombiesEncountered = jobs.filter(
    j => j.last_error?.toLowerCase().includes("zombie")
  ).length;

  const staleMaxWaitExceeded = jobs.filter(
    j => j.last_error?.toLowerCase().includes("max_wait")
  ).length;

  // Prepare chart data (reverse chronological order)
  const chartData = React.useMemo(() => {
    return [...stats].reverse().map(s => ({
      time: new Date(s.hour_wib).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }),
      "Queue P95 (s)": Number(s.queue_latency_p95_sec.toFixed(1)),
      "Queue P99 (s)": Number(s.queue_latency_p99_sec.toFixed(1)),
      "LLM P95 (s)": Number(s.llm_duration_p95_sec.toFixed(1)),
      "LLM P99 (s)": Number(s.llm_duration_p99_sec.toFixed(1)),
      "Zombie Timeouts": s.zombie_timeouts,
    }));
  }, [stats]);

  return (
    <div className="flex flex-col h-full bg-stone-100 overflow-y-auto p-6 md:p-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-teal-600 animate-pulse" />
            Queue Latency & LLM Duration Observability
          </h2>
          <p className="text-muted-foreground text-sm">
            Pantau performa penjadwalan antrian pesan tamu dan waktu respons pemrosesan LLM (p95/p99) beserta audit kegagalan zombie lock.
          </p>
        </div>
        <Button onClick={refreshAll} variant="outline" className="gap-2 shrink-0">
          <RefreshCw className={`h-4 w-4 ${statsLoading || jobsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {/* SUMMARY STATS CARDS */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card shadow-sm border border-stone-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Latensi Antrian (P95 / P99)</CardTitle>
            <Clock className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-sky-600">
              {qLatencyP95.toFixed(1)}s <span className="text-xs font-normal text-muted-foreground">/ {qLatencyP99.toFixed(1)}s</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Waktu tunggu dari pesan masuk hingga mulai diproses</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border border-stone-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Durasi LLM / Run (P95 / P99)</CardTitle>
            <Cpu className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-violet-600">
              {llmDurationP95.toFixed(1)}s <span className="text-xs font-normal text-muted-foreground">/ {llmDurationP99.toFixed(1)}s</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Durasi eksekusi panggilan LLM dan database per pesan</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border border-stone-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Zombie Timeouts (Active / Total)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-amber-600">
              {activeZombieRetries} <span className="text-xs font-normal text-muted-foreground">retrying / {totalZombiesEncountered} total</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Worker lock expired yang dipicu kegagalan transient/timeout</p>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border border-stone-200">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Stale Max Wait Exceeded</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive">
              {staleMaxWaitExceeded}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Antrian yang melewati batas tunggu maksimal tanpa pernah terproses</p>
          </CardContent>
        </Card>
      </div>

      {/* GRAPH CHART SECTION */}
      <Card className="border border-stone-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Timer className="h-5 w-5 text-teal-600" />
            Tren Latensi & Durasi Pemrosesan (P95 & P99)
          </CardTitle>
          <CardDescription>Visualisasi performa antrian pesan dan durasi eksekusi LLM jam demi jam (WIB).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full mt-2">
            {statsLoading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Loading latency charts...
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Belum ada data statistik antrian dalam 7 hari terakhir.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E2E2" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#888888" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#888888" label={{ value: 'detik', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10 } }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.95)",
                      borderRadius: "8px",
                      border: "1px solid #E2E2E2",
                      fontSize: "11px",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: "11px", marginTop: "10px" }} />
                  <Line type="monotone" dataKey="Queue P95 (s)" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Queue P99 (s)" stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                  <Line type="monotone" dataKey="LLM P95 (s)" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="LLM P99 (s)" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
                  <Line type="monotone" dataKey="Zombie Timeouts" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* RECENT QUEUE JOBS TABLE */}
      <Card className="border border-stone-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Daftar Antrian Percakapan Terbaru (Recent Jobs)</CardTitle>
          <CardDescription>
            Menampilkan status, jumlah pesan dalam burst, latensi antrian, durasi eksekusi, serta log error untuk 100 antrian terakhir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters Bar */}
          <div className="flex flex-wrap gap-3 mb-4 items-center">
            <div className="relative w-44">
              <Input
                placeholder="Cari No HP..."
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                className="h-9 font-mono text-xs border-stone-200 bg-white"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-44 text-xs border-stone-200 bg-white">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="sent">Sent (Sukses)</SelectItem>
                <SelectItem value="processing">Processing (Berjalan)</SelectItem>
                <SelectItem value="waiting">Waiting (Debounce)</SelectItem>
                <SelectItem value="pending">Pending (Mengantri)</SelectItem>
                <SelectItem value="retrying">Retrying (Mencoba Ulang)</SelectItem>
                <SelectItem value="failed">Failed (Gagal)</SelectItem>
              </SelectContent>
            </Select>

            {(statusFilter !== "all" || searchPhone) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter("all");
                  setSearchPhone("");
                }}
                className="h-9 text-xs text-muted-foreground hover:text-foreground"
              >
                Reset Filter
              </Button>
            )}
          </div>

          <div className="overflow-x-auto border border-stone-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr className="text-left">
                  <th className="px-4 py-3">Waktu Dibuat</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-center">Burst</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Latensi Antrian</th>
                  <th className="px-4 py-3 text-right">Durasi LLM</th>
                  <th className="px-4 py-3 text-center">Attempt</th>
                  <th className="px-4 py-3">Detail Logs / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 bg-white">
                {jobsLoading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Loading queue jobs list...
                    </td>
                  </tr>
                )}
                {!jobsLoading && filteredJobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Tidak ada data antrian yang cocok.
                    </td>
                  </tr>
                )}
                {filteredJobs.map((job) => {
                  // Calculate Wait Time (Latency)
                  let waitTimeStr = "—";
                  if (job.started_at) {
                    const diff = (new Date(job.started_at).getTime() - new Date(job.created_at).getTime()) / 1000;
                    waitTimeStr = `${diff.toFixed(1)}s`;
                  } else if (job.status === "pending" || job.status === "waiting") {
                    const diff = (Date.now() - new Date(job.created_at).getTime()) / 1000;
                    waitTimeStr = `${diff.toFixed(1)}s (active)`;
                  }

                  // Calculate LLM/Run processing duration
                  let durationStr = "—";
                  if (job.started_at && job.completed_at) {
                    const diff = (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000;
                    durationStr = `${diff.toFixed(1)}s`;
                  } else if (job.status === "processing" && job.started_at) {
                    const diff = (Date.now() - new Date(job.started_at).getTime()) / 1000;
                    durationStr = `${diff.toFixed(1)}s (running)`;
                  }

                  const isZombie = job.last_error?.toLowerCase().includes("zombie_timeout");
                  const isMaxWait = job.last_error?.toLowerCase().includes("max_wait");

                  return (
                    <tr key={job.id} className={`hover:bg-stone-50/50 text-xs ${isZombie ? "bg-amber-50/20" : ""}`}>
                      <td className="px-4 py-3 font-mono tabular-nums text-muted-foreground whitespace-nowrap">
                        {formatDateTime(job.created_at)}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                        {job.phone}
                      </td>
                      <td className="px-4 py-3 font-mono text-center tabular-nums">
                        {job.message_count} msg
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge
                          className={
                            job.status === "sent"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                              : job.status === "failed"
                                ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-50"
                                : job.status === "processing"
                                  ? "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-50"
                                  : job.status === "retrying"
                                    ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50"
                                    : "bg-stone-100 text-stone-600 hover:bg-stone-100"
                          }
                          variant="outline"
                        >
                          {job.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-right tabular-nums font-medium text-sky-600 whitespace-nowrap">
                        {waitTimeStr}
                      </td>
                      <td className="px-4 py-3 font-mono text-right tabular-nums font-medium text-violet-600 whitespace-nowrap">
                        {durationStr}
                      </td>
                      <td className="px-4 py-3 font-mono text-center tabular-nums">
                        {job.attempt} / 3
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate">
                        {isZombie && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 mr-2">
                            <Zap className="h-3 w-3" />
                            zombie_timeout
                          </span>
                        )}
                        {isMaxWait && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 rounded-full px-2 py-0.5 mr-2">
                            <AlertCircle className="h-3 w-3" />
                            max_wait_exceeded
                          </span>
                        )}
                        <span className="text-muted-foreground font-mono text-[11px]" title={job.last_error || job.reply_text || ""}>
                          {job.last_error || job.reply_text || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
