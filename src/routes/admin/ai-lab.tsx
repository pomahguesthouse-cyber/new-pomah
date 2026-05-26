/**
 * /admin/ai-lab — AI LAB.
 *
 * A full-screen AI control room (sidebar hidden, like the Page Builder)
 * with its own left navigation: an AI dashboard and the WhatsApp inbox.
 */
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  LayoutDashboard,
  MessageCircle,
  GraduationCap,
  Sparkles,
  Bot,
  Send,
  Building2,
  DollarSign,
  BedDouble,
  Wrench,
  Calculator,
  UserCog,
  Database,
  CalendarCheck,
  BookOpen,
  TrendingUp,
  Brain,
  Settings2,
  Timer,
  Search,
  Network,
  ShieldAlert,
  FileText,
  MessageSquare,
  Cpu,
} from "lucide-react";
import { getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import {
  getAiLabConfig,
  updateAiLabConfig,
  mergeAiLabConfig,
  type AiLabConfig,
} from "@/admin/modules/ai-lab/ai-lab.functions";
import { WhatsAppPage } from "@/routes/admin/whatsapp";
import { TrainingView } from "@/admin/modules/ai-lab/training-view";
import { SopKnowledgeView } from "@/admin/modules/ai-lab/sop-knowledge-view";
import { SmartDelaySettings } from "@/admin/modules/ai-lab/smart-delay-settings";
import { ChatSimulatorView } from "@/admin/modules/ai-lab/chat-simulator-view";
import { SeoPage } from "@/routes/admin/seo";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/ai-lab")({
  component: AiLab,
});

const AGENTS = [
  {
    key: "front-office",
    name: "Front Office Agent",
    icon: Building2,
    desc: "Reservasi, check-in, info tamu",
  },
  { key: "pricing", name: "Pricing Agent", icon: DollarSign, desc: "Tarif dinamis & promo" },
  {
    key: "customer-care",
    name: "Customer Care Agent",
    icon: BedDouble,
    desc: "Status & kesiapan kamar",
  },
  { key: "maintenance", name: "Maintenance Agent", icon: Wrench, desc: "Perbaikan & fasilitas" },
  { key: "finance", name: "Finance Agent", icon: Calculator, desc: "Pembayaran & tagihan" },
  {
    key: "manager",
    name: "Manager Agent",
    icon: UserCog,
    desc: "Khusus menangani percakapan manager",
  },
];

const TOOLS = [
  { key: "pms-database", name: "PMS Database", icon: Database },
  { key: "room-availability", name: "Room Availability", icon: CalendarCheck },
  { key: "sop-knowledge", name: "SOP Knowledge Base", icon: BookOpen },
  { key: "pricing-engine", name: "Pricing Engine", icon: TrendingUp },
  { key: "faq-memory", name: "FAQ Memory", icon: Brain },
];

const PIPELINE = [
  { label: "Pesan Masuk", icon: MessageCircle },
  { label: "Classifier", icon: Search },
  { label: "Router", icon: Network },
  { label: "Specialized Prompt", icon: Sparkles },
  { label: "Specialized Tools", icon: Database },
  { label: "Response Composer", icon: Brain },
  { label: "Balasan ke Tamu", icon: Send },
];

const DECISION_HIERARCHY = [
  {
    label: "Hard Rule",
    desc: "Aturan mutlak yang tidak boleh dilanggar — prioritas tertinggi.",
    icon: ShieldAlert,
  },
  {
    label: "SOP",
    desc: "Prosedur operasional standar yang wajib diikuti agent.",
    icon: FileText,
  },
  {
    label: "Knowledge Base",
    desc: "Basis pengetahuan properti: fasilitas, kebijakan, FAQ.",
    icon: BookOpen,
  },
  {
    label: "Training Percakapan",
    desc: "Contoh percakapan terlatih sebagai panduan gaya & respons.",
    icon: MessageSquare,
  },
  {
    label: "AI Reasoning",
    desc: "Penalaran mandiri AI jika tidak ada panduan di atas.",
    icon: Cpu,
  },
];

type ViewKey = "dashboard" | "whatsapp" | "simulator" | "sop" | "training" | "smart-delay" | "seo";
const NAV: { key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "dashboard",    label: "Dashboard",      icon: LayoutDashboard },
  { key: "whatsapp",     label: "WhatsApp",        icon: MessageCircle },
  { key: "simulator",    label: "Simulator Bot",   icon: Bot },
  { key: "sop",          label: "Knowledge & SOP", icon: BookOpen },
  { key: "training",     label: "Training",        icon: GraduationCap },
  { key: "smart-delay",  label: "Response Timing", icon: Timer },
  { key: "seo",          label: "SEO",             icon: Search },
];

type EditTarget = { type: "agent" | "tool"; key: string } | null;

/* ================================================================== */
/* Shell                                                               */
/* ================================================================== */

function AiLab() {
  const [view, setView] = useState<ViewKey>("dashboard");

  return (
    <div className="flex h-full flex-col bg-stone-100">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Keluar
          </Link>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Pomah Guesthouse
            </p>
            <h1 className="text-lg font-semibold tracking-tight">AI LAB</h1>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          AI Aktif
        </span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <nav className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-card p-3">
          {NAV.map((n) => (
            <button
              key={n.key}
              onClick={() => setView(n.key)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition",
                view === n.key
                  ? "bg-teal-50 font-medium text-teal-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <n.icon className="h-4 w-4 shrink-0" />
              {n.label}
            </button>
          ))}
        </nav>

        {/* View */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {view === "dashboard" ? (
            <DashboardView />
          ) : view === "whatsapp" ? (
            <WhatsAppPage />
          ) : view === "simulator" ? (
            <div className="flex-1 overflow-hidden">
              <ChatSimulatorView />
            </div>
          ) : view === "sop" ? (
            <SopKnowledgeView />
          ) : view === "smart-delay" ? (
            <div className="flex-1 overflow-y-auto">
              <SmartDelaySettings />
            </div>
          ) : view === "seo" ? (
            <div className="flex-1 overflow-y-auto">
              <SeoPage />
            </div>
          ) : (
            <TrainingView />
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Dashboard view                                                      */
/* ================================================================== */

function DashboardView() {
  const metricsFn = useServerFn(getDashboardMetrics);
  const { data: metrics } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: () => metricsFn(),
  });
  const s = metrics?.summary;

  const cfgFn = useServerFn(getAiLabConfig);
  const updateFn = useServerFn(updateAiLabConfig);
  const { data: cfgData } = useQuery({ queryKey: ["ai-lab-config"], queryFn: () => cfgFn() });

  const [cfg, setCfg] = useState<AiLabConfig>(() => mergeAiLabConfig({}));
  const [edit, setEdit] = useState<EditTarget>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (cfgData?.config) setCfg(cfgData.config);
  }, [cfgData]);

  const save = async () => {
    if (!cfgData?.id) {
      toast.error("Properti belum tersedia.");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: { id: cfgData.id, config: cfg as unknown as Record<string, unknown> },
      });
      toast.success("Konfigurasi AI tersimpan");
      setEdit(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const kpis = [
    {
      label: "Percakapan AI (30 hari)",
      value: (s?.aiTotal30d ?? 0).toLocaleString("id-ID"),
      icon: Bot,
      hint: `${(s?.aiUsed30d ?? 0).toLocaleString("id-ID")} dipakai staf`,
    },
    {
      label: "AI Adoption",
      value: `${s?.aiAdoptionPct ?? 0}%`,
      icon: Sparkles,
      hint: "Saran AI yang dipakai",
    },
    {
      label: "Pesan WhatsApp (30 hari)",
      value: `${(s?.waIn30d ?? 0).toLocaleString("id-ID")} / ${(s?.waOut30d ?? 0).toLocaleString("id-ID")}`,
      icon: MessageCircle,
      hint: "Masuk / keluar",
    },
    {
      label: "Konversi WhatsApp",
      value: `${s?.waConversionPct ?? 0}%`,
      icon: TrendingUp,
      hint: `${s?.waThreads ?? 0} percakapan`,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label} className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
                <k.icon className="h-4 w-4 text-teal-600" />
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{k.hint}</p>
            </Card>
          ))}
        </div>

        {/* Decision hierarchy */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Hirarki Keputusan Chatbot
          </h2>
          <Card className="divide-y divide-border overflow-hidden p-0">
            {DECISION_HIERARCHY.map((item, i) => (
              <div key={item.label} className="flex items-center gap-4 px-5 py-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <item.icon className="h-4 w-4 shrink-0 text-teal-600" />
              </div>
            ))}
          </Card>
        </section>

        {/* Conversation pipeline */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Conversation Pipeline
          </h2>
          <Card className="flex flex-wrap items-center gap-2 p-5">
            {PIPELINE.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <step.icon className="h-4 w-4 text-teal-600" />
                  <span className="text-xs font-medium">{step.label}</span>
                </div>
                {i < PIPELINE.length - 1 && (
                  <ArrowRight className="h-4 w-4 shrink-0 text-stone-300" />
                )}
              </div>
            ))}
          </Card>
        </section>

        {/* Specialized agents */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Specialized AI Agents
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((a) => {
              const ac = cfg.agents[a.key];
              return (
                <Card
                  key={a.key}
                  onClick={() => setEdit({ type: "agent", key: a.key })}
                  className="group flex cursor-pointer items-start gap-3 p-5 transition hover:border-teal-300 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {ac?.autoReply ? "Balas otomatis" : "Perlu persetujuan"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        ac?.enabled
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-stone-200 text-stone-500"
                      }`}
                    >
                      {ac?.enabled ? "Aktif" : "Nonaktif"}
                    </span>
                    <Settings2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Knowledge & tools */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Knowledge &amp; Tools
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {TOOLS.map((t) => {
              const tc = cfg.tools[t.key];
              return (
                <Card
                  key={t.key}
                  onClick={() => setEdit({ type: "tool", key: t.key })}
                  className="group flex cursor-pointer flex-col items-center gap-2 p-5 text-center transition hover:border-sky-300 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                    <t.icon className="h-5 w-5" />
                  </span>
                  <p className="text-xs font-medium leading-tight">{t.name}</p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      tc?.enabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-stone-200 text-stone-500"
                    }`}
                  >
                    {tc?.enabled ? "Terhubung" : "Nonaktif"}
                  </span>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      <ConfigDialog
        edit={edit}
        cfg={cfg}
        setCfg={setCfg}
        saving={saving}
        onClose={() => setEdit(null)}
        onSave={save}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Config dialog                                                       */
/* ------------------------------------------------------------------ */

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function ConfigDialog({
  edit,
  cfg,
  setCfg,
  saving,
  onClose,
  onSave,
}: {
  edit: EditTarget;
  cfg: AiLabConfig;
  setCfg: React.Dispatch<React.SetStateAction<AiLabConfig>>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const agent = edit?.type === "agent" ? AGENTS.find((a) => a.key === edit.key) : null;
  const tool = edit?.type === "tool" ? TOOLS.find((t) => t.key === edit.key) : null;
  const label = agent?.name ?? tool?.name ?? "";

  return (
    <Dialog open={!!edit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Konfigurasi — {label}</DialogTitle>
          <DialogDescription>
            {agent ? "Atur perilaku agent AI ini." : "Atur akses dan catatan sumber data ini."}
          </DialogDescription>
        </DialogHeader>

        {agent && edit && (
          <div className="space-y-3">
            <Row title="Aktif" desc="Agent ikut menangani percakapan.">
              <Switch
                checked={cfg.agents[edit.key]?.enabled ?? false}
                onCheckedChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    agents: { ...c.agents, [edit.key]: { ...c.agents[edit.key], enabled: v } },
                  }))
                }
              />
            </Row>
            <Row title="Balas otomatis" desc="Jika mati, balasan menunggu persetujuan staf.">
              <Switch
                checked={cfg.agents[edit.key]?.autoReply ?? false}
                onCheckedChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    agents: { ...c.agents, [edit.key]: { ...c.agents[edit.key], autoReply: v } },
                  }))
                }
              />
            </Row>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Instruksi / persona</Label>
              <Textarea
                rows={5}
                placeholder="Contoh: Ramah, gunakan sapaan 'kak', jawab singkat dan jelas…"
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
          <div className="space-y-3">
            <Row title="Aktif" desc="Agent boleh memakai sumber data ini.">
              <Switch
                checked={cfg.tools[edit.key]?.enabled ?? false}
                onCheckedChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    tools: { ...c.tools, [edit.key]: { ...c.tools[edit.key], enabled: v } },
                  }))
                }
              />
            </Row>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Catatan / konfigurasi sumber</Label>
              <Textarea
                rows={5}
                placeholder="Endpoint, kredensial, atau catatan sumber data…"
                value={cfg.tools[edit.key]?.note ?? ""}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    tools: {
                      ...c.tools,
                      [edit.key]: { ...c.tools[edit.key], note: e.target.value },
                    },
                  }))
                }
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
          <Button
            className="bg-teal-700 text-white hover:bg-teal-800"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
