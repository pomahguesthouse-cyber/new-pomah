import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  CalendarCheck,
  Clock,
  Database,
  Gauge,
  GitBranch,
  Headphones,
  Inbox,
  LifeBuoy,
  MessageCircle,
  LogOut,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import { getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import { getChatbotHealthSnapshot } from "@/admin/functions/health.functions";
import { getAgentRoutingStats } from "@/admin/functions/routing-debug.functions";
import {
  getAiLabConfig,
  getQueueMetricsStats,
  getRetryStats,
  mergeAiLabConfig,
  updateAiLabConfig,
  type AiLabConfig,
} from "@/admin/modules/ai-lab/ai-lab.functions";
import {
  getAiLabAuditTrail,
  getAiLabControlSnapshot,
  getAgentQualityScores,
  previewTrainingRagMatches,
  type AgentQualityScore,
  type AiLabControlSnapshot,
  type RagPreviewRow,
} from "@/admin/modules/ai-lab/ai-lab-control.functions";
import { ChatSimulatorView } from "@/admin/modules/ai-lab/chat-simulator-view";
import { IntentRulesView } from "@/admin/modules/ai-lab/intent-rules-view";
import { QueueMonitoringView } from "@/admin/modules/ai-lab/queue-monitoring-view";
import { RetryObservabilityView } from "@/admin/modules/ai-lab/retry-observability-view";
import { SmartDelaySettings } from "@/admin/modules/ai-lab/smart-delay-settings";
import { SopKnowledgeView } from "@/admin/modules/ai-lab/sop-knowledge-view";
import { TrainingRagSettings } from "@/admin/modules/ai-lab/training-rag-settings";
import { WhatsappCorrectionsPage } from "@/admin/modules/training/whatsapp-corrections-live-page";
import { HealthPage } from "@/routes/admin/health";
import { RoutingDebugPage } from "@/routes/admin/routing-debug";
import { TelegramPage } from "@/routes/admin/telegram";
import { TrainingPage } from "@/routes/admin/training";
import { WhatsAppPage } from "@/routes/admin/whatsapp";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/ai-lab")({
  component: AiLab,
});

type DrawerKey =
  | "training"
  | "knowledge"
  | "telegram"
  | "health"
  | "routing"
  | "settings"
  | "inbox"
  | "queue"
  | "retry"
  | "simulator"
  | "audit"
  | null;

type Tone = "green" | "blue" | "violet" | "amber" | "rose" | "cyan" | "slate";

type FlowKind = "trigger" | "system" | "ai" | "agent" | "tool" | "output" | "manual";

interface AgentMeta {
  key: string;
  name: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  safeAuto: boolean;
}

interface FlowNodeMeta {
  id: string;
  title: string;
  desc: string;
  x: number;
  y: number;
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  drawer?: Exclude<DrawerKey, null>;
  kind: FlowKind;
}

interface FlowEdgeMeta {
  from: string;
  to: string;
  label?: string;
  tone?: Tone;
}

interface FlowRuntime {
  label: string;
  detail: string;
  tone: Tone;
  pulse?: boolean;
}

interface AiFlowNodeData extends Record<string, unknown> {
  meta: FlowNodeMeta;
  runtime: FlowRuntime;
}

const AGENTS: AgentMeta[] = [
  { key: "front-office", name: "Front Office", desc: "Booking, availability, FAQ", icon: Users, safeAuto: true },
  { key: "pricing", name: "Pricing", desc: "Harga, promo, paket", icon: Wallet, safeAuto: true },
  { key: "customer-care", name: "Customer Care", desc: "Keluhan dan layanan", icon: Headphones, safeAuto: false },
  { key: "finance", name: "Finance", desc: "Pembayaran dan bukti transfer", icon: Bell, safeAuto: false },
  { key: "manager", name: "Manager", desc: "Eskalasi dan instruksi admin", icon: ShieldAlert, safeAuto: false },
  { key: "content", name: "Content", desc: "SEO dan city guide", icon: Sparkles, safeAuto: false },
];

const TOOLS = [
  { key: "pms-database", name: "PMS Database", icon: Database },
  { key: "room-availability", name: "Room Availability", icon: CalendarCheck },
  { key: "sop-knowledge", name: "SOP Knowledge", icon: BookOpen },
  { key: "pricing-engine", name: "Pricing Engine", icon: BarChart3 },
  { key: "faq-memory", name: "FAQ Memory", icon: Brain },
];

const FLOW_NODES: FlowNodeMeta[] = [
  { id: "incoming", title: "Incoming WA", desc: "Evolution webhook", x: 0, y: 240, icon: MessageCircle, tone: "green", drawer: "inbox", kind: "trigger" },
  { id: "parser", title: "Parser", desc: "Normalize phone + dedup", x: 230, y: 135, icon: GitBranch, tone: "cyan", kind: "system" },
  { id: "queue", title: "Queue + Delay", desc: "Debounce pesan beruntun", x: 230, y: 345, icon: Clock, tone: "blue", drawer: "queue", kind: "system" },
  { id: "intent", title: "Intent AI", desc: "Rule + LLM fallback", x: 470, y: 240, icon: Brain, tone: "violet", drawer: "routing", kind: "ai" },
  { id: "router", title: "Router", desc: "Intent ke agent", x: 710, y: 240, icon: GitBranch, tone: "cyan", drawer: "routing", kind: "system" },
  { id: "front-office", title: "Front Office", desc: "Booking dan FAQ", x: 960, y: 20, icon: Users, tone: "cyan", drawer: "settings", kind: "agent" },
  { id: "pricing", title: "Pricing", desc: "Tarif real-time", x: 960, y: 125, icon: Wallet, tone: "blue", drawer: "settings", kind: "agent" },
  { id: "customer-care", title: "Customer Care", desc: "Keluhan & layanan", x: 960, y: 230, icon: Headphones, tone: "green", drawer: "settings", kind: "agent" },
  { id: "finance", title: "Finance", desc: "Payment proof", x: 960, y: 335, icon: Bell, tone: "amber", drawer: "settings", kind: "agent" },
  { id: "manager", title: "Manager", desc: "Escalation gate", x: 960, y: 440, icon: ShieldAlert, tone: "rose", drawer: "telegram", kind: "agent" },
  { id: "content", title: "Content", desc: "SEO / city guide", x: 960, y: 545, icon: Sparkles, tone: "slate", drawer: "settings", kind: "agent" },
  { id: "availability", title: "Availability", desc: "Cek stok & harga", x: 1245, y: 70, icon: CalendarCheck, tone: "green", kind: "tool" },
  { id: "rag", title: "RAG / SOP", desc: "Knowledge context", x: 1245, y: 270, icon: Database, tone: "violet", drawer: "knowledge", kind: "tool" },
  { id: "send", title: "Send Reply", desc: "WhatsApp provider", x: 1245, y: 390, icon: Send, tone: "green", kind: "output" },
  { id: "handover", title: "Human Handover", desc: "Staf ambil alih", x: 1245, y: 510, icon: LifeBuoy, tone: "rose", drawer: "inbox", kind: "manual" },
];

const FLOW_EDGES: FlowEdgeMeta[] = [
  { from: "incoming", to: "parser", label: "webhook" },
  { from: "incoming", to: "queue", label: "burst" },
  { from: "parser", to: "intent" },
  { from: "queue", to: "intent", label: "ready" },
  { from: "intent", to: "router", label: "intent" },
  { from: "router", to: "front-office" },
  { from: "router", to: "pricing" },
  { from: "router", to: "customer-care" },
  { from: "router", to: "finance" },
  { from: "router", to: "manager", tone: "rose" },
  { from: "router", to: "content", tone: "slate" },
  { from: "front-office", to: "availability", label: "tool" },
  { from: "pricing", to: "availability", label: "rate" },
  { from: "front-office", to: "rag" },
  { from: "customer-care", to: "rag" },
  { from: "finance", to: "rag" },
  { from: "front-office", to: "send" },
  { from: "pricing", to: "send" },
  { from: "finance", to: "send" },
  { from: "manager", to: "handover", tone: "rose" },
  { from: "send", to: "handover", label: "fallback", tone: "amber" },
];

const nodeTypes = { aiNode: AiFlowNode };

function AiLab() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [selectedNode, setSelectedNode] = useState(FLOW_NODES.find((node) => node.id === "front-office") ?? FLOW_NODES[0]);

  const configFn = useServerFn(getAiLabConfig);
  const updateFn = useServerFn(updateAiLabConfig);
  const snapshotFn = useServerFn(getAiLabControlSnapshot);
  const metricsFn = useServerFn(getDashboardMetrics);
  const healthFn = useServerFn(getChatbotHealthSnapshot);
  const queueFn = useServerFn(getQueueMetricsStats);
  const retryFn = useServerFn(getRetryStats);
  const routingFn = useServerFn(getAgentRoutingStats);
  const qualityFn = useServerFn(getAgentQualityScores);

  const { data: configData } = useQuery({ queryKey: ["ai-lab-config"], queryFn: () => configFn() });
  const { data: snapshot } = useQuery({ queryKey: ["ai-lab-control-snapshot"], queryFn: () => snapshotFn(), refetchInterval: 15_000 });
  const { data: metrics } = useQuery({ queryKey: ["control-room-dashboard"], queryFn: () => metricsFn(), refetchInterval: 60_000 });
  const { data: health } = useQuery({ queryKey: ["control-room-health"], queryFn: () => healthFn(), refetchInterval: 30_000 });
  const { data: queue } = useQuery({ queryKey: ["control-room-queue-stats"], queryFn: () => queueFn(), refetchInterval: 15_000 });
  const { data: retry } = useQuery({ queryKey: ["control-room-retry-stats"], queryFn: () => retryFn(), refetchInterval: 60_000 });
  const { data: routing } = useQuery({ queryKey: ["control-room-routing"], queryFn: () => routingFn(), refetchInterval: 60_000 });
  const { data: quality } = useQuery({ queryKey: ["control-room-agent-quality"], queryFn: () => qualityFn(), refetchInterval: 60_000 });

  const config = configData?.config ?? mergeAiLabConfig({});
  const latestQueue = queue?.[0];
  const retryTotal = retry?.reduce((sum, row) => sum + Number(row.total ?? 0), 0) ?? 0;

  async function commitConfig(next: AiLabConfig, message = "Konfigurasi AI Lab tersimpan") {
    if (!configData?.id) {
      toast.error("Properti belum tersedia.");
      return;
    }
    await updateFn({ data: { id: configData.id, config: next as unknown as Record<string, unknown> } });
    toast.success(message);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ai-lab-config"] }),
      qc.invalidateQueries({ queryKey: ["ai-lab-control-snapshot"] }),
      qc.invalidateQueries({ queryKey: ["control-room-agent-quality"] }),
    ]);
  }

  function updateAutoReply(mode: "pause" | "safe" | "full") {
    const next = JSON.parse(JSON.stringify(config)) as AiLabConfig;
    for (const agent of AGENTS) {
      if (!next.agents[agent.key]) continue;
      if (mode === "pause") next.agents[agent.key].autoReply = false;
      if (mode === "safe") next.agents[agent.key].autoReply = agent.safeAuto && next.agents[agent.key].enabled;
      if (mode === "full") next.agents[agent.key].autoReply = next.agents[agent.key].enabled;
    }
    const message = mode === "pause" ? "Semua auto reply dipause" : mode === "safe" ? "Safe Auto Reply aktif" : "Full Auto Reply aktif";
    void commitConfig(next, message);
  }

  return (
    <div className="bg-slate-950 text-slate-100" style={{ height: "100dvh", overflowY: "auto", overscrollBehaviorY: "contain" }}>
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090f1c]/95 backdrop-blur">
        <div className="flex min-h-[72px] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold md:text-lg">WhatsApp AI Control Room</h1>
            <p className="truncate text-xs text-slate-400">Pomah Guesthouse • operational AI Lab</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline" className="border-slate-700 bg-slate-900/50 text-slate-200 hover:bg-slate-800">
              <Link to="/admin">
                <LogOut className="mr-2 h-4 w-4" /> Keluar
              </Link>
            </Button>
            <StatusBadge snapshot={snapshot} />
            <Button size="sm" variant="outline" className="border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20" onClick={() => updateAutoReply("pause")}>
              <PauseCircle className="mr-2 h-4 w-4" /> Pause
            </Button>
            <Button size="sm" variant="outline" className="border-sky-400/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20" onClick={() => updateAutoReply("safe")}>
              <ShieldAlert className="mr-2 h-4 w-4" /> Safe
            </Button>
            <Button size="sm" className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={() => updateAutoReply("full")}>
              <PlayCircle className="mr-2 h-4 w-4" /> Full
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[1500px] px-3 pt-3 md:px-5 md:pt-5">
        <AiReactFlowCanvas
          selected={selectedNode.id}
          config={config}
          snapshot={snapshot}
          health={health}
          quality={quality ?? []}
          onSelect={setSelectedNode}
          openDrawer={setDrawer}
        />
      </section>

      <main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5 xl:grid-cols-[232px_minmax(0,1fr)] 2xl:grid-cols-[232px_minmax(0,1fr)_340px]">
        <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start">
          <Navigation openDrawer={setDrawer} unread={snapshot?.unreadThreads ?? 0} />
          <SafetyCard snapshot={snapshot} onPause={() => updateAutoReply("pause")} onSafe={() => updateAutoReply("safe")} onFull={() => updateAutoReply("full")} />
        </aside>

        <section className="min-w-0 space-y-4">
          <KpiStrip snapshot={snapshot} metrics={metrics} health={health} latestQueue={latestQueue} openDrawer={setDrawer} />
          <OperationalAlerts snapshot={snapshot} health={health} retryTotal={retryTotal} openDrawer={setDrawer} />
          <QualityScorePanel rows={quality ?? []} routing={routing} retryTotal={retryTotal} />
          <SettingsPanel config={config} commitConfig={commitConfig} openDrawer={setDrawer} />
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <InspectorPanel selectedNode={selectedNode} config={config} snapshot={snapshot} health={health} quality={quality ?? []} openDrawer={setDrawer} />
          <AuditMiniPanel openDrawer={setDrawer} />
        </aside>
      </main>

      <FeatureDrawer drawer={drawer} setDrawer={setDrawer} config={config} commitConfig={commitConfig} />
    </div>
  );
}

function Navigation({ openDrawer, unread }: { openDrawer: (drawer: DrawerKey) => void; unread: number }) {
  const items: Array<{ label: string; drawer: Exclude<DrawerKey, null>; icon: ComponentType<{ className?: string }> }> = [
    { label: "Inbox", drawer: "inbox", icon: Inbox },
    { label: "Simulator", drawer: "simulator", icon: PlayCircle },
    { label: "Training", drawer: "training", icon: Sparkles },
    { label: "Knowledge", drawer: "knowledge", icon: BookOpen },
    { label: "Routing", drawer: "routing", icon: GitBranch },
    { label: "Queue", drawer: "queue", icon: Gauge },
    { label: "Health", drawer: "health", icon: Activity },
    { label: "Settings", drawer: "settings", icon: Settings },
  ];
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-3 text-slate-100">
      <div className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Navigation</div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-1">
        {items.map((item) => (
          <button key={item.drawer} onClick={() => openDrawer(item.drawer)} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition hover:bg-slate-800/70 hover:text-white">
            <item.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.drawer === "inbox" && unread > 0 && <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{unread}</span>}
          </button>
        ))}
      </div>
    </Card>
  );
}

function StatusBadge({ snapshot }: { snapshot?: AiLabControlSnapshot }) {
  if (snapshot?.globalAutoReplyPaused) return <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">Auto Reply Paused</Badge>;
  return <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Live • {snapshot?.autoReplyAgents ?? 0} auto agents</Badge>;
}

function SafetyCard({ snapshot, onPause, onSafe, onFull }: { snapshot?: AiLabControlSnapshot; onPause: () => void; onSafe: () => void; onFull: () => void }) {
  return (
    <Card className="rounded-2xl border-amber-400/20 bg-amber-500/10 p-4 text-amber-50">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-300" />
        <div>
          <p className="font-semibold">AI Safety Mode</p>
          <p className="mt-1 text-xs text-amber-100/80">Auto reply aktif di {snapshot?.autoReplyAgents ?? 0}/{snapshot?.totalAgents ?? AGENTS.length} agent.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <Button size="sm" variant="outline" className="border-amber-400/30 bg-slate-950/50 text-amber-100 hover:bg-slate-900" onClick={onPause}>Pause All</Button>
        <Button size="sm" variant="outline" className="border-sky-400/30 bg-slate-950/50 text-sky-100 hover:bg-slate-900" onClick={onSafe}>Safe Auto</Button>
        <Button size="sm" className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={onFull}>Full Auto</Button>
      </div>
    </Card>
  );
}

function KpiStrip({ snapshot, metrics, health, latestQueue, openDrawer }: { snapshot?: AiLabControlSnapshot; metrics: any; health: any; latestQueue: any; openDrawer: (drawer: DrawerKey) => void }) {
  const summary = metrics?.summary;
  const cards = [
    { label: "Unread Inbox", value: fmtNum(snapshot?.unreadMessages ?? 0), delta: `${fmtNum(snapshot?.unreadThreads ?? 0)} thread`, icon: Inbox, tone: "green" as Tone, drawer: "inbox" as DrawerKey },
    { label: "Conversations", value: fmtNum(summary?.waThreads ?? health?.delivery?.total ?? 0), delta: `${summary?.waConversionPct ?? 0}% conversion`, icon: MessageCircle, tone: "blue" as Tone, drawer: "health" as DrawerKey },
    { label: "Auto Agents", value: `${snapshot?.autoReplyAgents ?? 0}/${snapshot?.totalAgents ?? AGENTS.length}`, delta: snapshot?.globalAutoReplyPaused ? "paused" : "aktif", icon: Bot, tone: snapshot?.globalAutoReplyPaused ? "amber" as Tone : "cyan" as Tone, drawer: "settings" as DrawerKey },
    { label: "Response p50", value: fmtMsShort(health?.latency?.p50Ms ?? null), delta: `p95 ${fmtMsShort(health?.latency?.p95Ms ?? null)}`, icon: Clock, tone: "violet" as Tone, drawer: "health" as DrawerKey },
    { label: "Queue", value: `${snapshot?.queuePending ?? latestQueue?.queued ?? 0}`, delta: `${snapshot?.queueFailed ?? latestQueue?.failed ?? 0} failed`, icon: Gauge, tone: "rose" as Tone, drawer: "queue" as DrawerKey },
    { label: "Open Handoff", value: fmtNum(health?.openHandoffTickets ?? 0), delta: "butuh staf", icon: LifeBuoy, tone: "amber" as Tone, drawer: "inbox" as DrawerKey },
  ];
  return (
    <section className="grid" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}>
      {cards.map((card) => (
        <button key={card.label} onClick={() => card.drawer && openDrawer(card.drawer)} className="rounded-xl border border-slate-800 bg-slate-950/70 text-left text-slate-100 transition hover:border-emerald-400/50" style={{ minHeight: "74px", padding: "8px 10px" }}>
          <span className={cn("flex items-center justify-center rounded-lg", toneClass(card.tone, "bg"))} style={{ width: "26px", height: "26px" }}>
            <card.icon className={cn("h-3.5 w-3.5", toneClass(card.tone, "text"))} />
          </span>
          <p className="mt-1.5 truncate text-[10px] leading-3 text-slate-400">{card.label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold leading-5 tracking-tight text-white">{card.value}</p>
          <p className={cn("mt-0.5 truncate text-[9px] leading-3", toneClass(card.tone, "text"))}>{card.delta}</p>
        </button>
      ))}
    </section>
  );
}

function OperationalAlerts({ snapshot, health, retryTotal, openDrawer }: { snapshot?: AiLabControlSnapshot; health: any; retryTotal: number; openDrawer: (drawer: DrawerKey) => void }) {
  const alerts = [
    snapshot?.globalAutoReplyPaused ? { tone: "amber" as Tone, title: "Auto reply sedang pause", desc: "Semua tamu masuk mode manual/draft.", drawer: "settings" as DrawerKey } : null,
    (snapshot?.queueFailed ?? 0) > 0 ? { tone: "rose" as Tone, title: "Ada queue failed", desc: `${snapshot?.queueFailed ?? 0} job gagal.`, drawer: "retry" as DrawerKey } : null,
    retryTotal > 0 ? { tone: "violet" as Tone, title: "Retry AI terdeteksi", desc: `${retryTotal} retry tercatat.`, drawer: "retry" as DrawerKey } : null,
    (health?.openHandoffTickets ?? 0) > 0 ? { tone: "amber" as Tone, title: "Handoff terbuka", desc: `${health.openHandoffTickets} percakapan butuh staf.`, drawer: "inbox" as DrawerKey } : null,
  ].filter(Boolean) as Array<{ tone: Tone; title: string; desc: string; drawer: DrawerKey }>;
  if (alerts.length === 0) return null;
  return (
    <section className="grid gap-2 md:grid-cols-2">
      {alerts.map((alert) => (
        <button key={alert.title} onClick={() => alert.drawer && openDrawer(alert.drawer)} className={cn("rounded-2xl border p-4 text-left transition", toneBorder(alert.tone))}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={cn("mt-0.5 h-5 w-5", toneClass(alert.tone, "text"))} />
            <div>
              <p className="font-semibold text-white">{alert.title}</p>
              <p className="mt-1 text-sm text-slate-400">{alert.desc}</p>
            </div>
          </div>
        </button>
      ))}
    </section>
  );
}

function AiReactFlowCanvas({
  selected,
  config,
  snapshot,
  health,
  quality,
  onSelect,
  openDrawer,
}: {
  selected: string;
  config: AiLabConfig;
  snapshot?: AiLabControlSnapshot;
  health: any;
  quality: AgentQualityScore[];
  onSelect: (node: FlowNodeMeta) => void;
  openDrawer: (drawer: DrawerKey) => void;
}) {
  const runtimeById = useMemo(() => {
    const map = new Map<string, FlowRuntime>();
    for (const node of FLOW_NODES) map.set(node.id, getNodeRuntime(node, config, snapshot, health, quality));
    return map;
  }, [config, health, quality, snapshot]);

  const baseNodes = useMemo<Node<AiFlowNodeData>[]>(
    () => FLOW_NODES.map((meta) => ({
      id: meta.id,
      type: "aiNode",
      position: { x: meta.x, y: meta.y },
      data: { meta, runtime: runtimeById.get(meta.id) ?? { label: "ready", detail: meta.desc, tone: meta.tone } },
    })),
    [runtimeById],
  );
  const baseEdges = useMemo<Edge[]>(() => FLOW_EDGES.map((edge) => ({
    id: `${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    animated: edge.tone === "rose" || edge.label === "fallback",
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: {
      strokeWidth: selected === edge.from || selected === edge.to ? 3 : 2,
      stroke: selected === edge.from || selected === edge.to ? "rgb(52,211,153)" : edge.tone === "rose" ? "rgba(251,113,133,.8)" : "rgba(148,163,184,.52)",
    },
    labelStyle: { fill: "#94a3b8", fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: "#020617", fillOpacity: 0.85 },
  })), [selected]);

  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges);
  const selectedNode = FLOW_NODES.find((node) => node.id === selected) ?? FLOW_NODES[0];
  const selectedRuntime = runtimeById.get(selectedNode.id) ?? { label: "ready", detail: selectedNode.desc, tone: selectedNode.tone };

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const meta = FLOW_NODES.find((item) => item.id === node.id);
      if (!meta) return node;
      return { ...node, data: { meta, runtime: runtimeById.get(meta.id) ?? { label: "ready", detail: meta.desc, tone: meta.tone } } };
    }));
  }, [runtimeById, setNodes]);

  useEffect(() => {
    setEdges(baseEdges);
  }, [baseEdges, setEdges]);

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-800 bg-slate-950/70 p-0 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-500/15 text-emerald-300">React Flow Canvas</Badge>
          <div>
            <h2 className="text-sm font-semibold text-white">WhatsApp AI Pipeline</h2>
            <p className="text-xs text-slate-500">Drag node, zoom, pan, minimap, dan double click untuk membuka detail.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <Badge className={toneClass(selectedRuntime.tone, "badge")}>{selectedNode.title}: {selectedRuntime.label}</Badge>
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => openDrawer("simulator")}>
            <PlayCircle className="mr-2 h-4 w-4" /> Simulator
          </Button>
        </div>
      </div>
      <div className="h-[620px] bg-[#020617]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              const meta = FLOW_NODES.find((item) => item.id === node.id);
              if (meta) onSelect(meta);
            }}
            onNodeDoubleClick={(_, node) => {
              const meta = FLOW_NODES.find((item) => item.id === node.id);
              if (meta?.drawer) openDrawer(meta.drawer);
            }}
            fitView
            minZoom={0.35}
            maxZoom={1.35}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            className="ai-lab-react-flow"
          >
            <Background color="rgba(148,163,184,.2)" gap={24} size={1} variant={BackgroundVariant.Dots} />
            <Panel position="top-left" className="rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-xs text-slate-300 shadow-xl">
              {FLOW_NODES.length} nodes • {FLOW_EDGES.length} routes
            </Panel>
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </Card>
  );
}

function AiFlowNode({ data, selected }: NodeProps<Node<AiFlowNodeData>>) {
  const nodeData = data as AiFlowNodeData;
  const meta = nodeData.meta;
  const runtime = nodeData.runtime;
  const Icon = meta.icon;
  return (
    <div className={cn(
      "min-w-[196px] rounded-2xl border bg-slate-950/95 p-3 text-left shadow-2xl backdrop-blur transition",
      selected ? "border-emerald-400 shadow-[0_0_34px_rgba(16,185,129,.28)]" : "border-slate-800 hover:border-emerald-400/60",
    )}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-slate-950 !bg-slate-500" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-slate-950 !bg-emerald-400" />
      <span className={cn("absolute right-3 top-3 h-2.5 w-2.5 rounded-full", runtimeDot(runtime.tone), runtime.pulse && "animate-pulse")} />
      <div className="flex items-start gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneClass(meta.tone, "bg"))}>
          <Icon className={cn("h-5 w-5", toneClass(meta.tone, "text"))} />
        </span>
        <div className="min-w-0 pr-4">
          <p className="truncate text-sm font-semibold text-white">{meta.title}</p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{meta.desc}</p>
          <div className="mt-2 flex items-center gap-1.5">
            <Badge className={toneClass(runtime.tone, "badge")}>{runtime.label}</Badge>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{meta.kind}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function getNodeRuntime(node: FlowNodeMeta, config: AiLabConfig, snapshot?: AiLabControlSnapshot, health?: any, quality: AgentQualityScore[] = []): FlowRuntime {
  if (node.id === "incoming") {
    const unread = snapshot?.unreadMessages ?? 0;
    return unread > 0
      ? { label: `${unread} unread`, detail: `${snapshot?.unreadThreads ?? 0} thread belum dibaca`, tone: "amber", pulse: true }
      : { label: "listening", detail: "Webhook siap menerima pesan", tone: "green" };
  }
  if (node.id === "queue") {
    if ((snapshot?.queueFailed ?? 0) > 0) return { label: "failed", detail: `${snapshot?.queueFailed ?? 0} job gagal`, tone: "rose", pulse: true };
    if ((snapshot?.queuePending ?? 0) > 0) return { label: "pending", detail: `${snapshot?.queuePending ?? 0} job menunggu`, tone: "amber", pulse: true };
    return { label: "clear", detail: "Tidak ada backlog queue", tone: "green" };
  }
  if (node.id === "send") {
    if (snapshot?.globalAutoReplyPaused) return { label: "paused", detail: "Auto reply global sedang pause", tone: "amber", pulse: true };
    return { label: "ready", detail: "Provider siap dipakai dari pipeline", tone: "green" };
  }
  if (node.id === "handover") {
    const count = health?.openHandoffTickets ?? 0;
    return count > 0 ? { label: `${count} open`, detail: "Ada percakapan butuh staf", tone: "rose", pulse: true } : { label: "standby", detail: "Tidak ada handoff terbuka", tone: "green" };
  }
  const agent = AGENTS.find((item) => item.key === node.id);
  if (agent) {
    const cfg = config.agents[agent.key];
    if (!cfg?.enabled) return { label: "off", detail: "Agent tidak aktif", tone: "slate" };
    if (!cfg.autoReply) return { label: "manual", detail: "Agent aktif, auto reply mati", tone: "amber" };
    const score = quality.find((row) => row.agentKey === agent.key)?.score;
    return { label: score ? `auto ${score}` : "auto", detail: "Agent aktif dan auto reply menyala", tone: "green" };
  }
  if (node.id === "availability") return { label: "tool", detail: "Digunakan sebelum menjawab stok/harga", tone: "green" };
  if (node.id === "rag") return { label: "context", detail: "SOP dan training examples tersedia via drawer Knowledge", tone: "violet" };
  if (node.id === "intent") return { label: "classify", detail: "Rule-based + fallback AI", tone: "violet" };
  if (node.id === "router") return { label: "route", detail: "Menghubungkan intent ke agent", tone: "cyan" };
  return { label: "auto", detail: "Langkah sistem otomatis", tone: node.tone };
}

function QualityScorePanel({ rows, routing, retryTotal }: { rows: AgentQualityScore[]; routing: any; retryTotal: number }) {
  const topIntents = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of routing?.rows ?? []) totals.set(row.intent, (totals.get(row.intent) ?? 0) + Number(row.count ?? 0));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [routing]);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Quality Score</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Agent performance signal</h2>
          </div>
          <Badge className="bg-slate-800 text-slate-300">Retry {retryTotal}</Badge>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const agent = AGENTS.find((a) => a.key === row.agentKey);
            const Icon = agent?.icon ?? Bot;
            return (
              <div key={row.agentKey} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-emerald-300" />
                    <span className="font-semibold text-white">{agent?.name ?? row.agentKey}</span>
                  </span>
                  <ScoreBadge score={row.score} />
                </div>
                <p className="mt-2 text-xs text-slate-400">{row.signal}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${row.score}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
        <p className="text-sm font-semibold text-white">Top intents</p>
        <div className="mt-4 space-y-3">
          {topIntents.length === 0 && <p className="text-sm text-slate-500">Belum ada data routing.</p>}
          {topIntents.map(([intent, count]) => (
            <div key={intent} className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 last:border-0">
              <span className="truncate text-sm text-slate-300">{prettyIntent(intent)}</span>
              <Badge className="bg-slate-800 text-slate-300">{count}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function InspectorPanel({ selectedNode, config, snapshot, health, quality, openDrawer }: { selectedNode: FlowNodeMeta; config: AiLabConfig; snapshot?: AiLabControlSnapshot; health: any; quality: AgentQualityScore[]; openDrawer: (drawer: DrawerKey) => void }) {
  const agent = AGENTS.find((a) => a.key === selectedNode.id);
  const agentConfig = agent ? config.agents[agent.key] : null;
  const runtime = getNodeRuntime(selectedNode, config, snapshot, health, quality);

  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", toneClass(selectedNode.tone, "bg"))}>
          <selectedNode.icon className={cn("h-5 w-5", toneClass(selectedNode.tone, "text"))} />
        </span>
        <div>
          <p className="font-semibold text-white">{selectedNode.title}</p>
          <p className="mt-1 text-xs text-slate-400">{selectedNode.desc}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <MetricRow label="Runtime" value={runtime.label} tone={runtime.tone === "green" ? "green" : undefined} />
        <MetricRow label="Detail" value={runtime.detail} />
        <MetricRow label="Node type" value={selectedNode.kind} />
        {agentConfig && <MetricRow label="Agent active" value={agentConfig.enabled ? "Yes" : "Off"} tone={agentConfig.enabled ? "green" : undefined} />}
        {agentConfig && <MetricRow label="Auto reply" value={agentConfig.autoReply ? "Auto" : "Manual"} tone={agentConfig.autoReply ? "green" : undefined} />}
        {selectedNode.id === "queue" && <MetricRow label="Pending / Failed" value={`${snapshot?.queuePending ?? 0} / ${snapshot?.queueFailed ?? 0}`} />}
      </div>
      <div className="mt-4 grid gap-2">
        {selectedNode.drawer && <Button className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={() => openDrawer(selectedNode.drawer!)}>Open detail</Button>}
        <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800" onClick={() => openDrawer("simulator")}>Test in simulator</Button>
      </div>
    </Card>
  );
}

function SettingsPanel({ config, commitConfig, openDrawer }: { config: AiLabConfig; commitConfig: (next: AiLabConfig, msg?: string) => Promise<void>; openDrawer: (drawer: DrawerKey) => void }) {
  const updateAgent = (key: string, patch: Partial<{ enabled: boolean; autoReply: boolean }>) => {
    const next = JSON.parse(JSON.stringify(config)) as AiLabConfig;
    next.agents[key] = { ...next.agents[key], ...patch };
    void commitConfig(next, `${AGENTS.find((a) => a.key === key)?.name ?? key} diperbarui`);
  };
  const updateTool = (key: string, enabled: boolean) => {
    const next = JSON.parse(JSON.stringify(config)) as AiLabConfig;
    next.tools[key] = { ...next.tools[key], enabled };
    void commitConfig(next, `${TOOLS.find((t) => t.key === key)?.name ?? key} diperbarui`);
  };

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Agents</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Auto Reply & Safety</h2>
          </div>
          <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => openDrawer("audit")}>Audit Trail</Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((agent) => {
            const c = config.agents[agent.key];
            return (
              <div key={agent.key} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
                    <agent.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{agent.name}</p>
                    <p className="text-xs text-slate-400">{agent.desc}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <SettingSwitch title="Active" checked={!!c?.enabled} onChange={(v) => updateAgent(agent.key, { enabled: v })} />
                  <SettingSwitch title="Auto Reply" checked={!!c?.autoReply} onChange={(v) => updateAgent(agent.key, { autoReply: v })} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
        <p className="text-lg font-semibold text-white">Tool Enablement</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {TOOLS.map((tool) => {
            const c = config.tools[tool.key];
            return (
              <div key={tool.key} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <tool.icon className="h-5 w-5 text-sky-300" />
                <p className="mt-3 text-sm font-semibold text-white">{tool.name}</p>
                <p className="mt-1 text-xs text-slate-500">{c?.enabled ? "Enabled" : "Disabled"}</p>
                <div className="mt-3"><Switch checked={!!c?.enabled} onCheckedChange={(v) => updateTool(tool.key, v)} /></div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function SettingSwitch({ title, checked, onChange }: { title: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
      <span className="text-sm text-slate-300">{title}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function FeatureDrawer({ drawer, setDrawer, config, commitConfig }: { drawer: DrawerKey; setDrawer: (drawer: DrawerKey) => void; config: AiLabConfig; commitConfig: (next: AiLabConfig, msg?: string) => Promise<void> }) {
  const meta: Record<Exclude<DrawerKey, null>, { title: string; desc: string }> = {
    training: { title: "Training & Evaluation", desc: "Curated examples, correction loop, and auto evaluation." },
    knowledge: { title: "Knowledge / RAG", desc: "SOP knowledge, RAG settings, and retrieval debugger." },
    telegram: { title: "Managerial / Telegram", desc: "Manager linking and internal agent channels." },
    health: { title: "Health Detail", desc: "Delivery, latency, handoff, and intent distribution." },
    routing: { title: "Routing Detail", desc: "Intent mapping, actual agent, mismatch warning." },
    settings: { title: "Control Room Settings", desc: "Auto reply, agent toggles, tool enablement, and safety." },
    inbox: { title: "WhatsApp Inbox", desc: "Human handoff and live guest workspace." },
    queue: { title: "Queue Health Detail", desc: "Latency, current jobs, zombie monitoring." },
    retry: { title: "Health & Retry Detail", desc: "AI gateway retry observability." },
    simulator: { title: "Chat Simulator", desc: "Controlled WhatsApp turn using production pipeline." },
    audit: { title: "Audit & Rollback", desc: "Config history, rollback readiness, and change governance." },
  };
  const m = drawer ? meta[drawer] : null;
  return (
    <Sheet open={!!drawer} onOpenChange={(open) => !open && setDrawer(null)}>
      <SheetContent side="right" className="w-full overflow-hidden border-slate-800 bg-[#070b14] p-0 text-slate-100 sm:max-w-[1040px]">
        {m && drawer && (
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="border-b border-slate-800 px-5 py-4 text-left">
              <SheetTitle className="text-white">{m.title}</SheetTitle>
              <SheetDescription className="text-slate-400">{m.desc}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DrawerContent drawer={drawer} config={config} commitConfig={commitConfig} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerContent({ drawer, config, commitConfig }: { drawer: Exclude<DrawerKey, null>; config: AiLabConfig; commitConfig: (next: AiLabConfig, msg?: string) => Promise<void> }) {
  if (drawer === "training") return <DarkDrawerBody><TrainingPage /><WhatsappCorrectionsPage /></DarkDrawerBody>;
  if (drawer === "knowledge") return <DarkDrawerBody><RagDebugger /><SopKnowledgeView /><TrainingRagSettings /></DarkDrawerBody>;
  if (drawer === "telegram") return <DarkDrawerBody><TelegramPage /></DarkDrawerBody>;
  if (drawer === "health") return <DarkDrawerBody><HealthPage /></DarkDrawerBody>;
  if (drawer === "routing") return <DarkDrawerBody><RoutingDebugPage /></DarkDrawerBody>;
  if (drawer === "settings") return <DarkDrawerBody><SettingsPanel config={config} commitConfig={commitConfig} openDrawer={() => undefined} /><SmartDelaySettings /><IntentRulesView /></DarkDrawerBody>;
  if (drawer === "inbox") return <DarkDrawerBody><WhatsAppPage /></DarkDrawerBody>;
  if (drawer === "queue") return <DarkDrawerBody><QueueMonitoringView /></DarkDrawerBody>;
  if (drawer === "retry") return <DarkDrawerBody><RetryObservabilityView /></DarkDrawerBody>;
  if (drawer === "simulator") return <DarkDrawerBody><SimulatorSafetyGate /><ChatSimulatorView /></DarkDrawerBody>;
  if (drawer === "audit") return <DarkDrawerBody><AuditTrailPanel /></DarkDrawerBody>;
  return null;
}

function SimulatorSafetyGate() {
  return (
    <Card className="rounded-2xl border-amber-400/30 bg-amber-500/10 p-4 text-amber-50">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />
        <div>
          <p className="font-semibold">Simulator Safety Gate</p>
          <p className="mt-1 text-sm text-amber-100/80">Simulator memakai pipeline asli. Gunakan nomor test khusus dan cek booking test sebelum merge ke produksi.</p>
        </div>
      </div>
    </Card>
  );
}

function RagDebugger() {
  const previewFn = useServerFn(previewTrainingRagMatches);
  const [query, setQuery] = useState("kalau deluxe malam ini ada?");
  const [rows, setRows] = useState<RagPreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  async function runPreview() {
    setLoading(true);
    try {
      const res = await previewFn({ data: { query, limit: 5 } });
      setRows(res.rows ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview RAG gagal");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Card className="rounded-2xl border-violet-400/20 bg-violet-500/10 p-4 text-slate-100">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <Label className="text-violet-100">RAG retrieval preview</Label>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-2 border-slate-700 bg-slate-950 text-white" />
        </div>
        <Button onClick={runPreview} disabled={loading} className="bg-violet-500 text-white hover:bg-violet-400">
          <Search className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Preview
        </Button>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length === 0 && <p className="text-sm text-violet-100/70">Masukkan pertanyaan tamu lalu klik Preview untuk melihat contoh training yang kemungkinan masuk prompt.</p>}
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border border-violet-400/20 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <Badge className={row.used ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-300"}>{row.used ? "Dipakai" : "Cadangan"}</Badge>
              <span className="text-xs text-slate-500">match {row.lexicalScore}%</span>
            </div>
            <p className="mt-2 text-sm text-white">{row.userMessage || "(tanpa user message)"}</p>
            <p className="mt-1 line-clamp-2 text-xs text-slate-400">{row.idealResponse || "Belum ada ideal response"}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditTrailPanel() {
  const auditFn = useServerFn(getAiLabAuditTrail);
  const { data, isFetching, refetch } = useQuery({ queryKey: ["ai-lab-audit-trail-full"], queryFn: () => auditFn() });
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Audit Trail</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Prompt & setting history</h2>
        </div>
        <Button size="sm" variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => refetch()}>
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />Refresh
        </Button>
      </div>
      {!data?.installed && <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">Tabel audit belum terpasang atau belum ada perubahan tercatat. UI sudah siap; migration audit diperlukan untuk rollback penuh.</div>}
      <div className="mt-4 space-y-2">
        {data?.rows?.map((row) => (
          <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-white">{row.section}</p>
              <span className="text-xs text-slate-500">{fmtDate(row.changedAt)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{row.reason} • {row.changedBy}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditMiniPanel({ openDrawer }: { openDrawer: (drawer: DrawerKey) => void }) {
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-white">Audit</p>
        <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => openDrawer("audit")}>Open</Button>
      </div>
      <p className="mt-2 text-sm text-slate-400">History & rollback readiness.</p>
    </Card>
  );
}

function DarkDrawerBody({ children }: { children: ReactNode }) {
  return <div className="space-y-4 bg-[#070b14] p-4 text-slate-100 [&_.bg-background]:bg-slate-950 [&_.text-foreground]:text-slate-100">{children}</div>;
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800/70 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className={cn("text-right font-medium text-slate-200", tone === "green" && "text-emerald-300")}>{value}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 85 ? "bg-emerald-500/15 text-emerald-300" : score >= 70 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
  return <Badge className={cls}>{score}</Badge>;
}

function runtimeDot(tone: Tone) {
  if (tone === "green") return "bg-emerald-400";
  if (tone === "amber") return "bg-amber-400";
  if (tone === "rose") return "bg-rose-400";
  if (tone === "violet") return "bg-violet-400";
  if (tone === "cyan") return "bg-cyan-400";
  if (tone === "blue") return "bg-sky-400";
  return "bg-slate-400";
}

function toneClass(tone: Tone, part: "bg" | "text" | "badge") {
  const map = {
    green: { bg: "bg-emerald-500/15", text: "text-emerald-300", badge: "bg-emerald-500/15 text-emerald-300" },
    blue: { bg: "bg-sky-500/15", text: "text-sky-300", badge: "bg-sky-500/15 text-sky-300" },
    violet: { bg: "bg-violet-500/15", text: "text-violet-300", badge: "bg-violet-500/15 text-violet-300" },
    amber: { bg: "bg-amber-500/15", text: "text-amber-300", badge: "bg-amber-500/15 text-amber-300" },
    rose: { bg: "bg-rose-500/15", text: "text-rose-300", badge: "bg-rose-500/15 text-rose-300" },
    cyan: { bg: "bg-cyan-500/15", text: "text-cyan-300", badge: "bg-cyan-500/15 text-cyan-300" },
    slate: { bg: "bg-slate-700/60", text: "text-slate-300", badge: "bg-slate-800 text-slate-300" },
  } satisfies Record<Tone, Record<"bg" | "text" | "badge", string>>;
  return map[tone][part];
}

function toneBorder(tone: Tone) {
  if (tone === "rose") return "border-rose-400/20 bg-rose-500/10";
  if (tone === "amber") return "border-amber-400/20 bg-amber-500/10";
  if (tone === "violet") return "border-violet-400/20 bg-violet-500/10";
  return "border-slate-800 bg-slate-950/70";
}

function toneMiniMapColor(tone: Tone) {
  if (tone === "green") return "#34d399";
  if (tone === "amber") return "#f59e0b";
  if (tone === "rose") return "#fb7185";
  if (tone === "violet") return "#a78bfa";
  if (tone === "cyan") return "#22d3ee";
  if (tone === "blue") return "#38bdf8";
  return "#64748b";
}

function fmtNum(value: number) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function fmtMsShort(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value));
  } catch {
    return value;
  }
}

function prettyIntent(intent: string) {
  return intent.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
