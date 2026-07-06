import { useMemo, useState, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  GitBranch,
  Headphones,
  Inbox,
  LifeBuoy,
  MessageCircle,
  Network,
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
  Zap,
} from "lucide-react";

import { getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import { getChatbotHealthSnapshot } from "@/admin/functions/health.functions";
import { getAgentRoutingStats } from "@/admin/functions/routing-debug.functions";
import {
  getAiLabConfig,
  updateAiLabConfig,
  mergeAiLabConfig,
  type AiLabConfig,
} from "@/admin/modules/ai-lab/ai-lab.functions";
import { getQueueMetricsStats, getRetryStats } from "@/admin/modules/ai-lab/ai-lab.functions";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

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

type FlowNodeId =
  | "incoming"
  | "parser"
  | "queue"
  | "intent"
  | "router"
  | "front-office"
  | "pricing"
  | "customer-care"
  | "finance"
  | "manager"
  | "content"
  | "availability"
  | "booking"
  | "send-reply"
  | "handover"
  | "rag";

type Tone = "green" | "blue" | "violet" | "amber" | "rose" | "cyan" | "slate";

interface AgentCard {
  key: string;
  name: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  safeAuto: boolean;
}

interface FlowNode {
  id: FlowNodeId;
  title: string;
  desc: string;
  drawer?: Exclude<DrawerKey, null>;
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  status: "Trigger" | "Auto" | "AI" | "Tool" | "Manual" | "Safety";
}

const AGENTS: AgentCard[] = [
  { key: "front-office", name: "Front Office", desc: "Booking, availability, FAQ tamu", icon: Users, safeAuto: true },
  { key: "pricing", name: "Pricing", desc: "Harga, promo, paket", icon: Wallet, safeAuto: true },
  { key: "customer-care", name: "Customer Care", desc: "Keluhan dan layanan tamu", icon: Headphones, safeAuto: false },
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

const FLOW_NODES: FlowNode[] = [
  { id: "incoming", title: "Incoming WhatsApp", desc: "Evolution webhook masuk", icon: MessageCircle, tone: "green", status: "Trigger", drawer: "inbox" },
  { id: "parser", title: "Webhook Parser", desc: "Normalisasi phone, LID/JID, dedup", icon: Network, tone: "cyan", status: "Auto" },
  { id: "queue", title: "Queue + Smart Delay", desc: "Debounce pesan beruntun", icon: Clock, tone: "blue", status: "Auto", drawer: "queue" },
  { id: "intent", title: "Intent Classifier", desc: "Rule + fallback AI", icon: Brain, tone: "violet", status: "AI", drawer: "routing" },
  { id: "router", title: "Router", desc: "Intent → agent", icon: GitBranch, tone: "cyan", status: "Auto", drawer: "routing" },
  { id: "front-office", title: "Front Office", desc: "Kamar, booking, FAQ", icon: Users, tone: "cyan", status: "AI", drawer: "settings" },
  { id: "pricing", title: "Pricing", desc: "Tarif dan promo", icon: Wallet, tone: "blue", status: "AI", drawer: "settings" },
  { id: "customer-care", title: "Customer Care", desc: "Keluhan dan service", icon: Headphones, tone: "green", status: "AI", drawer: "settings" },
  { id: "finance", title: "Finance", desc: "Payment proof & invoice", icon: Bell, tone: "amber", status: "AI", drawer: "settings" },
  { id: "manager", title: "Manager", desc: "Escalation gate", icon: ShieldAlert, tone: "rose", status: "Safety", drawer: "telegram" },
  { id: "content", title: "Content", desc: "SEO / city guide", icon: Sparkles, tone: "slate", status: "Manual", drawer: "settings" },
  { id: "availability", title: "Check Availability", desc: "Tool wajib sebelum harga/stok", icon: CalendarCheck, tone: "green", status: "Tool" },
  { id: "booking", title: "Create Booking", desc: "Masuk PMS/calendar", icon: CalendarCheck, tone: "blue", status: "Tool" },
  { id: "send-reply", title: "Send Reply", desc: "Kirim via WhatsApp provider", icon: Send, tone: "green", status: "Auto" },
  { id: "handover", title: "Human Handover", desc: "Pause AI dan staf ambil alih", icon: LifeBuoy, tone: "rose", status: "Manual", drawer: "inbox" },
  { id: "rag", title: "RAG / SOP Lookup", desc: "Training examples + SOP", icon: Database, tone: "violet", status: "Tool", drawer: "knowledge" },
];

function AiLab() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<FlowNodeId>("front-office");
  const [mobileTab, setMobileTab] = useState<"overview" | "flow" | "quality" | "settings">("overview");

  const getConfig = useServerFn(getAiLabConfig);
  const updateConfig = useServerFn(updateAiLabConfig);
  const getSnapshot = useServerFn(getAiLabControlSnapshot);
  const getMetrics = useServerFn(getDashboardMetrics);
  const getHealth = useServerFn(getChatbotHealthSnapshot);
  const getQueue = useServerFn(getQueueMetricsStats);
  const getRetry = useServerFn(getRetryStats);
  const getRouting = useServerFn(getAgentRoutingStats);
  const getQuality = useServerFn(getAgentQualityScores);
  const getAudit = useServerFn(getAiLabAuditTrail);

  const { data: configData, isFetching: configLoading } = useQuery({
    queryKey: ["ai-lab-config"],
    queryFn: () => getConfig(),
  });
  const { data: snapshot } = useQuery({
    queryKey: ["ai-lab-control-snapshot"],
    queryFn: () => getSnapshot(),
    refetchInterval: 15_000,
  });
  const { data: metrics } = useQuery({ queryKey: ["control-room-dashboard"], queryFn: () => getMetrics(), refetchInterval: 60_000 });
  const { data: health } = useQuery({ queryKey: ["control-room-health"], queryFn: () => getHealth(), refetchInterval: 30_000 });
  const { data: queue } = useQuery({ queryKey: ["control-room-queue-stats"], queryFn: () => getQueue(), refetchInterval: 15_000 });
  const { data: retry } = useQuery({ queryKey: ["control-room-retry-stats"], queryFn: () => getRetry(), refetchInterval: 60_000 });
  const { data: routing } = useQuery({ queryKey: ["control-room-routing"], queryFn: () => getRouting(), refetchInterval: 60_000 });
  const { data: quality } = useQuery({ queryKey: ["control-room-agent-quality"], queryFn: () => getQuality(), refetchInterval: 60_000 });
  const { data: audit } = useQuery({ queryKey: ["ai-lab-audit-trail"], queryFn: () => getAudit(), refetchInterval: 120_000 });

  const config = configData?.config ?? mergeAiLabConfig({});
  const selectedNode = FLOW_NODES.find((n) => n.id === selectedNodeId) ?? FLOW_NODES[0];
  const latestQueue = queue?.[0];
  const retryTotal = retry?.reduce((sum, row) => sum + Number(row.total ?? 0), 0) ?? 0;

  async function commitConfig(next: AiLabConfig, success = "Konfigurasi AI Lab tersimpan") {
    if (!configData?.id) {
      toast.error("Properti belum tersedia.");
      return;
    }
    await updateConfig({ data: { id: configData.id, config: next as unknown as Record<string, unknown> } });
    toast.success(success);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["ai-lab-config"] }),
      qc.invalidateQueries({ queryKey: ["ai-lab-control-snapshot"] }),
      qc.invalidateQueries({ queryKey: ["ai-lab-agent-quality"] }),
    ]);
  }

  const setAllAutoReply = (mode: "pause" | "safe" | "full") => {
    const next = structuredClone(config) as AiLabConfig;
    for (const agent of AGENTS) {
      const current = next.agents[agent.key];
      if (!current) continue;
      if (mode === "pause") current.autoReply = false;
      if (mode === "safe") current.autoReply = agent.safeAuto && current.enabled;
      if (mode === "full") current.autoReply = current.enabled;
    }
    const label = mode === "pause" ? "Semua auto reply dipause" : mode === "safe" ? "Safe Auto Reply aktif" : "Full Auto Reply aktif";
    void commitConfig(next, label);
  };

  return (
    <div className="min-h-[100dvh] bg-[#070b14] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#090f1c]/95 backdrop-blur">
        <div className="flex min-h-[72px] items-center gap-3 px-4 md:px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold md:text-lg">WhatsApp AI Control Room</h1>
            <p className="truncate text-xs text-slate-400">Pomah Guesthouse • AI Lab Operasional</p>
          </div>
          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <StatusPill snapshot={snapshot} configLoading={configLoading} />
            <Button size="sm" variant="outline" className="border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20" onClick={() => setAllAutoReply("pause")}>
              <PauseCircle className="mr-2 h-4 w-4" /> Pause All
            </Button>
            <Button size="sm" variant="outline" className="border-sky-400/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20" onClick={() => setAllAutoReply("safe")}>
              <ShieldAlert className="mr-2 h-4 w-4" /> Safe Mode
            </Button>
            <Button size="sm" className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={() => setAllAutoReply("full")}>
              <PlayCircle className="mr-2 h-4 w-4" /> Full Auto
            </Button>
          </div>
          <Button size="icon" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => setDrawer("audit")}>
            <Bell className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1 border-t border-slate-800 px-2 py-2 lg:hidden">
          {[
            ["overview", "Overview"],
            ["flow", "Flow"],
            ["quality", "Quality"],
            ["settings", "Settings"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key as typeof mobileTab)}
              className={cn(
                "rounded-lg px-2 py-2 text-xs font-medium",
                mobileTab === key ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-400",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-4 p-3 md:p-5 xl:grid-cols-[232px_minmax(0,1fr)_340px]">
        <aside className="hidden space-y-3 xl:block">
          <ControlNav openDrawer={setDrawer} unread={snapshot?.unreadThreads ?? 0} />
          <SafetyCard snapshot={snapshot} onPause={() => setAllAutoReply("pause")} onSafe={() => setAllAutoReply("safe")} onFull={() => setAllAutoReply("full")} />
        </aside>

        <section className="min-w-0 space-y-4">
          {(mobileTab === "overview" || isDesktop()) && (
            <>
              <KpiStrip snapshot={snapshot} metrics={metrics} health={health} latestQueue={latestQueue} openDrawer={setDrawer} />
              <OperationalAlerts snapshot={snapshot} health={health} retryTotal={retryTotal} openDrawer={setDrawer} />
            </>
          )}
          {(mobileTab === "flow" || isDesktop()) && (
            <FlowMap selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} openDrawer={setDrawer} />
          )}
          {(mobileTab === "quality" || isDesktop()) && (
            <QualityScorePanel rows={quality ?? []} routing={routing} retryTotal={retryTotal} />
          )}
          {mobileTab === "settings" && (
            <SettingsPanel config={config} commitConfig={commitConfig} openDrawer={setDrawer} />
          )}
        </section>

        <aside className="hidden min-w-0 space-y-4 xl:block">
          <InspectorPanel selectedNode={selectedNode} config={config} snapshot={snapshot} openDrawer={setDrawer} />
          <AuditMiniPanel audit={audit} openDrawer={setDrawer} />
        </aside>
      </main>

      <FeatureDrawer
        drawer={drawer}
        setDrawer={setDrawer}
        config={config}
        commitConfig={commitConfig}
      />
    </div>
  );
}

function isDesktop() {
  return true;
}

function ControlNav({ openDrawer, unread }: { openDrawer: (drawer: DrawerKey) => void; unread: number }) {
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
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.drawer}
            onClick={() => openDrawer(item.drawer)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition hover:bg-slate-800/70 hover:text-white"
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.drawer === "inbox" && unread > 0 && (
              <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">{unread}</span>
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}

function SafetyCard({ snapshot, onPause, onSafe, onFull }: { snapshot?: AiLabControlSnapshot; onPause: () => void; onSafe: () => void; onFull: () => void }) {
  return (
    <Card className="rounded-2xl border-amber-400/20 bg-amber-500/10 p-4 text-amber-50">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-300" />
        <div>
          <p className="font-semibold">AI Safety Mode</p>
          <p className="mt-1 text-xs text-amber-100/80">Auto reply aktif di {snapshot?.autoReplyAgents ?? 0}/{snapshot?.totalAgents ?? 0} agent.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <Button size="sm" variant="outline" className="border-amber-400/30 bg-slate-950/50 text-amber-100 hover:bg-slate-900" onClick={onPause}>Pause All Auto Reply</Button>
        <Button size="sm" variant="outline" className="border-sky-400/30 bg-slate-950/50 text-sky-100 hover:bg-slate-900" onClick={onSafe}>Safe Auto Reply</Button>
        <Button size="sm" className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={onFull}>Full Auto Reply</Button>
      </div>
    </Card>
  );
}

function StatusPill({ snapshot, configLoading }: { snapshot?: AiLabControlSnapshot; configLoading: boolean }) {
  if (configLoading) return <Badge className="bg-slate-800 text-slate-300">Loading config</Badge>;
  if (snapshot?.globalAutoReplyPaused) {
    return <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">Auto Reply Paused</Badge>;
  }
  return <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Live • {snapshot?.autoReplyAgents ?? 0} auto agents</Badge>;
}

function KpiStrip({ snapshot, metrics, health, latestQueue, openDrawer }: { snapshot?: AiLabControlSnapshot; metrics: any; health: any; latestQueue: any; openDrawer: (drawer: DrawerKey) => void }) {
  const summary = metrics?.summary;
  const cards = [
    { label: "Unread Inbox", value: fmtNum(snapshot?.unreadMessages ?? 0), delta: `${fmtNum(snapshot?.unreadThreads ?? 0)} thread belum dibaca`, icon: Inbox, tone: "green" as Tone, drawer: "inbox" as DrawerKey },
    { label: "Conversations", value: fmtNum(summary?.waThreads ?? health?.delivery?.total ?? 0), delta: `${summary?.waConversionPct ?? 0}% conversion`, icon: MessageCircle, tone: "blue" as Tone, drawer: "health" as DrawerKey },
    { label: "Auto Agents", value: `${snapshot?.autoReplyAgents ?? 0}/${snapshot?.totalAgents ?? AGENTS.length}`, delta: snapshot?.globalAutoReplyPaused ? "paused" : "auto reply aktif", icon: Bot, tone: snapshot?.globalAutoReplyPaused ? "amber" as Tone : "cyan" as Tone, drawer: "settings" as DrawerKey },
    { label: "Response p50", value: fmtMsShort(health?.latency?.p50Ms ?? null), delta: `p95 ${fmtMsShort(health?.latency?.p95Ms ?? null)}`, icon: Clock, tone: "violet" as Tone, drawer: "health" as DrawerKey },
    { label: "Queue", value: `${snapshot?.queuePending ?? latestQueue?.queued ?? 0}`, delta: `${snapshot?.queueFailed ?? latestQueue?.failed ?? 0} failed`, icon: Gauge, tone: "rose" as Tone, drawer: "queue" as DrawerKey },
    { label: "Open Handoff", value: fmtNum(health?.openHandoffTickets ?? 0), delta: "butuh staf", icon: LifeBuoy, tone: "amber" as Tone, drawer: "inbox" as DrawerKey },
  ];
  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map((card) => (
        <button key={card.label} onClick={() => card.drawer && openDrawer(card.drawer)} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-left text-slate-100 transition hover:border-emerald-400/50">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneClass(card.tone, "bg"))}>
              <card.icon className={cn("h-4 w-4", toneClass(card.tone, "text"))} />
            </span>
            <Sparkline tone={card.tone} />
          </div>
          <p className="mt-3 truncate text-[11px] text-slate-400">{card.label}</p>
          <p className="mt-0.5 truncate text-2xl font-semibold tracking-tight text-white">{card.value}</p>
          <p className={cn("mt-0.5 truncate text-[10px]", toneClass(card.tone, "text"))}>{card.delta}</p>
        </button>
      ))}
    </section>
  );
}

function OperationalAlerts({ snapshot, health, retryTotal, openDrawer }: { snapshot?: AiLabControlSnapshot; health: any; retryTotal: number; openDrawer: (drawer: DrawerKey) => void }) {
  const alerts = [
    snapshot?.globalAutoReplyPaused ? { tone: "amber" as Tone, title: "Auto reply sedang pause", desc: "Semua tamu masuk mode manual/draft. Aman untuk investigasi.", drawer: "settings" as DrawerKey } : null,
    (snapshot?.queueFailed ?? 0) > 0 ? { tone: "rose" as Tone, title: "Ada queue failed", desc: `${snapshot?.queueFailed ?? 0} job gagal. Cek retry detail sebelum traffic ramai.`, drawer: "retry" as DrawerKey } : null,
    retryTotal > 0 ? { tone: "violet" as Tone, title: "Retry AI terdeteksi", desc: `${retryTotal} retry tercatat di rollup. Pantau latency/model.`, drawer: "retry" as DrawerKey } : null,
    (health?.openHandoffTickets ?? 0) > 0 ? { tone: "amber" as Tone, title: "Handoff terbuka", desc: `${health.openHandoffTickets} percakapan butuh staf.`, drawer: "inbox" as DrawerKey } : null,
  ].filter(Boolean) as Array<{ tone: Tone; title: string; desc: string; drawer: DrawerKey }>;

  if (alerts.length === 0) {
    return (
      <Card className="rounded-2xl border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-50">
        <div className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5 text-emerald-300" /><div><p className="font-semibold">Operational signal normal</p><p className="text-sm text-emerald-100/75">Tidak ada alert besar dari queue, retry, atau handoff.</p></div></div>
      </Card>
    );
  }

  return (
    <section className="grid gap-2 md:grid-cols-2">
      {alerts.map((alert) => (
        <button key={alert.title} onClick={() => alert.drawer && openDrawer(alert.drawer)} className={cn("rounded-2xl border p-4 text-left transition", toneBorder(alert.tone))}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={cn("mt-0.5 h-5 w-5", toneClass(alert.tone, "text"))} />
            <div><p className="font-semibold text-white">{alert.title}</p><p className="mt-1 text-sm text-slate-400">{alert.desc}</p></div>
          </div>
        </button>
      ))}
    </section>
  );
}

function FlowMap({ selectedNodeId, setSelectedNodeId, openDrawer }: { selectedNodeId: FlowNodeId; setSelectedNodeId: (id: FlowNodeId) => void; openDrawer: (drawer: DrawerKey) => void }) {
  return (
    <Card className="overflow-hidden rounded-2xl border-slate-800 bg-slate-950/70 p-0 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3"><Badge className="bg-slate-800 text-slate-300">Interactive Flow</Badge><div><h2 className="text-sm font-semibold text-white">WhatsApp AI Pipeline</h2><p className="text-xs text-slate-500">Klik node untuk lihat status, drawer, dan tindakan.</p></div></div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => openDrawer("routing")}><GitBranch className="mr-2 h-4 w-4" />Routing</Button>
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => openDrawer("simulator")}><PlayCircle className="mr-2 h-4 w-4" />Simulator</Button>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {FLOW_NODES.map((node, idx) => (
          <button
            key={node.id}
            onClick={() => {
              setSelectedNodeId(node.id);
              if (node.drawer && ["queue", "routing", "simulator", "knowledge"].includes(node.drawer)) openDrawer(node.drawer);
            }}
            className={cn(
              "relative rounded-xl border bg-slate-900/50 p-4 text-left transition hover:border-emerald-400/50",
              selectedNodeId === node.id ? "border-emerald-400 shadow-[0_0_26px_rgba(16,185,129,.18)]" : "border-slate-800",
            )}
          >
            <div className="flex items-start gap-3">
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneClass(node.tone, "bg"))}><node.icon className={cn("h-5 w-5", toneClass(node.tone, "text"))} /></span>
              <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs text-slate-500">{idx + 1}</span><Badge className={toneClass(node.tone, "badge")}>{node.status}</Badge></div><p className="mt-2 font-semibold text-white">{node.title}</p><p className="mt-1 text-xs text-slate-400">{node.desc}</p></div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
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
        <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Quality Score</p><h2 className="mt-1 text-lg font-semibold text-white">Agent performance signal</h2></div><Badge className="bg-slate-800 text-slate-300">Retry total {retryTotal}</Badge></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const agent = AGENTS.find((a) => a.key === row.agentKey);
            const Icon = agent?.icon ?? Bot;
            return (
              <div key={row.agentKey} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-emerald-300" /><span className="font-semibold text-white">{agent?.name ?? row.agentKey}</span></span><ScoreBadge score={row.score} /></div>
                <p className="mt-2 text-xs text-slate-400">{row.signal}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${row.score}%` }} /></div>
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
            <div key={intent} className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 last:border-0"><span className="truncate text-sm text-slate-300">{prettyIntent(intent)}</span><Badge className="bg-slate-800 text-slate-300">{count}</Badge></div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function InspectorPanel({ selectedNode, config, snapshot, openDrawer }: { selectedNode: FlowNode; config: AiLabConfig; snapshot?: AiLabControlSnapshot; openDrawer: (drawer: DrawerKey) => void }) {
  const agent = AGENTS.find((a) => a.key === selectedNode.id);
  const agentConfig = agent ? config.agents[agent.key] : null;
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-start gap-3"><span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", toneClass(selectedNode.tone, "bg"))}><selectedNode.icon className={cn("h-5 w-5", toneClass(selectedNode.tone, "text"))} /></span><div><p className="font-semibold text-white">{selectedNode.title}</p><p className="mt-1 text-xs text-slate-400">{selectedNode.desc}</p></div></div>
      <div className="mt-4 space-y-2 text-sm">
        <MetricRow label="Status" value={selectedNode.status} />
        {agentConfig && <MetricRow label="Agent active" value={agentConfig.enabled ? "Yes" : "Off"} tone={agentConfig.enabled ? "green" : undefined} />}
        {agentConfig && <MetricRow label="Auto reply" value={agentConfig.autoReply ? "Auto" : "Manual"} tone={agentConfig.autoReply ? "green" : undefined} />}
        {selectedNode.id === "queue" && <MetricRow label="Pending / Failed" value={`${snapshot?.queuePending ?? 0} / ${snapshot?.queueFailed ?? 0}`} />}
        {selectedNode.id === "incoming" && <MetricRow label="Unread" value={`${snapshot?.unreadMessages ?? 0} pesan`} />}
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
    const next = structuredClone(config) as AiLabConfig;
    next.agents[key] = { ...next.agents[key], ...patch };
    void commitConfig(next, `${AGENTS.find((a) => a.key === key)?.name ?? key} diperbarui`);
  };
  const updateTool = (key: string, enabled: boolean) => {
    const next = structuredClone(config) as AiLabConfig;
    next.tools[key] = { ...next.tools[key], enabled };
    void commitConfig(next, `${TOOLS.find((t) => t.key === key)?.name ?? key} diperbarui`);
  };
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Agents</p><h2 className="mt-1 text-lg font-semibold text-white">Auto Reply & Safety</h2></div><Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => openDrawer("audit")}>Audit Trail</Button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENTS.map((agent) => {
            const c = config.agents[agent.key];
            return (
              <div key={agent.key} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300"><agent.icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="font-semibold text-white">{agent.name}</p><p className="text-xs text-slate-400">{agent.desc}</p></div></div>
                <div className="mt-4 space-y-3"><SettingSwitch title="Active" checked={!!c?.enabled} onChange={(v) => updateAgent(agent.key, { enabled: v })} /><SettingSwitch title="Auto Reply" checked={!!c?.autoReply} onChange={(v) => updateAgent(agent.key, { autoReply: v })} /></div>
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
            return <div key={tool.key} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4"><tool.icon className="h-5 w-5 text-sky-300" /><p className="mt-3 text-sm font-semibold text-white">{tool.name}</p><p className="mt-1 text-xs text-slate-500">{c?.enabled ? "Enabled" : "Disabled"}</p><div className="mt-3"><Switch checked={!!c?.enabled} onCheckedChange={(v) => updateTool(tool.key, v)} /></div></div>;
          })}
        </div>
      </Card>
    </div>
  );
}

function SettingSwitch({ title, checked, onChange }: { title: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2"><span className="text-sm text-slate-300">{title}</span><Switch checked={checked} onCheckedChange={onChange} /></div>;
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
        {m && drawer && <div className="flex h-full min-h-0 flex-col"><SheetHeader className="border-b border-slate-800 px-5 py-4 text-left"><SheetTitle className="text-white">{m.title}</SheetTitle><SheetDescription className="text-slate-400">{m.desc}</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto"><DrawerContent drawer={drawer} config={config} commitConfig={commitConfig} /></div></div>}
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
      <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" /><div><p className="font-semibold">Simulator Safety Gate</p><p className="mt-1 text-sm text-amber-100/80">Simulator memakai pipeline asli. Gunakan nomor test khusus dan cek hasil booking dengan label simulator sebelum merge ke produksi.</p></div></div>
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
      <div className="flex flex-wrap items-end gap-3"><div className="min-w-[240px] flex-1"><Label className="text-violet-100">RAG retrieval preview</Label><Input value={query} onChange={(e) => setQuery(e.target.value)} className="mt-2 border-slate-700 bg-slate-950 text-white" /></div><Button onClick={runPreview} disabled={loading} className="bg-violet-500 text-white hover:bg-violet-400"><Search className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Preview</Button></div>
      <div className="mt-4 space-y-2">
        {rows.length === 0 && <p className="text-sm text-violet-100/70">Masukkan pertanyaan tamu lalu klik Preview untuk melihat contoh training yang kemungkinan tersuntik ke prompt.</p>}
        {rows.map((row) => <div key={row.id} className="rounded-xl border border-violet-400/20 bg-slate-950/70 p-3"><div className="flex items-center justify-between gap-3"><Badge className={row.used ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-300"}>{row.used ? "Dipakai" : "Cadangan"}</Badge><span className="text-xs text-slate-500">match {row.lexicalScore}%</span></div><p className="mt-2 text-sm text-white">{row.userMessage || "(tanpa user message)"}</p><p className="mt-1 line-clamp-2 text-xs text-slate-400">{row.idealResponse || "Belum ada ideal response"}</p></div>)}
      </div>
    </Card>
  );
}

function AuditTrailPanel() {
  const auditFn = useServerFn(getAiLabAuditTrail);
  const { data, isFetching, refetch } = useQuery({ queryKey: ["ai-lab-audit-trail-full"], queryFn: () => auditFn() });
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Audit Trail</p><h2 className="mt-1 text-lg font-semibold text-white">Prompt & setting history</h2></div><Button size="sm" variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => refetch()}><RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />Refresh</Button></div>
      {!data?.installed && <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">Tabel audit belum terpasang atau belum ada perubahan tercatat. Fondasi UI sudah siap; jalankan migration audit sebelum mengaktifkan rollback penuh.</div>}
      <div className="mt-4 space-y-2">{data?.rows?.map((row) => <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium text-white">{row.section}</p><span className="text-xs text-slate-500">{fmtDate(row.changedAt)}</span></div><p className="mt-1 text-xs text-slate-400">{row.reason} • {row.changedBy}</p></div>)}</div>
    </Card>
  );
}

function AuditMiniPanel({ audit, openDrawer }: { audit: any; openDrawer: (drawer: DrawerKey) => void }) {
  return (
    <Card className="rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100">
      <div className="flex items-center justify-between"><p className="font-semibold text-white">Audit</p><Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800" onClick={() => openDrawer("audit")}>Open</Button></div>
      <p className="mt-2 text-sm text-slate-400">{audit?.installed ? `${audit.rows.length} perubahan terakhir` : "Audit table belum aktif"}</p>
    </Card>
  );
}

function DarkDrawerBody({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 bg-[#070b14] p-4 text-slate-100 [&_.bg-background]:bg-slate-950 [&_.text-foreground]:text-slate-100">{children}</div>;
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return <div className="flex items-center justify-between border-b border-slate-800/70 pb-2 last:border-0 last:pb-0"><span className="text-slate-500">{label}</span><span className={cn("font-medium text-slate-200", tone === "green" && "text-emerald-300")}>{value}</span></div>;
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 85 ? "bg-emerald-500/15 text-emerald-300" : score >= 70 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300";
  return <Badge className={cls}>{score}</Badge>;
}

function Sparkline({ tone }: { tone: Tone }) {
  const stroke = tone === "rose" ? "#fb7185" : tone === "amber" ? "#f59e0b" : tone === "violet" ? "#a78bfa" : "#34d399";
  return <svg viewBox="0 0 72 24" className="h-5 w-14 opacity-80"><polyline points="0,18 8,16 16,20 24,12 32,14 40,8 48,11 56,5 64,9 72,3" fill="none" stroke={stroke} strokeWidth="2" /></svg>;
}

function toneClass(tone: Tone, part: "bg" | "text" | "badge") {
  const map: Record<Tone, Record<typeof part, string>> = {
    green: { bg: "bg-emerald-500/15", text: "text-emerald-300", badge: "bg-emerald-500/15 text-emerald-300" },
    blue: { bg: "bg-sky-500/15", text: "text-sky-300", badge: "bg-sky-500/15 text-sky-300" },
    violet: { bg: "bg-violet-500/15", text: "text-violet-300", badge: "bg-violet-500/15 text-violet-300" },
    amber: { bg: "bg-amber-500/15", text: "text-amber-300", badge: "bg-amber-500/15 text-amber-300" },
    rose: { bg: "bg-rose-500/15", text: "text-rose-300", badge: "bg-rose-500/15 text-rose-300" },
    cyan: { bg: "bg-cyan-500/15", text: "text-cyan-300", badge: "bg-cyan-500/15 text-cyan-300" },
    slate: { bg: "bg-slate-700/60", text: "text-slate-300", badge: "bg-slate-800 text-slate-300" },
  } as const;
  return map[tone][part];
}

function toneBorder(tone: Tone) {
  if (tone === "rose") return "border-rose-400/20 bg-rose-500/10";
  if (tone === "amber") return "border-amber-400/20 bg-amber-500/10";
  if (tone === "violet") return "border-violet-400/20 bg-violet-500/10";
  return "border-slate-800 bg-slate-950/70";
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
