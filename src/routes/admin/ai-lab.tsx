import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ChevronRight,
  ClipboardList,
  Clock,
  Database,
  Gauge,
  GitBranch,
  Headphones,
  Inbox,
  LifeBuoy,
  LineChart,
  MessageCircle,
  MessageSquare,
  Network,
  PlayCircle,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  UserCog,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

import { getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import { getChatbotHealthSnapshot } from "@/admin/functions/health.functions";
import {
  getAgentRoutingStats,
  getIntentCallHistory,
} from "@/admin/functions/routing-debug.functions";
import {
  evaluateRecentWhatsAppConversations,
  promoteEvaluationToTrainingExample,
  type ChatbotEvaluationRow,
} from "@/admin/functions/chatbot-evaluation.functions";
import {
  getAiLabConfig,
  updateAiLabConfig,
  mergeAiLabConfig,
  AGENT_DEFAULTS,
  TOOL_DEFAULTS,
  type AiLabConfig,
} from "@/admin/modules/ai-lab/ai-lab.functions";
import {
  getQueueMetricsStats,
  getRetryStats,
} from "@/admin/modules/ai-lab/ai-lab.functions";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/ai-lab")({
  component: AiLab,
});

type ControlSection =
  | "dashboard"
  | "flows"
  | "agents"
  | "inbox"
  | "analytics"
  | "knowledge"
  | "settings";

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
  | null;

type InspectorTab = "inspector" | "executions" | "logs";
type ConfigEdit = { type: "agent" | "tool"; key: string } | null;

interface FlowNode {
  id: string;
  title: string;
  subtitle: string;
  column: number;
  row: number;
  icon: ComponentType<{ className?: string }>;
  tone: "green" | "blue" | "violet" | "amber" | "rose" | "cyan" | "slate";
  status: "Trigger" | "Active" | "Auto" | "Manual" | "Optional";
}

const INTERNAL_NAV: Array<{
  key: ControlSection;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { key: "dashboard", label: "Dashboard", icon: Gauge },
  { key: "flows", label: "Flows", icon: GitBranch },
  { key: "agents", label: "Agents", icon: Bot },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "knowledge", label: "Knowledge Base", icon: BookOpen },
  { key: "settings", label: "Settings", icon: Settings },
];

const FLOW_NODES: FlowNode[] = [
  {
    id: "incoming",
    title: "Incoming WhatsApp Message",
    subtitle: "Evolution Webhook",
    column: 1,
    row: 3,
    icon: MessageCircle,
    tone: "green",
    status: "Trigger",
  },
  {
    id: "parser",
    title: "Webhook Parser",
    subtitle: "Normalize phone, LID/JID",
    column: 2,
    row: 2,
    icon: Network,
    tone: "cyan",
    status: "Auto",
  },
  {
    id: "queue",
    title: "Queue + Smart Delay",
    subtitle: "Dedup & debounce",
    column: 2,
    row: 4,
    icon: Clock,
    tone: "blue",
    status: "Auto",
  },
  {
    id: "intent",
    title: "Intent Detection AI",
    subtitle: "Classify message",
    column: 3,
    row: 3,
    icon: Brain,
    tone: "violet",
    status: "Active",
  },
  {
    id: "router",
    title: "Router",
    subtitle: "Intent -> Agent",
    column: 4,
    row: 3,
    icon: GitBranch,
    tone: "cyan",
    status: "Auto",
  },
  {
    id: "front-office",
    title: "Front Office Agent",
    subtitle: "Booking, availability, guest FAQ",
    column: 5,
    row: 1,
    icon: Users,
    tone: "cyan",
    status: "Active",
  },
  {
    id: "pricing",
    title: "Pricing Agent",
    subtitle: "Price inquiry",
    column: 5,
    row: 2,
    icon: Wallet,
    tone: "blue",
    status: "Active",
  },
  {
    id: "customer-care",
    title: "Customer Care Agent",
    subtitle: "Service request",
    column: 5,
    row: 3,
    icon: Headphones,
    tone: "green",
    status: "Active",
  },
  {
    id: "finance",
    title: "Finance Agent",
    subtitle: "Payment / invoice",
    column: 5,
    row: 4,
    icon: ClipboardList,
    tone: "amber",
    status: "Active",
  },
  {
    id: "manager",
    title: "Manager Agent",
    subtitle: "Escalation / admin command",
    column: 5,
    row: 5,
    icon: ShieldAlert,
    tone: "rose",
    status: "Manual",
  },
  {
    id: "content",
    title: "Content Agent",
    subtitle: "SEO / city guide optional",
    column: 5,
    row: 6,
    icon: Sparkles,
    tone: "slate",
    status: "Optional",
  },
  {
    id: "availability",
    title: "Check Availability",
    subtitle: "Check slots",
    column: 6,
    row: 1,
    icon: CalendarCheck,
    tone: "green",
    status: "Auto",
  },
  {
    id: "create-booking",
    title: "Create Booking",
    subtitle: "Add to calendar",
    column: 6,
    row: 2,
    icon: CalendarCheck,
    tone: "blue",
    status: "Manual",
  },
  {
    id: "send-reply",
    title: "Send Reply",
    subtitle: "WhatsApp message",
    column: 6,
    row: 3,
    icon: Send,
    tone: "green",
    status: "Auto",
  },
  {
    id: "notify-manager",
    title: "Notify Manager",
    subtitle: "Internal notification",
    column: 6,
    row: 4,
    icon: Bell,
    tone: "amber",
    status: "Auto",
  },
  {
    id: "human",
    title: "Escalate to Human",
    subtitle: "Live agent handover",
    column: 6,
    row: 5,
    icon: LifeBuoy,
    tone: "rose",
    status: "Manual",
  },
  {
    id: "rag",
    title: "RAG / SOP Lookup",
    subtitle: "Knowledge context",
    column: 6,
    row: 6,
    icon: Database,
    tone: "violet",
    status: "Auto",
  },
];

const AGENT_CONFIGS = [
  { key: "front-office", name: "Front Office Agent", desc: "Booking, availability, guest FAQ", icon: Users },
  { key: "pricing", name: "Pricing Agent", desc: "Price inquiry and pricing clarity", icon: Wallet },
  { key: "customer-care", name: "Customer Care Agent", desc: "Service request and complaints", icon: Headphones },
  { key: "finance", name: "Finance Agent", desc: "Payment, proof, invoice", icon: ClipboardList },
  { key: "manager", name: "Manager Agent", desc: "Escalation and admin command", icon: ShieldAlert },
  { key: "content", name: "Content Agent", desc: "City guide and public content", icon: Sparkles },
];

const TOOL_CONFIGS = [
  { key: "pms-database", name: "PMS Database", icon: Database },
  { key: "room-availability", name: "Room Availability", icon: CalendarCheck },
  { key: "sop-knowledge", name: "SOP Knowledge", icon: BookOpen },
  { key: "pricing-engine", name: "Pricing Engine", icon: LineChart },
  { key: "faq-memory", name: "FAQ Memory", icon: Brain },
];

function AiLab() {
  const [section, setSection] = useState<ControlSection>("dashboard");
  const [drawer, setDrawer] = useState<DrawerKey>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("front-office");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("inspector");
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const panel = params.get("panel") ?? params.get("view");
    const map: Record<string, DrawerKey> = {
      training: "training",
      corrections: "training",
      health: "health",
      routing: "routing",
      telegram: "telegram",
      knowledge: "knowledge",
      rag: "knowledge",
      settings: "settings",
      queue: "queue",
      retry: "retry",
      whatsapp: "inbox",
      inbox: "inbox",
    };
    if (panel && map[panel]) setDrawer(map[panel]);
  }, []);

  const selectedNode = useMemo(
    () => FLOW_NODES.find((n) => n.id === selectedNodeId) ?? FLOW_NODES[0],
    [selectedNodeId],
  );

  return (
    <div className="h-[100dvh] overflow-hidden bg-[#070b14] text-slate-100">
      <div className="flex h-full min-h-0">
        <ControlSidebar
          section={section}
          setSection={setSection}
          openDrawer={setDrawer}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Topbar inspectorOpen={inspectorOpen} setInspectorOpen={setInspectorOpen} />
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3",
              inspectorOpen && "xl:grid-cols-[minmax(0,1fr)_320px]",
            )}
          >
            <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain pb-6 pr-0 xl:pr-1">
              <KpiStrip openDrawer={setDrawer} />
              <FlowCanvas
                selectedNodeId={selectedNodeId}
                setSelectedNodeId={setSelectedNodeId}
                openDrawer={setDrawer}
              />
              <BottomAnalytics openDrawer={setDrawer} />
            </div>
            {inspectorOpen && (
              <InspectorPanel
                tab={inspectorTab}
                setTab={setInspectorTab}
                selectedNode={selectedNode}
                openDrawer={setDrawer}
                onHide={() => setInspectorOpen(false)}
              />
            )}
          </div>
        </main>
      </div>
      <FeatureDrawer drawer={drawer} setDrawer={setDrawer} />
    </div>
  );
}

function ControlSidebar({
  section,
  setSection,
  openDrawer,
}: {
  section: ControlSection;
  setSection: (section: ControlSection) => void;
  openDrawer: (drawer: DrawerKey) => void;
}) {
  const unread = 12;
  return (
    <aside className="hidden w-[232px] shrink-0 border-r border-slate-800/80 bg-[#090f1c] lg:flex lg:flex-col">
      <div className="border-b border-slate-800/80 px-5 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30">
            <MessageCircle className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-sm font-semibold">WhatsApp AI</h1>
            <p className="text-xs text-slate-400">Control Room</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {INTERNAL_NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setSection(item.key);
              if (item.key === "inbox") openDrawer("inbox");
              if (item.key === "knowledge") openDrawer("knowledge");
              if (item.key === "settings") openDrawer("settings");
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
              section === item.key
                ? "bg-emerald-500/12 text-white shadow-[0_0_24px_rgba(16,185,129,0.12)] ring-1 ring-emerald-400/20"
                : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100",
            )}
          >
            <item.icon className="h-4 w-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.key === "inbox" && (
              <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                {unread}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="space-y-3 border-t border-slate-800/80 p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Environment</span>
            <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">Live</Badge>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-[78%] rounded-full bg-emerald-400" />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">78% / 10K msgs</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            className="bg-slate-800 text-slate-100 hover:bg-slate-700"
            onClick={() => openDrawer("training")}
          >
            Training
          </Button>
          <Button
            size="sm"
            className="bg-slate-800 text-slate-100 hover:bg-slate-700"
            onClick={() => openDrawer("health")}
          >
            Health
          </Button>
        </div>
      </div>
    </aside>
  );
}

function Topbar({
  inspectorOpen,
  setInspectorOpen,
}: {
  inspectorOpen: boolean;
  setInspectorOpen: (open: boolean) => void;
}) {
  return (
    <header className="flex min-h-[72px] items-center gap-3 border-b border-slate-800/80 bg-[#090f1c]/95 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3 lg:hidden">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
          <MessageCircle className="h-5 w-5" />
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold md:text-lg">WhatsApp AI Control Room</h2>
        <p className="truncate text-xs text-slate-400">Pomah Guesthouse Workspace</p>
      </div>
      <div className="mx-auto hidden w-full max-w-[540px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 md:flex">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-500"
          placeholder="Search flows, agents, intents..."
        />
        <kbd className="rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</kbd>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="hidden border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white xl:inline-flex"
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          {inspectorOpen ? "Hide Inspector" : "Show Inspector"}
        </Button>
        <span className="hidden items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 sm:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.9)]" />
          Live
          <Activity className="h-3.5 w-3.5" />
        </span>
        <Button size="icon" variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="hidden items-center gap-3 border-l border-slate-800 pl-3 md:flex">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-300 to-sky-400 text-sm font-bold text-slate-950">
            PG
          </div>
          <div>
            <p className="text-sm font-medium">Pomah Admin</p>
            <p className="text-xs text-slate-500">Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}

function KpiStrip({ openDrawer }: { openDrawer: (drawer: DrawerKey) => void }) {
  const metricsFn = useServerFn(getDashboardMetrics);
  const healthFn = useServerFn(getChatbotHealthSnapshot);
  const queueFn = useServerFn(getQueueMetricsStats);
  const { data: metrics } = useQuery({ queryKey: ["control-room-dashboard"], queryFn: () => metricsFn() });
  const { data: health } = useQuery({ queryKey: ["control-room-health"], queryFn: () => healthFn(), refetchInterval: 60_000 });
  const { data: queue } = useQuery({ queryKey: ["control-room-queue-stats"], queryFn: () => queueFn() });

  const latestQueue = queue?.[0];
  const summary = metrics?.summary;
  const cards = [
    {
      label: "Conversations Today",
      value: fmtNum(summary?.waThreads ?? health?.delivery.total ?? 0),
      delta: `${summary?.waConversionPct ?? 0}% conversion`,
      icon: MessageCircle,
      tone: "green",
    },
    {
      label: "Auto-resolved",
      value: fmtNum(summary?.aiUsed30d ?? 0),
      delta: `${summary?.aiAdoptionPct ?? 0}% of AI replies`,
      icon: CheckCircle2,
      tone: "blue",
    },
    {
      label: "Escalations",
      value: fmtNum(health?.openHandoffTickets ?? 0),
      delta: "open handoff tickets",
      icon: Headphones,
      tone: "amber",
    },
    {
      label: "Avg Response Time",
      value: fmtMsShort(health?.latency.p50Ms ?? null),
      delta: `p95 ${fmtMsShort(health?.latency.p95Ms ?? null)}`,
      icon: Clock,
      tone: "violet",
    },
    {
      label: "Active Agents",
      value: "6 / 6",
      delta: "All systems operational",
      icon: Bot,
      tone: "cyan",
    },
    {
      label: "Queue Pending / Failed",
      value: `${health?.queue.pending ?? latestQueue?.queued ?? 0} / ${
        health?.queue.terminalFailures ?? latestQueue?.failed ?? 0
      }`,
      delta: "click for queue health",
      icon: Gauge,
      tone: "rose",
      onClick: () => openDrawer("queue"),
    },
  ];

  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <ControlCard
          key={card.label}
          className={cn("rounded-xl p-3", card.onClick && "cursor-pointer hover:border-emerald-400/50")}
          onClick={card.onClick}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneClass(card.tone, "bg"))}>
              <card.icon className={cn("h-4 w-4", toneClass(card.tone, "text"))} />
            </span>
            <Sparkline tone={card.tone} />
          </div>
          <p className="mt-2 truncate text-[11px] text-slate-400">{card.label}</p>
          <p className="mt-0.5 truncate text-xl font-semibold tracking-tight text-white">{card.value}</p>
          <p className={cn("mt-0.5 truncate text-[10px]", toneClass(card.tone, "text"))}>{card.delta}</p>
        </ControlCard>
      ))}
    </section>
  );
}

function FlowCanvas({
  selectedNodeId,
  setSelectedNodeId,
  openDrawer,
}: {
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  openDrawer: (drawer: DrawerKey) => void;
}) {
  return (
    <ControlCard className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800">Flow</Badge>
          <div>
            <h3 className="text-sm font-semibold text-white">WhatsApp Customer Support</h3>
            <p className="text-xs text-slate-500">Incoming message &gt; AI routing &gt; tools &gt; reply</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Auto-saved 2s ago
          </span>
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => openDrawer("routing")}>
            <GitBranch className="mr-2 h-4 w-4" />
            Routing
          </Button>
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => openDrawer("simulator")}>
            <PlayCircle className="mr-2 h-4 w-4" />
            Simulator
          </Button>
        </div>
      </div>

      <div
        className="relative min-h-[520px] overflow-auto"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        <div className="relative min-w-[1180px] px-6 py-6">
          <CanvasConnectors />
          <div className="grid grid-cols-6 gap-x-7 gap-y-4">
            {Array.from({ length: 36 }).map((_, index) => {
              const column = (index % 6) + 1;
              const row = Math.floor(index / 6) + 1;
              const node = FLOW_NODES.find((n) => n.column === column && n.row === row);
              return (
                <div key={`${column}-${row}`} className="min-h-[76px]">
                  {node && (
                    <FlowNodeCard
                      node={node}
                      selected={selectedNodeId === node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ControlCard>
  );
}

function CanvasConnectors() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full min-w-[1180px]" aria-hidden="true">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[
        ["17%", "50%", "32%", "35%"],
        ["17%", "50%", "32%", "65%"],
        ["34%", "35%", "49%", "50%"],
        ["34%", "65%", "49%", "50%"],
        ["51%", "50%", "66%", "50%"],
        ["68%", "50%", "83%", "13%"],
        ["68%", "50%", "83%", "28%"],
        ["68%", "50%", "83%", "43%"],
        ["68%", "50%", "83%", "58%"],
        ["68%", "50%", "83%", "73%"],
        ["68%", "50%", "83%", "88%"],
      ].map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="rgba(52,211,153,.65)"
          strokeWidth="2"
          strokeDasharray={i > 4 ? "4 5" : undefined}
          filter="url(#glow)"
        />
      ))}
    </svg>
  );
}

function FlowNodeCard({
  node,
  selected,
  onClick,
}: {
  node: FlowNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex h-[76px] w-full items-center gap-3 rounded-xl border bg-slate-950/90 px-3 text-left transition",
        selected
          ? "border-emerald-400 shadow-[0_0_26px_rgba(16,185,129,.28)]"
          : "border-slate-800 hover:border-slate-600 hover:bg-slate-900/90",
      )}
    >
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneClass(node.tone, "bg"))}>
        <node.icon className={cn("h-5 w-5", toneClass(node.tone, "text"))} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">{node.title}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">{node.subtitle}</span>
        <span className={cn("mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold", toneClass(node.tone, "badge"))}>
          {node.status}
        </span>
      </span>
      {selected && <span className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-emerald-300" />}
    </button>
  );
}

function InspectorPanel({
  tab,
  setTab,
  selectedNode,
  openDrawer,
  onHide,
}: {
  tab: InspectorTab;
  setTab: (tab: InspectorTab) => void;
  selectedNode: FlowNode;
  openDrawer: (drawer: DrawerKey) => void;
  onHide: () => void;
}) {
  const routingFn = useServerFn(getAgentRoutingStats);
  const historyFn = useServerFn(getIntentCallHistory);
  const { data: routing } = useQuery({ queryKey: ["control-room-routing"], queryFn: () => routingFn() });
  const { data: recentBooking } = useQuery({
    queryKey: ["control-room-booking-history"],
    queryFn: () => historyFn({ data: { intent: "booking_inquiry", limit: 5 } }),
  });

  const topIntents = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of routing?.rows ?? []) totals.set(row.intent, (totals.get(row.intent) ?? 0) + row.count);
    const rows = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const total = rows.reduce((sum, [, count]) => sum + count, 0) || 1;
    return rows.map(([intent, count]) => ({ intent, count, pct: Math.round((count / total) * 100) }));
  }, [routing]);

  const executions = recentBooking?.items ?? [];

  return (
    <aside className="hidden min-h-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 xl:block">
      <Tabs value={tab} onValueChange={(v) => setTab(v as InspectorTab)} className="flex h-full min-h-0 flex-col">
        <div className="border-b border-slate-800 px-3 py-3">
          <div className="flex items-center gap-2">
            <TabsList className="grid flex-1 grid-cols-3 bg-slate-900">
              <TabsTrigger value="inspector">Inspector</TabsTrigger>
              <TabsTrigger value="executions">Executions</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={onHide}
            >
              Hide
            </Button>
          </div>
        </div>

        <TabsContent value="inspector" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <ControlCard>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Live Intent Insights</h3>
              <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">LIVE</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {(topIntents.length ? topIntents : fallbackIntents()).map((row) => (
                <div key={row.intent}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="truncate text-slate-300">{prettyIntent(row.intent)}</span>
                    <span className="text-slate-500">{row.pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </ControlCard>

          <ControlCard>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Selected Node</p>
            <div className="mt-3 flex items-start gap-3">
              <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", toneClass(selectedNode.tone, "bg"))}>
                <selectedNode.icon className={cn("h-5 w-5", toneClass(selectedNode.tone, "text"))} />
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-white">{selectedNode.title}</h3>
                <p className="text-xs text-slate-400">{selectedNode.subtitle}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <MetricRow label="Status" value={selectedNode.status} tone="green" />
              <MetricRow label="Success Rate" value="96.7%" />
              <MetricRow label="Avg Response Time" value="1m 08s" />
              <MetricRow label="Executions Today" value={fmtNum(routing?.totalMessages ?? 0)} />
            </div>
            <Button className="mt-4 w-full bg-slate-800 text-white hover:bg-slate-700" onClick={() => openDrawer("routing")}>
              View Node Details
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </ControlCard>
        </TabsContent>

        <TabsContent value="executions" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {executions.length === 0 ? (
            <EmptyPanel text="Belum ada execution untuk intent booking terbaru." />
          ) : (
            executions.map((item: any) => (
              <ControlCard key={item.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{item.agentKey || item.agent || "Agent"}</p>
                    <p className="truncate text-xs text-slate-500">{item.request || "No request payload"}</p>
                  </div>
                  <Badge className={cn(item.isFallback ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300")}>
                    {item.isFallback ? "fallback" : "ok"}
                  </Badge>
                </div>
              </ControlCard>
            ))
          )}
        </TabsContent>

        <TabsContent value="logs" className="min-h-0 flex-1 overflow-y-auto p-4">
          <ControlCard>
            <h3 className="text-sm font-semibold text-white">Recent Execution Logs</h3>
            <div className="mt-3 space-y-2">
              {["Booking Agent", "Pricing Agent", "Complaint Agent", "Manager Agent", "FAQ Agent"].map((agent, index) => (
                <div key={agent} className="flex items-center justify-between rounded-lg bg-slate-900/80 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-300">
                    <span className={cn("h-2 w-2 rounded-full", index === 2 ? "bg-amber-400" : "bg-emerald-400")} />
                    {agent}
                  </span>
                  <span className="text-xs text-slate-500">{2 + index * 3}s ago</span>
                </div>
              ))}
            </div>
          </ControlCard>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function BottomAnalytics({ openDrawer }: { openDrawer: (drawer: DrawerKey) => void }) {
  const healthFn = useServerFn(getChatbotHealthSnapshot);
  const retryFn = useServerFn(getRetryStats);
  const { data: health } = useQuery({ queryKey: ["control-room-health-bottom"], queryFn: () => healthFn() });
  const { data: retries } = useQuery({ queryKey: ["control-room-retry-stats"], queryFn: () => retryFn() });
  const retryTotal = (retries ?? []).reduce((sum, row) => sum + (row.total ?? 0), 0);

  return (
    <section className="grid gap-3 xl:grid-cols-5">
      <ControlCard className="xl:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Conversations Over Time</h3>
          <Badge className="bg-slate-800 text-slate-300 hover:bg-slate-800">Today</Badge>
        </div>
        <div className="mt-5 h-24 rounded-xl bg-gradient-to-t from-emerald-500/20 to-transparent">
          <svg viewBox="0 0 340 96" className="h-full w-full">
            <polyline
              points="0,82 28,58 56,70 84,35 112,48 140,31 168,38 196,24 224,35 252,26 280,36 308,18 340,28"
              fill="none"
              stroke="#34d399"
              strokeWidth="3"
            />
          </svg>
        </div>
      </ControlCard>

      <ControlCard>
        <h3 className="text-sm font-semibold text-white">Resolution Breakdown</h3>
        <div className="mt-5 flex items-center gap-4">
          <Donut value={Math.round((health?.delivery.rate ?? 0.7) * 100)} />
          <div className="space-y-1 text-xs">
            <Legend color="bg-sky-400" label="Auto-resolved" value={`${Math.round((health?.delivery.rate ?? 0.7) * 100)}%`} />
            <Legend color="bg-violet-400" label="Human resolved" value="21%" />
            <Legend color="bg-amber-400" label="Escalated" value="9%" />
          </div>
        </div>
      </ControlCard>

      <ControlCard>
        <h3 className="text-sm font-semibold text-white">Top Intents</h3>
        <div className="mt-4 space-y-3">
          {fallbackIntents().slice(0, 5).map((row) => (
            <div key={row.intent} className="grid grid-cols-[1fr_70px] items-center gap-3 text-xs">
              <span className="truncate text-slate-400">{prettyIntent(row.intent)}</span>
              <div className="h-1.5 rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-sky-400" style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </ControlCard>

      <ControlCard className="cursor-pointer hover:border-emerald-400/50" onClick={() => openDrawer("health")}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Queue Health</h3>
          <RefreshCw className="h-4 w-4 text-slate-500" />
        </div>
        <p className="mt-4 text-3xl font-semibold text-white">{health?.queue.pending ?? 0}</p>
        <p className="mt-1 text-xs text-slate-400">pending / retrying</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="failed" value={health?.queue.terminalFailures ?? 0} tone="rose" />
          <MetricPill label="zombie" value={health?.queue.zombieCount ?? 0} tone="amber" />
        </div>
        <Button size="sm" className="mt-4 w-full bg-slate-800 text-white hover:bg-slate-700" onClick={(e) => { e.stopPropagation(); openDrawer("retry"); }}>
          Retry Detail
        </Button>
        <p className="mt-2 text-[11px] text-slate-500">Retry events: {retryTotal}</p>
      </ControlCard>
    </section>
  );
}

function FeatureDrawer({
  drawer,
  setDrawer,
}: {
  drawer: DrawerKey;
  setDrawer: (drawer: DrawerKey) => void;
}) {
  const titles: Record<Exclude<DrawerKey, null>, { title: string; desc: string }> = {
    training: {
      title: "Training & Evaluation",
      desc: "Curated examples, conversation logs, WhatsApp corrections, and auto evaluation.",
    },
    knowledge: {
      title: "Knowledge / RAG",
      desc: "SOP knowledge, training RAG settings, and retrieval controls.",
    },
    telegram: {
      title: "Managerial / Telegram Setup",
      desc: "Telegram bot per agent, manager linking, and agent channels.",
    },
    health: {
      title: "Health Detail",
      desc: "Delivery rate, latency, queue, handoff, and intent distribution.",
    },
    routing: {
      title: "Routing Detail",
      desc: "Intent to agent mapping, actual agent, mismatch warning, and recent calls.",
    },
    settings: {
      title: "Control Room Settings",
      desc: "Smart delay, agent toggles, tool enablement, prompt and persona config.",
    },
    inbox: {
      title: "WhatsApp Inbox",
      desc: "Human handoff and live guest conversation workspace.",
    },
    queue: {
      title: "Queue Health Detail",
      desc: "Queue latency, LLM duration, current jobs, and zombie monitoring.",
    },
    retry: {
      title: "Health & Retry Detail",
      desc: "AI gateway retry observability and failed response audit.",
    },
    simulator: {
      title: "Chat Simulator",
      desc: "Run a controlled WhatsApp turn using the same orchestration pipeline.",
    },
  };

  const meta = drawer ? titles[drawer] : null;
  return (
    <Sheet open={!!drawer} onOpenChange={(open) => !open && setDrawer(null)}>
      <SheetContent side="right" className="w-full overflow-hidden border-slate-800 bg-[#070b14] p-0 text-slate-100 sm:max-w-[980px]">
        {meta && (
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="border-b border-slate-800 px-5 py-4 text-left">
              <SheetTitle className="text-white">{meta.title}</SheetTitle>
              <SheetDescription className="text-slate-400">{meta.desc}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DrawerContent drawer={drawer as Exclude<DrawerKey, null>} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerContent({ drawer }: { drawer: Exclude<DrawerKey, null> }) {
  if (drawer === "training") {
    return (
      <DarkDrawerBody>
        <EvaluationCenter />
        <LegacyFrame>
          <TrainingPage />
        </LegacyFrame>
        <LegacyFrame>
          <WhatsappCorrectionsPage />
        </LegacyFrame>
      </DarkDrawerBody>
    );
  }
  if (drawer === "knowledge") {
    return (
      <DarkDrawerBody>
        <LegacyFrame>
          <SopKnowledgeView />
        </LegacyFrame>
        <LegacyFrame>
          <TrainingRagSettings />
        </LegacyFrame>
      </DarkDrawerBody>
    );
  }
  if (drawer === "telegram") return <LegacyFrame><TelegramPage /></LegacyFrame>;
  if (drawer === "health") return <LegacyFrame><HealthPage /></LegacyFrame>;
  if (drawer === "routing") return <LegacyFrame><RoutingDebugPage /></LegacyFrame>;
  if (drawer === "settings") return <SettingsCenter />;
  if (drawer === "inbox") return <LegacyFrame><WhatsAppPage /></LegacyFrame>;
  if (drawer === "queue") return <LegacyFrame><QueueMonitoringView /></LegacyFrame>;
  if (drawer === "retry") return <LegacyFrame><RetryObservabilityView /></LegacyFrame>;
  if (drawer === "simulator") return <LegacyFrame><ChatSimulatorView /></LegacyFrame>;
  return null;
}

function EvaluationCenter() {
  const qc = useQueryClient();
  const evalFn = useServerFn(evaluateRecentWhatsAppConversations);
  const promoteFn = useServerFn(promoteEvaluationToTrainingExample);
  const [limit, setLimit] = useState(20);
  const [editing, setEditing] = useState<ChatbotEvaluationRow | null>(null);
  const [ideal, setIdeal] = useState("");

  const query = useQuery({
    queryKey: ["chatbot-evaluations", limit],
    queryFn: () => evalFn({ data: { limit, windowDays: 7 } }),
  });

  const promote = useMutation({
    mutationFn: (row: ChatbotEvaluationRow) =>
      promoteFn({
        data: {
          user_message: row.userMessage,
          current_response: row.currentResponse,
          ideal_response: ideal.trim() || row.suggestedFix,
          intent: row.intent,
          agent_key: row.agent,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) toast.success("Evaluation dipromosikan ke training example");
      else toast.warning("Schema insert gagal; draft payload tersedia di response.");
      setEditing(null);
      setIdeal("");
      qc.invalidateQueries({ queryKey: ["chatbot-evaluations"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <ControlCard className="border-emerald-400/20 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Evaluation Center</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Auto Evaluation MVP</h3>
          <p className="text-sm text-slate-400">Heuristic score untuk percakapan WhatsApp terbaru.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 20)}
            className="h-9 w-20 border-slate-700 bg-slate-900 text-white"
          />
          <Button
            className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", query.isFetching && "animate-spin")} />
            Evaluate recent WhatsApp conversations
          </Button>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Thread</th>
              <th className="px-3 py-2">Guest</th>
              <th className="px-3 py-2">Intent</th>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Issue</th>
              <th className="px-3 py-2">Suggested fix</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {query.isLoading && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Memuat evaluasi...</td></tr>
            )}
            {!query.isLoading && (query.data?.evaluations.length ?? 0) === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Belum ada data evaluasi.</td></tr>
            )}
            {query.data?.evaluations.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="px-3 py-3 font-mono text-xs text-slate-400">{row.threadId?.slice(0, 8) ?? "-"}</td>
                <td className="px-3 py-3 text-slate-300">{row.guest}</td>
                <td className="px-3 py-3 text-slate-300">{prettyIntent(row.intent)}</td>
                <td className="px-3 py-3 text-slate-300">{row.agent}</td>
                <td className="px-3 py-3"><ScoreBadge score={row.score} /></td>
                <td className="max-w-[180px] px-3 py-3 text-slate-300">{row.issue}</td>
                <td className="max-w-[260px] px-3 py-3 text-slate-400">{row.suggestedFix}</td>
                <td className="px-3 py-3">
                  <Button
                    size="sm"
                    className="bg-slate-800 text-white hover:bg-slate-700"
                    onClick={() => {
                      setEditing(row);
                      setIdeal(row.currentResponse);
                    }}
                  >
                    Promote
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Promote to training example</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>User message</Label>
                <p className="mt-1 rounded-md bg-muted p-3 text-sm">{editing.userMessage || "-"}</p>
              </div>
              <div>
                <Label>Ideal response</Label>
                <Textarea rows={8} value={ideal} onChange={(e) => setIdeal(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={!editing || promote.isPending} onClick={() => editing && promote.mutate(editing)}>
              {promote.isPending ? "Saving..." : "Promote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ControlCard>
  );
}

function SettingsCenter() {
  const cfgFn = useServerFn(getAiLabConfig);
  const updateFn = useServerFn(updateAiLabConfig);
  const { data } = useQuery({ queryKey: ["ai-lab-config"], queryFn: () => cfgFn() });
  const [cfg, setCfg] = useState<AiLabConfig>(() => mergeAiLabConfig({}));
  const [edit, setEdit] = useState<ConfigEdit>(null);

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data]);

  const save = async () => {
    if (!data?.id) {
      toast.error("Properti belum tersedia.");
      return;
    }
    await updateFn({ data: { id: data.id, config: cfg as unknown as Record<string, unknown> } });
    toast.success("Konfigurasi AI tersimpan");
    setEdit(null);
  };

  return (
    <DarkDrawerBody>
      <ControlCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">Settings</p>
            <h3 className="mt-1 text-lg font-semibold text-white">Agents & Tools</h3>
            <p className="text-sm text-slate-400">Auto-reply toggle, tool enablement, prompt and persona config.</p>
          </div>
          <Button className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" onClick={() => setEdit({ type: "agent", key: "front-office" })}>
            Edit Front Office Prompt
          </Button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AGENT_CONFIGS.map((agent) => {
            const c = cfg.agents[agent.key];
            return (
              <button key={agent.key} onClick={() => setEdit({ type: "agent", key: agent.key })} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left hover:border-emerald-400/50">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
                    <agent.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{agent.name}</p>
                    <p className="text-xs text-slate-400">{agent.desc}</p>
                    <div className="mt-2 flex gap-1.5">
                      <Badge className={cn(c?.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700 text-slate-300")}>
                        {c?.enabled ? "Active" : "Off"}
                      </Badge>
                      <Badge className={cn(c?.autoReply ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300")}>
                        {c?.autoReply ? "Auto" : "Manual"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </ControlCard>

      <ControlCard>
        <h3 className="text-lg font-semibold text-white">Tool Enablement</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {TOOL_CONFIGS.map((tool) => {
            const c = cfg.tools[tool.key];
            return (
              <button key={tool.key} onClick={() => setEdit({ type: "tool", key: tool.key })} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-left hover:border-sky-400/50">
                <tool.icon className="h-5 w-5 text-sky-300" />
                <p className="mt-3 text-sm font-semibold text-white">{tool.name}</p>
                <p className="mt-1 text-xs text-slate-500">{c?.enabled ? "Enabled" : "Disabled"}</p>
              </button>
            );
          })}
        </div>
      </ControlCard>

      <LegacyFrame>
        <SmartDelaySettings />
      </LegacyFrame>
      <LegacyFrame>
        <IntentRulesView />
      </LegacyFrame>

      <ConfigDialog edit={edit} cfg={cfg} setCfg={setCfg} onClose={() => setEdit(null)} onSave={save} />
    </DarkDrawerBody>
  );
}

function ConfigDialog({
  edit,
  cfg,
  setCfg,
  onClose,
  onSave,
}: {
  edit: ConfigEdit;
  cfg: AiLabConfig;
  setCfg: Dispatch<SetStateAction<AiLabConfig>>;
  onClose: () => void;
  onSave: () => void;
}) {
  const agent = edit?.type === "agent" ? AGENT_CONFIGS.find((a) => a.key === edit.key) : null;
  const tool = edit?.type === "tool" ? TOOL_CONFIGS.find((t) => t.key === edit.key) : null;

  return (
    <Dialog open={!!edit} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent?.name ?? tool?.name ?? "Settings"}</DialogTitle>
        </DialogHeader>
        {agent && edit && (
          <div className="space-y-4">
            <SettingRow title="Active" desc="Agent ikut menangani percakapan.">
              <Switch
                checked={cfg.agents[edit.key]?.enabled ?? false}
                onCheckedChange={(enabled) =>
                  setCfg((c) => ({
                    ...c,
                    agents: { ...c.agents, [edit.key]: { ...c.agents[edit.key], enabled } },
                  }))
                }
              />
            </SettingRow>
            <SettingRow title="Auto Reply" desc="Jika mati, balasan menunggu persetujuan staf.">
              <Switch
                checked={cfg.agents[edit.key]?.autoReply ?? false}
                onCheckedChange={(autoReply) =>
                  setCfg((c) => ({
                    ...c,
                    agents: { ...c.agents, [edit.key]: { ...c.agents[edit.key], autoReply } },
                  }))
                }
              />
            </SettingRow>
            <div className="space-y-1.5">
              <Label>Persona name</Label>
              <Input
                value={cfg.agents[edit.key]?.managerName ?? ""}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    agents: {
                      ...c.agents,
                      [edit.key]: { ...c.agents[edit.key], managerName: e.target.value },
                    },
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Prompt / persona instructions</Label>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() =>
                    setCfg((c) => ({
                      ...c,
                      agents: {
                        ...c.agents,
                        [edit.key]: {
                          ...c.agents[edit.key],
                          instructions: AGENT_DEFAULTS[edit.key] ?? "",
                        },
                      },
                    }))
                  }
                >
                  Reset default
                </Button>
              </div>
              <Textarea
                rows={14}
                value={cfg.agents[edit.key]?.instructions ?? ""}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    agents: {
                      ...c.agents,
                      [edit.key]: { ...c.agents[edit.key], instructions: e.target.value },
                    },
                  }))
                }
              />
            </div>
          </div>
        )}
        {tool && edit && (
          <div className="space-y-4">
            <SettingRow title="Enabled" desc="Agent boleh memakai sumber data ini.">
              <Switch
                checked={cfg.tools[edit.key]?.enabled ?? false}
                onCheckedChange={(enabled) =>
                  setCfg((c) => ({
                    ...c,
                    tools: { ...c.tools, [edit.key]: { ...c.tools[edit.key], enabled } },
                  }))
                }
              />
            </SettingRow>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Source note</Label>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() =>
                    setCfg((c) => ({
                      ...c,
                      tools: {
                        ...c.tools,
                        [edit.key]: { ...c.tools[edit.key], note: TOOL_DEFAULTS[edit.key] ?? "" },
                      },
                    }))
                  }
                >
                  Fill default
                </Button>
              </div>
              <Textarea
                rows={8}
                value={cfg.tools[edit.key]?.note ?? ""}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    tools: { ...c.tools, [edit.key]: { ...c.tools[edit.key], note: e.target.value } },
                  }))
                }
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={onSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ControlCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={cn("rounded-2xl border-slate-800 bg-slate-950/70 p-4 text-slate-100 shadow-none", className)}
    >
      {children}
    </Card>
  );
}

function DarkDrawerBody({ children }: { children: ReactNode }) {
  return <div className="space-y-4 bg-[#070b14] p-4 text-slate-100">{children}</div>;
}

function LegacyFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[320px] overflow-hidden rounded-2xl border border-slate-800 bg-background text-foreground">
      {children}
    </div>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/70 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className={cn("font-medium text-slate-200", tone === "green" && "text-emerald-300")}>{value}</span>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: number; tone: "rose" | "amber" }) {
  return (
    <div className={cn("rounded-lg px-2 py-1", tone === "rose" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300")}>
      <span className="font-semibold">{value}</span> {label}
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <ControlCard><p className="text-sm text-slate-500">{text}</p></ControlCard>;
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 85
      ? "bg-emerald-500/15 text-emerald-300"
      : score >= 70
        ? "bg-amber-500/15 text-amber-300"
        : "bg-rose-500/15 text-rose-300";
  return <Badge className={cls}>{score}</Badge>;
}

function Sparkline({ tone }: { tone: string }) {
  const stroke = tone === "rose" ? "#fb7185" : tone === "amber" ? "#f59e0b" : tone === "violet" ? "#a78bfa" : "#34d399";
  return (
    <svg viewBox="0 0 72 24" className="h-5 w-14 opacity-80">
      <polyline points="0,18 8,16 16,20 24,12 32,14 40,8 48,11 56,5 64,9 72,3" fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function Donut({ value }: { value: number }) {
  return (
    <div
      className="h-20 w-20 rounded-full"
      style={{ background: `conic-gradient(#38bdf8 ${value}%, #8b5cf6 ${value}% ${value + 18}%, #f59e0b 0)` }}
    >
      <div className="m-5 flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white">
        {value}%
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      <span className="text-slate-400">{label}</span>
      <span className="ml-auto text-slate-300">{value}</span>
    </div>
  );
}

function toneClass(tone: string, part: "bg" | "text" | "badge") {
  const map: Record<string, Record<"bg" | "text" | "badge", string>> = {
    green: {
      bg: "bg-emerald-500/12",
      text: "text-emerald-300",
      badge: "bg-emerald-500/15 text-emerald-300",
    },
    blue: {
      bg: "bg-sky-500/12",
      text: "text-sky-300",
      badge: "bg-sky-500/15 text-sky-300",
    },
    violet: {
      bg: "bg-violet-500/12",
      text: "text-violet-300",
      badge: "bg-violet-500/15 text-violet-300",
    },
    amber: {
      bg: "bg-amber-500/12",
      text: "text-amber-300",
      badge: "bg-amber-500/15 text-amber-300",
    },
    rose: {
      bg: "bg-rose-500/12",
      text: "text-rose-300",
      badge: "bg-rose-500/15 text-rose-300",
    },
    cyan: {
      bg: "bg-cyan-500/12",
      text: "text-cyan-300",
      badge: "bg-cyan-500/15 text-cyan-300",
    },
    slate: {
      bg: "bg-slate-700/60",
      text: "text-slate-300",
      badge: "bg-slate-700 text-slate-300",
    },
  };
  return (map[tone] ?? map.slate)[part];
}

function fallbackIntents() {
  return [
    { intent: "booking inquiry", count: 32, pct: 32 },
    { intent: "price check", count: 21, pct: 21 },
    { intent: "general question", count: 18, pct: 18 },
    { intent: "complaint", count: 14, pct: 14 },
    { intent: "urgent issue", count: 9, pct: 9 },
    { intent: "others", count: 6, pct: 6 },
  ];
}

function prettyIntent(intent: string) {
  return intent.replace(/[_-]+/g, " ");
}

function fmtNum(value: number) {
  return Number(value ?? 0).toLocaleString("id-ID");
}

function fmtMsShort(value: number | null) {
  if (value == null) return "0s";
  if (value >= 60_000) return `${Math.round(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
  if (value >= 1000) return `${Math.round(value / 1000)}s`;
  return `${Math.round(value)}ms`;
}
