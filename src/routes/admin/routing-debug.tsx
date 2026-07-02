import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Route as Route3, Activity, ArrowRight, X } from "lucide-react";

import { ROUTING_MAP, AGENT_NAMES } from "@/ai/router/agent-router";
import { INTENT_CATEGORIES } from "@/ai/router/intent-categories";
import {
  getAgentRoutingStats,
  getIntentCallHistory,
} from "@/admin/functions/routing-debug.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/admin/routing-debug")({
  component: RoutingDebugPage,
});

function RoutingDebugPage() {
  const statsFn = useServerFn(getAgentRoutingStats);
  const historyFn = useServerFn(getIntentCallHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["routing-debug-stats"],
    queryFn: () => statsFn(),
  });

  const [selectedIntent, setSelectedIntent] = useState<string | null>(null);
  const historyQuery = useQuery({
    queryKey: ["routing-debug-history", selectedIntent],
    queryFn: () => historyFn({ data: { intent: selectedIntent!, limit: 20 } }),
    enabled: Boolean(selectedIntent),
  });


  // Gabungkan mapping statis dengan statistik pemanggilan aktual.
  const combined = useMemo(() => {
    const callsByIntent = new Map<string, { total: number; byAgent: Record<string, number> }>();
    for (const row of data?.rows ?? []) {
      const bucket = callsByIntent.get(row.intent) ?? { total: 0, byAgent: {} };
      bucket.total += row.count;
      bucket.byAgent[row.agent_key] = (bucket.byAgent[row.agent_key] ?? 0) + row.count;
      callsByIntent.set(row.intent, bucket);
    }

    const labelByKey = new Map(INTENT_CATEGORIES.map((c) => [c.key, c.label]));

    return INTENT_CATEGORIES.map((meta) => {
      const stats = callsByIntent.get(meta.key);
      return {
        intent: meta.key,
        label: labelByKey.get(meta.key) ?? meta.key,
        expectedAgent: ROUTING_MAP[meta.key],
        totalCalls: stats?.total ?? 0,
        byAgent: stats?.byAgent ?? {},
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls);
  }, [data]);

  // Baris "tak terpetakan": intent yang muncul di log tapi bukan bagian dari
  // enum IntentCategory (mis. intent bebas-teks dari orkestrator lama).
  const orphanRows = useMemo(() => {
    const known = new Set<string>(INTENT_CATEGORIES.map((c) => c.key));
    const map = new Map<string, { total: number; byAgent: Record<string, number> }>();
    for (const row of data?.rows ?? []) {
      if (known.has(row.intent)) continue;
      const bucket = map.get(row.intent) ?? { total: 0, byAgent: {} };
      bucket.total += row.count;
      bucket.byAgent[row.agent_key] = (bucket.byAgent[row.agent_key] ?? 0) + row.count;
      map.set(row.intent, bucket);
    }
    return Array.from(map.entries())
      .map(([intent, s]) => ({ intent, ...s }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Route3 className="h-5 w-5 text-teal-700" />
          Routing debug — Intent → Agent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tabel di bawah memperlihatkan pemetaan statis dari{" "}
          <code className="rounded bg-muted px-1">IntentCategory</code> ke{" "}
          <code className="rounded bg-muted px-1">AgentKey</code> di{" "}
          <code className="rounded bg-muted px-1">agent-router.ts</code>, digabung
          dengan jumlah pemanggilan nyata pada 30 hari terakhir. Berguna untuk
          memverifikasi apakah aturan routing benar-benar terpakai.
        </p>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Total pesan bot dianalisa:</span>
          <span className="font-semibold">
            {isLoading ? "…" : data?.totalMessages ?? 0}
          </span>
          <span className="text-muted-foreground">
            (jendela {data?.windowDays ?? 30} hari)
          </span>
        </div>
      </Card>

      <Card>
        <div className="border-b p-4">
          <h2 className="text-base font-semibold">Mapping resmi</h2>
          <p className="text-xs text-muted-foreground">
            {INTENT_CATEGORIES.length} kategori intent terdaftar.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Intent</TableHead>
              <TableHead>Agent (mapping)</TableHead>
              <TableHead className="text-right">Total panggilan</TableHead>
              <TableHead>Agent aktual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {combined.map((row) => {
              const actualAgents = Object.entries(row.byAgent).sort((a, b) => b[1] - a[1]);
              const mismatch =
                actualAgents.length > 0 &&
                actualAgents.some(
                  ([agent]) =>
                    agent !== row.expectedAgent &&
                    agent !== "front-office" &&
                    agent !== "fallback" &&
                    agent !== "quick-ack",
                );

              return (
                <TableRow
                  key={row.intent}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedIntent(row.intent)}
                >
                  <TableCell>
                    <div className="font-mono text-xs">{row.intent}</div>
                    <div className="text-[11px] text-muted-foreground">{row.label}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <Badge variant="outline">{AGENT_NAMES[row.expectedAgent]}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.totalCalls > 0 ? row.totalCalls : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {actualAgents.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {actualAgents.map(([agent, count]) => (
                          <Badge
                            key={agent}
                            variant={mismatch && agent !== row.expectedAgent ? "destructive" : "secondary"}
                            className="text-[11px]"
                          >
                            {agent} · {count}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {orphanRows.length > 0 && (
        <Card>
          <div className="border-b p-4">
            <h2 className="text-base font-semibold">Intent tak terpetakan</h2>
            <p className="text-xs text-muted-foreground">
              Muncul di log tapi bukan bagian dari enum{" "}
              <code>IntentCategory</code>. Biasanya sisa dari orkestrator lama
              atau intent bebas-teks LLM.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Intent (mentah)</TableHead>
                <TableHead className="text-right">Panggilan</TableHead>
                <TableHead>Agent aktual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orphanRows.map((row) => (
                <TableRow
                  key={row.intent}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedIntent(row.intent)}
                >
                  <TableCell className="font-mono text-xs">{row.intent}</TableCell>
                  <TableCell className="text-right font-mono">{row.total}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(row.byAgent)
                        .sort((a, b) => b[1] - a[1])
                        .map(([agent, count]) => (
                          <Badge key={agent} variant="secondary" className="text-[11px]">
                            {agent} · {count}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Sheet open={Boolean(selectedIntent)} onOpenChange={(open) => !open && setSelectedIntent(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selectedIntent}</span>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                onClick={() => setSelectedIntent(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </SheetTitle>
            <SheetDescription>
              20 pemanggilan terakhir (30 hari). Request = pesan tamu terakhir sebelum bot menjawab;
              Response = balasan bot yang terkirim.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {historyQuery.isLoading && (
              <div className="text-sm text-muted-foreground">Memuat riwayat…</div>
            )}
            {historyQuery.data?.items.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Tidak ada pemanggilan pada 30 hari terakhir.
              </div>
            )}
            {historyQuery.data?.items.map((item) => (
              <Card key={item.id} className="p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.agent || item.agentKey || "—"}</Badge>
                  {item.fastPath && <Badge variant="secondary">fast-path</Badge>}
                  {item.isFallback && <Badge variant="destructive">fallback</Badge>}
                  {item.toolsUsed.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      🔧 {t}
                    </Badge>
                  ))}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {item.sentAt ? new Date(item.sentAt).toLocaleString("id-ID") : "—"}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>📞 {item.phone ?? "—"}</span>
                  {item.latencyMs !== null && <span>⏱ {item.latencyMs}ms</span>}
                  {item.aiLatencyMs !== null && <span>🤖 {item.aiLatencyMs}ms</span>}
                  {item.routingConfidence !== null && (
                    <span>conf {(item.routingConfidence * 100).toFixed(0)}%</span>
                  )}
                </div>
                <div className="mb-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    Request (tamu)
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans">
                    {item.request ?? "(tidak ada pesan sebelumnya)"}
                  </pre>
                </div>
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    Response (bot)
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans">
                    {item.response}
                  </pre>
                </div>
              </Card>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
