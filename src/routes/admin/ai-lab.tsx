/**
 * /admin/ai-lab — AI LAB dashboard.
 *
 * A full-screen control room for the Pomah Guesthouse AI chatbot
 * (sidebar hidden, like the Page Builder): live AI KPIs, the specialized
 * agents, the knowledge/tools they use, and the conversation pipeline.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  Sparkles,
  Bot,
  Send,
  Building2,
  DollarSign,
  BedDouble,
  Wrench,
  Calculator,
  Database,
  CalendarCheck,
  BookOpen,
  TrendingUp,
  Brain,
} from "lucide-react";
import { getDashboardMetrics } from "@/admin/functions/dashboard.functions";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin/ai-lab")({
  component: AiLab,
});

const AGENTS = [
  { name: "Front Office Agent", icon: Building2, desc: "Reservasi, check-in, info tamu" },
  { name: "Pricing Agent", icon: DollarSign, desc: "Tarif dinamis & promo" },
  { name: "Housekeeping Agent", icon: BedDouble, desc: "Status & kesiapan kamar" },
  { name: "Maintenance Agent", icon: Wrench, desc: "Perbaikan & fasilitas" },
  { name: "Finance Agent", icon: Calculator, desc: "Pembayaran & tagihan" },
];

const TOOLS = [
  { name: "PMS Database", icon: Database },
  { name: "Room Availability", icon: CalendarCheck },
  { name: "SOP Knowledge Base", icon: BookOpen },
  { name: "Pricing Engine", icon: TrendingUp },
  { name: "FAQ Memory", icon: Brain },
];

const PIPELINE = [
  { label: "Pesan Masuk", icon: MessageCircle },
  { label: "AI Orchestrator", icon: Bot },
  { label: "Specialized Agent", icon: Sparkles },
  { label: "Knowledge / Tools", icon: Database },
  { label: "Response Composer", icon: Brain },
  { label: "Balasan ke Tamu", icon: Send },
];

function AiLab() {
  const fn = useServerFn(getDashboardMetrics);
  const { data } = useQuery({ queryKey: ["dashboard-metrics"], queryFn: () => fn() });
  const s = data?.summary;

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

      {/* Content */}
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
              {AGENTS.map((a) => (
                <Card key={a.name} className="flex items-start gap-3 p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Aktif
                  </span>
                </Card>
              ))}
            </div>
          </section>

          {/* Knowledge & tools */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Knowledge &amp; Tools
            </h2>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {TOOLS.map((t) => (
                <Card key={t.name} className="flex flex-col items-center gap-2 p-5 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                    <t.icon className="h-5 w-5" />
                  </span>
                  <p className="text-xs font-medium leading-tight">{t.name}</p>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Terhubung
                  </span>
                </Card>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
