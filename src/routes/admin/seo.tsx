import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ExternalLink,
  Save,
  Upload,
  Loader2,
  Trash2,
  Image as ImageIcon,
  TrendingUp,
  Search,
  LayoutDashboard,
  Bot,
  MessageCircle,
  MessagesSquare,
  BookOpen,
  GraduationCap,
  Timer,
  Check,
  X,
  Sparkles,
  Link as LinkIcon,
  ChevronRight,
  Globe,
  Settings2,
  AlertTriangle,
  Settings,
  Plus,
  RefreshCw,
  Eye,
  FileText,
  FileCode,
  MapPin,
  Star,
  Activity,
  ArrowRight,
  Sparkle,
  Layers,
} from "lucide-react";
import {
  getSeoDashboardData,
  listSeoKeywords,
  addSeoKeyword,
  deleteSeoKeyword,
  getConversationalSeoData,
  approveFaqOpportunity,
  getProgrammaticPages,
  generateProgrammaticPage,
  publishProgrammaticPage,
  getSchemaRegistry,
  saveSchemaMarkup,
  getInternalLinkMap,
  approveInternalLink,
  getReviewIntelligence,
  triggerSeoAgentAction,
  getSearchConsoleData,
} from "@/admin/modules/seo/seo.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
} from "recharts";

export const Route = createFileRoute("/admin/seo")({
  component: SeoPage,
});

  | "overview"
  | "search_console"
  | "agents"
  | "conversational"
  | "keywords"
  | "programmatic"
  | "studio"
  | "links"
  | "reviews";

export function SeoPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const qc = useQueryClient();

  // Queries
  const { data: dashboardData, isLoading: loadingDash, refetch: refetchDash } = useQuery({
    queryKey: ["seo-dashboard"],
    queryFn: () => getSeoDashboardData(),
  });

  const { data: keywordsData, refetch: refetchKeywords } = useQuery({
    queryKey: ["seo-keywords"],
    queryFn: () => listSeoKeywords(),
  });

  const { data: conversationalData, refetch: refetchConv } = useQuery({
    queryKey: ["seo-conversational"],
    queryFn: () => getConversationalSeoData(),
  });

  const { data: programmaticData, refetch: refetchProg } = useQuery({
    queryKey: ["seo-programmatic"],
    queryFn: () => getProgrammaticPages(),
  });

  const { data: schemasData, refetch: refetchSchemas } = useQuery({
    queryKey: ["seo-schemas"],
    queryFn: () => getSchemaRegistry(),
  });

  const { data: linkMapData, refetch: refetchLinks } = useQuery({
    queryKey: ["seo-links"],
    queryFn: () => getInternalLinkMap(),
  });

  const { data: reviewsData, refetch: refetchReviews } = useQuery({
    queryKey: ["seo-reviews"],
    queryFn: () => getReviewIntelligence(),
  });

  const { data: searchConsoleData, refetch: refetchSearchConsole } = useQuery({
    queryKey: ["seo-search-console"],
    queryFn: () => getSearchConsoleData(),
  });

  // Mutators
  const triggerAgentM = useMutation({
    mutationFn: (agentKey: string) => triggerSeoAgentAction({ data: { agent_key: agentKey } }),
    onSuccess: (res) => {
      toast.success(res.log.task_description + " completed!");
      refetchDash();
    },
    onError: (e) => toast.error(e.message),
  });

  if (loadingDash || !dashboardData) {
    return <div className="p-10 text-sm text-muted-foreground">Loading SEO Dashboard…</div>;
  }

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "search_console", label: "Search Console", icon: TrendingUp },
    { key: "agents", label: "AI Agents", icon: Bot },
    { key: "conversational", label: "WhatsApp Intent", icon: MessageCircle },
    { key: "keywords", label: "Keywords", icon: Search },
    { key: "programmatic", label: "Programmatic SEO", icon: Globe },
    { key: "studio", label: "Content Studio", icon: Sparkles },
    { key: "links", label: "Linking Map", icon: LinkIcon },
    { key: "reviews", label: "Reviews Insight", icon: Star },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900">
      {/* Top Glassmorphic header */}
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/80 backdrop-blur-md px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-teal-600 font-semibold flex items-center gap-1.5">
            <Sparkle className="h-3 w-3 animate-pulse" /> SEO Operating System
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-900">
            AI SEO Control Room
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 font-mono text-xs bg-white"
            onClick={() => {
              refetchDash();
              refetchKeywords();
              refetchConv();
              refetchProg();
              refetchSchemas();
              refetchLinks();
              refetchReviews();
              refetchSearchConsole();
              toast.success("SEO metrics refreshed");
            }}
          >
            <RefreshCw className="h-3 w-3" /> Sync Data
          </Button>
          <a
            href="/sitemap.xml"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 font-mono text-xs text-stone-600 hover:bg-stone-50"
          >
            Sitemap <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* Main tab panel layout */}
      <div className="flex flex-1 flex-col md:flex-row">
        {/* Navigation sidebar */}
        <nav className="w-full md:w-64 shrink-0 border-r border-stone-200 bg-stone-100/50 p-4 space-y-1">
          {tabs.map((t) => {
            const ActiveIcon = t.icon;
            const isSelected = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all duration-200 ${
                  isSelected
                    ? "bg-teal-700 text-white shadow-md shadow-teal-700/20"
                    : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
                }`}
              >
                <ActiveIcon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Console space */}
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          {activeTab === "overview" && (
            <OverviewSection
              summary={dashboardData.summary}
              visibility={dashboardData.visibility}
              logs={dashboardData.logs}
              trafficHistory={dashboardData.trafficHistory}
              visibilityHistory={dashboardData.visibilityHistory}
              keywordHistory={dashboardData.keywordHistory}
              publishingHistory={dashboardData.publishingHistory}
            />
          )}
          {activeTab === "search_console" && (
            <SearchConsoleSection data={searchConsoleData} />
          )}
          {activeTab === "agents" && (
            <AgentsControlSection
              logs={dashboardData.logs}
              onRun={(key) => triggerAgentM.mutate(key)}
              runningKey={triggerAgentM.isPending ? triggerAgentM.variables : null}
            />
          )}
          {activeTab === "conversational" && (
            <ConversationalSeoSection
              faqs={conversationalData?.faqs ?? []}
              onApproved={() => {
                refetchConv();
                refetchDash();
              }}
            />
          )}
          {activeTab === "keywords" && (
            <KeywordsSection
              keywords={keywordsData?.keywords ?? dashboardData.keywords}
              onChanged={refetchKeywords}
            />
          )}
          {activeTab === "programmatic" && (
            <ProgrammaticSection
              pages={programmaticData?.pages ?? []}
              schemas={schemasData?.schemas ?? []}
              onChanged={() => {
                refetchProg();
                refetchDash();
                refetchSchemas();
              }}
            />
          )}
          {activeTab === "studio" && <ContentStudioSection />}
          {activeTab === "links" && (
            <LinkingSection
              nodes={linkMapData?.nodes ?? []}
              links={linkMapData?.links ?? []}
              onChanged={refetchLinks}
            />
          )}
          {activeTab === "reviews" && (
            <ReviewsSection reviews={reviewsData?.reviews ?? []} />
          )}
        </main>
      </div>
    </div>
  );
}

/* ============================================================================
   1. OVERVIEW SECTION
   ============================================================================ */
function OverviewSection({
  summary,
  visibility,
  logs,
  trafficHistory,
  visibilityHistory,
  keywordHistory,
  publishingHistory,
}: {
  summary: any;
  visibility: any[];
  logs: any[];
  trafficHistory: any[];
  visibilityHistory: any[];
  keywordHistory: any[];
  publishingHistory: any[];
}) {
  const cards = [
    {
      title: "Organic Traffic",
      value: summary.organicTraffic.toLocaleString("id-ID"),
      change: `+${summary.organicTrafficChange}%`,
      trend: "up",
      desc: "Kunjungan organik 30 hari",
    },
    {
      title: "Indexed Pages",
      value: summary.indexedPages,
      change: "Stable",
      trend: "neutral",
      desc: "Halaman terindeks Google",
    },
    {
      title: "AI Search Visibility",
      value: `${summary.aiVisibilityScore}%`,
      change: `+${summary.aiVisibilityChange}%`,
      trend: "up",
      desc: "Persentase kutipan di LLM",
    },
    {
      title: "Local SEO Score",
      value: `${summary.localSeoScore}/100`,
      change: "NAP Consistent",
      trend: "up",
      desc: "Peringkat maps & lokalitas",
    },
    {
      title: "AI Overview Mentions",
      value: summary.aiOverviewMentions,
      change: "+28% mo-m",
      trend: "up",
      desc: "Kutipan Google AI Overviews",
    },
    {
      title: "FAQ Coverage",
      value: `${summary.faqCoverage}%`,
      change: "+4.1%",
      trend: "up",
      desc: "Pertanyaan terjawab di FAQ",
    },
    {
      title: "Technical Health",
      value: `${summary.technicalHealth}%`,
      change: "Clean Audit",
      trend: "up",
      desc: "Core Web Vitals & indexability",
    },
    {
      title: "Target Keywords",
      value: summary.keywordsCount,
      change: "5 High Priority",
      trend: "neutral",
      desc: "Kata kunci terdaftar",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Cards Grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <Card key={i} className="p-5 border border-stone-200/80 bg-white relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                {c.title}
              </span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  c.trend === "up"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-stone-100 text-stone-600"
                }`}
              >
                {c.change}
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold text-stone-900 tracking-tight">{c.value}</p>
            <p className="mt-1 text-[11px] text-stone-400 font-medium">{c.desc}</p>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Card>
        ))}
      </div>

      {/* Charts section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Traffic Growth Area Chart */}
        <Card className="p-6 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-teal-600" /> Organic Traffic Trend
          </h3>
          <p className="text-xs text-stone-400 mt-0.5">Pertumbuhan kunjungan organik per bulan</p>
          <div className="h-64 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTraffic" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="month" stroke="#a8a29e" fontSize={11} tickLine={false} />
                <YAxis stroke="#a8a29e" fontSize={11} tickLine={false} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="traffic"
                  stroke="#0d9488"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTraffic)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* AI Visibility Line Chart */}
        <Card className="p-6 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" /> AI Engine Visibility Score
          </h3>
          <p className="text-xs text-stone-400 mt-0.5">Persentase kemunculan di chat AI (ChatGPT, Gemini, etc)</p>
          <div className="h-64 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={visibilityHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="month" stroke="#a8a29e" fontSize={11} tickLine={false} />
                <YAxis stroke="#a8a29e" fontSize={11} tickLine={false} domain={[50, 100]} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 1.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Keywords Rankings Stacked Bar Chart */}
        <Card className="md:col-span-2 p-6 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800 flex items-center gap-2">
            <Search className="h-4 w-4 text-sky-600" /> Keyword Ranking Distribution
          </h3>
          <p className="text-xs text-stone-400 mt-0.5">Posisi peringkat kata kunci di Google SERP</p>
          <div className="h-60 mt-4 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={keywordHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                <XAxis dataKey="month" stroke="#a8a29e" fontSize={11} tickLine={false} />
                <YAxis stroke="#a8a29e" fontSize={11} tickLine={false} />
                <Tooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="top3" name="Top 3 (Pos 1-3)" stackId="a" fill="#0f766e" />
                <Bar dataKey="top10" name="Top 10 (Pos 4-10)" stackId="a" fill="#0d9488" />
                <Bar dataKey="top100" name="Top 100 (Pos 11-100)" stackId="a" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* AI LLM Visibility Score list */}
        <Card className="p-6 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800">Visibility details per Engine</h3>
          <p className="text-xs text-stone-400 mt-0.5">Skor performa dan topik yang belum terliput</p>
          <div className="mt-4 space-y-3.5">
            {visibility.map((v, i) => (
              <div key={i} className="flex flex-col gap-1 text-sm border-b border-stone-100 pb-2.5 last:border-0 last:pb-0">
                <div className="flex justify-between font-medium">
                  <span className="text-stone-700">{v.engine}</span>
                  <span className="text-teal-700">{v.visibility_score}% visibility</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <span className="text-[10px] text-stone-400 font-mono">Uncovered:</span>
                  {v.uncovered_topics.map((t: string, j: number) => (
                    <span
                      key={j}
                      className="bg-stone-100 text-stone-600 text-[10px] px-1.5 py-0.5 rounded font-mono"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Technical SEO Audit overview */}
      <Card className="p-6 border border-stone-200 bg-white">
        <h3 className="font-semibold text-stone-800 flex items-center gap-2">
          <AlertTriangle className="h-4.5 w-4.5 text-amber-500" /> Technical Health Monitor
        </h3>
        <p className="text-xs text-stone-400 mt-0.5">Hasil audit otomatis file perayap & internal links</p>
        <div className="grid gap-4 sm:grid-cols-3 mt-4">
          <div className="flex items-center gap-3 border border-stone-100 p-3 rounded-xl bg-stone-50/50">
            <Check className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-stone-800">sitemap.xml</p>
              <p className="text-[11px] text-stone-400">Valid & Auto updated</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border border-stone-100 p-3 rounded-xl bg-stone-50/50">
            <Check className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-stone-800">robots.txt</p>
              <p className="text-[11px] text-stone-400">Active & Disallow set</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border border-stone-100 p-3 rounded-xl bg-stone-50/50">
            <Check className="h-5 w-5 text-emerald-600 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-stone-800">Broken Links</p>
              <p className="text-[11px] text-stone-400">0 link rusak terdeteksi</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ============================================================================
   2. AI AGENTS CONTROL CENTER SECTION
   ============================================================================ */
const SEO_AGENTS = [
  {
    key: "seo-manager",
    name: "SEO Manager Agent",
    icon: Bot,
    score: 96,
    desc: "Mengawasi performa keseluruhan, sitemap, indeksasi, dan delegasi tugas.",
    defaultPrompt:
      "You are the Lead SEO Manager Agent. Analyze search console indices, track competitor keyword shifts, and delegate tasks to specialized agents.",
  },
  {
    key: "keyword-research",
    name: "Keyword Research Agent",
    icon: Search,
    score: 92,
    desc: "Mencari kata kunci pencarian lokal, volume pencarian, dan kesenjangan kompetitor.",
    defaultPrompt:
      "You are a Keyword Research specialist. Scrape Google autocomplete database for local accommodations, calculate keyword difficulty, and identify priority ranking terms.",
  },
  {
    key: "content-strategist",
    name: "Content Strategist Agent",
    icon: Sparkles,
    score: 88,
    desc: "Membuat rencana artikel, struktur heading, dan topik konten berbasis tren guest.",
    defaultPrompt:
      "You are the Content Strategist. Based on recurring hotel search inquiries, write outlines and plan content structures (H1, H2, H3) that map perfectly to search intents.",
  },
  {
    key: "local-seo",
    name: "Local SEO Agent",
    icon: MapPin,
    score: 95,
    desc: "Mengoptimalkan data maps (NAP), mendaftarkan landmark terdekat (UNNES, dll).",
    defaultPrompt:
      "You are the Local SEO specialist. Ensure consistent Name, Address, and Phone numbers (NAP). Build geo-specific semantic markup referencing UNNES, Gunungpati, and Semarang landmarks.",
  },
  {
    key: "technical-seo",
    name: "Technical SEO Agent",
    icon: Timer,
    score: 98,
    desc: "Memindai masalah Canonical, Core Web Vitals, robots.txt, dan SSL.",
    defaultPrompt:
      "You are the Technical Auditor. Scan canonical HTML headers, check redirect chains, ensure SSL validations, and scan XML sitemaps for syntax errors.",
  },
  {
    key: "schema-markup",
    name: "Schema Markup Agent",
    icon: FileCode,
    score: 94,
    desc: "Membuat script JSON-LD dinamis untuk Hotel, Review, dan FAQPage.",
    defaultPrompt:
      "You are the Schema Engineer. Generate JSON-LD schema snippets for LocalBusiness, FAQPage, Hotel, and Offer templates. Validate scripts against standard schema.org structure.",
  },
  {
    key: "internal-linking",
    name: "Internal Linking Agent",
    icon: LinkIcon,
    score: 87,
    desc: "Menganalisis keterkaitan halaman internal dan menyarankan anchor text optimal.",
    defaultPrompt:
      "You are the Internal Linking optimizer. Analyze contextual relevance between articles and rooms. Generate link suggestions with high semantic anchor text value.",
  },
  {
    key: "review-intelligence",
    name: "Review Intelligence Agent",
    icon: Star,
    score: 91,
    desc: "Mengekstrak kata kunci kepuasan tamu dari review Google & WhatsApp.",
    defaultPrompt:
      "You are the Review Analyst. Read reviews from Google Maps and WhatsApp, score guest sentiment, extract highlight keywords, and output SEO suggestions.",
  },
  {
    key: "conversational-seo",
    name: "Conversational SEO Agent",
    icon: MessageCircle,
    score: 90,
    desc: "Membaca log pesan WhatsApp untuk mendeteksi topik pertanyaan tamu berulang.",
    defaultPrompt:
      "You are the Conversational SEO miner. Scan incoming chat history logs to identify popular guest questions. Cluster these into FAQ proposals.",
  },
  {
    key: "programmatic-seo",
    name: "Programmatic SEO Agent",
    icon: Globe,
    score: 89,
    desc: "Membangun template halaman penawaran khusus sesuai kata kunci lokal.",
    defaultPrompt:
      "You are the Programmatic SEO generator. Create landing page shells by merging intent keywords (e.g. guesthouse dekat...) and local entity databases.",
  },
];

function AgentsControlSection({
  logs,
  onRun,
  runningKey,
}: {
  logs: any[];
  onRun: (key: string) => void;
  runningKey: string | null;
}) {
  const [enabledAgents, setEnabledAgents] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    SEO_AGENTS.forEach((a) => (s[a.key] = true));
    return s;
  });

  const [prompts, setPrompts] = useState<Record<string, string>>(() => {
    const p: Record<string, string> = {};
    SEO_AGENTS.forEach((a) => (p[a.key] = a.defaultPrompt));
    return p;
  });

  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [promptText, setPromptText] = useState("");

  const handleEditPrompt = (agent: any) => {
    setEditingAgent(agent);
    setPromptText(prompts[agent.key]);
  };

  const handleSavePrompt = () => {
    if (editingAgent) {
      setPrompts({ ...prompts, [editingAgent.key]: promptText });
      toast.success(`Prompt for ${editingAgent.name} updated!`);
      setEditingAgent(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-stone-800">AI Agents Control Center</h2>
          <p className="text-xs text-stone-400">Kelola dan awasi 10 AI SEO Agents khusus Anda</p>
        </div>
      </div>

      {/* Agents Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {SEO_AGENTS.map((a) => {
          const ActiveIcon = a.icon;
          const isEnabled = enabledAgents[a.key] ?? true;
          const isRunning = runningKey === a.key;
          const recentLog = logs.find((l) => l.agent_key === a.key);

          return (
            <Card
              key={a.key}
              className={`p-5 border transition-all duration-300 flex flex-col justify-between ${
                isEnabled
                  ? "bg-white border-stone-200/80 shadow-sm hover:shadow-md hover:border-teal-300"
                  : "bg-stone-50 border-stone-200 opacity-60"
              }`}
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl font-semibold ${
                        isEnabled
                          ? "bg-teal-50 text-teal-700"
                          : "bg-stone-200 text-stone-500"
                      }`}
                    >
                      <ActiveIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-semibold text-stone-800 text-sm">{a.name}</p>
                      <p className="text-[10px] text-stone-400 font-medium">Score: {a.score}/100</p>
                    </div>
                  </div>
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(v) => setEnabledAgents({ ...enabledAgents, [a.key]: v })}
                  />
                </div>

                <p className="mt-3.5 text-xs text-stone-500 leading-relaxed">{a.desc}</p>

                {isEnabled && (
                  <div className="mt-4 p-2.5 rounded-lg bg-stone-50 border border-stone-100 text-[11px] font-mono text-stone-600">
                    <div className="flex items-center gap-1.5 font-bold text-stone-700">
                      <Activity className={`h-3.5 w-3.5 ${isRunning ? "animate-spin text-teal-600" : "text-stone-400"}`} />
                      Status: {isRunning ? "Processing..." : "Idle (Nominal)"}
                    </div>
                    {recentLog ? (
                      <p className="mt-1 line-clamp-2">Task: {recentLog.task_description}</p>
                    ) : (
                      <p className="mt-1 text-stone-400">No recent task logs.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-5 pt-3 border-t border-stone-100 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-stone-600"
                  onClick={() => handleEditPrompt(a)}
                >
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Prompt
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs bg-white text-teal-700 border-teal-200 hover:bg-teal-50"
                  disabled={!isEnabled || isRunning}
                  onClick={() => onRun(a.key)}
                >
                  {isRunning ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Run Agent
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Logs History Terminal */}
      <Card className="p-5 border border-stone-200 bg-white">
        <h3 className="font-semibold text-stone-800 text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-teal-600 animate-pulse" /> Agent Activity Log Terminal
        </h3>
        <div className="mt-3 p-4 bg-stone-900 rounded-xl font-mono text-xs text-stone-300 space-y-1.5 max-h-60 overflow-y-auto">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2">
              <span className="text-teal-400 shrink-0">[{new Date(l.created_at).toLocaleTimeString()}]</span>
              <span className="text-amber-300 shrink-0">{l.agent_key.toUpperCase()}:</span>
              <span>{l.task_description} ({l.details})</span>
            </div>
          ))}
          {logs.length === 0 && (
            <p className="text-stone-500 italic">No agent log entries recorded in this session.</p>
          )}
        </div>
      </Card>

      {/* Edit Prompt Dialog */}
      <Dialog open={!!editingAgent} onOpenChange={(o) => !o && setEditingAgent(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Agent Prompt Persona</DialogTitle>
            <DialogDescription>
              Ubah instruksi / prompt sistem agen {editingAgent?.name}. Prompt ini akan memengaruhi perilaku agen saat melakukan tugas SEO.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label className="text-xs font-semibold">Prompt / Instructions</Label>
            <Textarea
              rows={6}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              className="mt-2 text-sm font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAgent(null)}>
              Cancel
            </Button>
            <Button className="bg-teal-700 hover:bg-teal-800" onClick={handleSavePrompt}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================================
   3. CONVERSATIONAL SEO SECTION
   ============================================================================ */
function ConversationalSeoSection({ faqs, onApproved }: { faqs: any[]; onApproved: () => void }) {
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const approveM = useMutation({
    mutationFn: (f: { id: string; question: string; answer: string }) =>
      approveFaqOpportunity({ data: f }),
    onSuccess: () => {
      toast.success("Pertanyaan disetujui & dipublikasikan ke sitemap & schema!");
      setApprovingId(null);
      onApproved();
    },
    onError: (e) => {
      toast.error(e.message);
      setApprovingId(null);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-stone-800">Conversational SEO Engine</h2>
        <p className="text-xs text-stone-400">
          Menganalisis riwayat obrolan WhatsApp tamu untuk menemukan peluang kata kunci & artikel FAQ
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* FAQ Opportunities list */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-stone-700 text-sm flex items-center gap-2">
            <Plus className="h-4 w-4 text-teal-600" /> FAQ Candidates From Chats
          </h3>
          <div className="space-y-4">
            {faqs.map((faq) => {
              const isApproving = approvingId === faq.id;
              return (
                <Card key={faq.id} className="p-5 border border-stone-200 bg-white">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="bg-teal-50 text-teal-700 font-bold text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                        {faq.recurring_count} Kali Ditanyakan
                      </span>
                      <h4 className="mt-2 font-bold text-stone-900 text-base">{faq.question}</h4>
                    </div>
                    {faq.status === "pending" ? (
                      <Button
                        size="sm"
                        disabled={isApproving}
                        className="bg-teal-700 text-white hover:bg-teal-800 shrink-0 text-xs h-8"
                        onClick={() => {
                          setApprovingId(faq.id);
                          approveM.mutate({
                            id: faq.id,
                            question: faq.question,
                            answer: faq.suggested_answer,
                          });
                        }}
                      >
                        {isApproving ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Check className="h-3.5 w-3.5 mr-1" />
                        )}
                        Approve & Publish
                      </Button>
                    ) : (
                      <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-1 rounded-md shrink-0 flex items-center gap-1">
                        <Check className="h-3.5 w-3.5" /> Published
                      </span>
                    )}
                  </div>

                  {/* Chat logs reference */}
                  <div className="mt-4 p-3 bg-stone-50 border border-stone-100 rounded-lg text-xs space-y-2">
                    <p className="font-semibold text-stone-400 uppercase tracking-wide text-[9px] font-mono">
                      Cuplikan Obrolan WhatsApp Tamu:
                    </p>
                    {faq.source_conversations.map((c: any, i: number) => (
                      <div key={i} className="flex gap-2 text-stone-600">
                        <span className="font-semibold text-teal-700 text-right w-12 shrink-0">Tamu:</span>
                        <p className="italic">"{c.text}"</p>
                      </div>
                    ))}
                  </div>

                  {/* Suggested Answer */}
                  <div className="mt-4 pt-3 border-t border-stone-100 text-xs">
                    <p className="font-semibold text-stone-700">Rancangan Jawaban AI (FAQ Page):</p>
                    <p className="mt-1 text-stone-600 leading-relaxed bg-teal-50/30 p-2.5 rounded-lg border border-teal-100/50">
                      {faq.suggested_answer}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Sidebar analytics / Intent Heatmap */}
        <div className="space-y-6">
          <Card className="p-5 border border-stone-200 bg-white">
            <h3 className="font-semibold text-stone-800 text-sm">Intent Heatmap</h3>
            <p className="text-[11px] text-stone-400 mt-0.5">Topik pembicaraan paling sering ditanyakan tamu</p>
            <div className="mt-4 space-y-3">
              {[
                { topic: "Parkir & Akses Bus", pct: 85, color: "bg-teal-600" },
                { topic: "Jarak ke Kampus UNNES", pct: 74, color: "bg-teal-500" },
                { topic: "Dapur Bersama & Alat Masak", pct: 60, color: "bg-teal-400" },
                { topic: "Wisuda / Rombongan Keluarga", pct: 52, color: "bg-teal-300" },
                { topic: "Pemesanan & Kamar Kosong", pct: 35, color: "bg-stone-300" },
              ].map((h, i) => (
                <div key={i} className="space-y-1 text-xs">
                  <div className="flex justify-between font-medium">
                    <span className="text-stone-700">{h.topic}</span>
                    <span className="text-stone-500">{h.pct}% volume</span>
                  </div>
                  <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                    <div className={`h-full ${h.color} rounded-full`} style={{ width: `${h.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 border border-stone-200 bg-white space-y-3">
            <h3 className="font-semibold text-stone-800 text-sm">SEO Opportunity Recommendation</h3>
            <div className="p-3 rounded-lg border border-amber-100 bg-amber-50/50 text-xs text-stone-600">
              <span className="font-bold text-amber-700 block">Rekomendasi Utama:</span>
              Mengingat tingginya pencarian seputar wisuda UNNES dan akomodasi parkir bus, kami menyarankan pembuatan landing page tertarget: **"Penginapan Rombongan Wisuda Semarang"**.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   4. KEYWORDS SECTION
   ============================================================================ */
function KeywordsSection({ keywords, onChanged }: { keywords: any[]; onChanged: () => void }) {
  const [newKeyword, setNewKeyword] = useState("");
  const [newVol, setNewVol] = useState(100);
  const [newDiff, setNewDiff] = useState(15);
  const [newIntent, setNewIntent] = useState<any>("informational");
  const [newPriority, setNewPriority] = useState<any>("medium");
  const [isAdding, setIsAdding] = useState(false);

  const addM = useMutation({
    mutationFn: (k: any) => addSeoKeyword({ data: k }),
    onSuccess: () => {
      toast.success("Keyword added!");
      setNewKeyword("");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => deleteSeoKeyword({ data: { id } }),
    onSuccess: () => {
      toast.success("Keyword deleted!");
      onChanged();
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-stone-800">Keyword Intelligence</h2>
          <p className="text-xs text-stone-400">Riset kata kunci dan target volume penelusuran lokal</p>
        </div>
        <Button size="sm" onClick={() => setIsAdding(true)} className="bg-teal-700 text-white hover:bg-teal-800">
          <Plus className="mr-1.5 h-4 w-4" /> Add Keyword
        </Button>
      </div>

      <Card className="p-5 border border-stone-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left font-mono text-[10px] uppercase tracking-widest text-stone-400 border-b border-stone-100">
              <tr>
                <th className="pb-3">Keyword</th>
                <th className="pb-3">Search Volume</th>
                <th className="pb-3">Difficulty</th>
                <th className="pb-3">Intent</th>
                <th className="pb-3">Priority</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {keywords.map((k) => (
                <tr key={k.id} className="hover:bg-stone-50/50 transition">
                  <td className="py-3 font-semibold text-stone-800">{k.keyword}</td>
                  <td className="py-3 font-mono text-stone-600">{k.search_volume}</td>
                  <td className="py-3 font-mono">
                    <span
                      className={`px-2 py-0.5 rounded font-semibold ${
                        k.difficulty < 20
                          ? "text-green-700 bg-green-50"
                          : k.difficulty < 40
                          ? "text-amber-700 bg-amber-50"
                          : "text-red-700 bg-red-50"
                      }`}
                    >
                      {k.difficulty}/100
                    </span>
                  </td>
                  <td className="py-3 uppercase text-[10px] font-bold text-stone-500">
                    {k.intent}
                  </td>
                  <td className="py-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        k.priority === "high"
                          ? "bg-red-50 text-red-700"
                          : k.priority === "medium"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-stone-100 text-stone-600"
                      }`}
                    >
                      {k.priority}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 text-destructive hover:bg-red-50"
                      onClick={() => delM.mutate(k.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {keywords.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-stone-400 italic">
                    Belum ada kata kunci terdaftar. Tambahkan untuk memulai riset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Keyword Dialog */}
      <Dialog open={isAdding} onOpenChange={(o) => !o && setIsAdding(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Tambahkan Target Keyword</DialogTitle>
            <DialogDescription>Masukkan kata kunci penelusuran baru yang ingin ditargetkan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-xs font-semibold">Keyword / Kata Kunci</Label>
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="penginapan wisuda unnes semarang"
                className="mt-1 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">Volume (Pencarian Bulanan)</Label>
                <Input
                  type="number"
                  value={newVol}
                  onChange={(e) => setNewVol(Number(e.target.value))}
                  className="mt-1 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold">Difficulty (Kesulitan 0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={newDiff}
                  onChange={(e) => setNewDiff(Number(e.target.value))}
                  className="mt-1 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs font-semibold">Intent</Label>
                <Select value={newIntent} onValueChange={setNewIntent}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="informational">Informational</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="transactional">Transactional</SelectItem>
                    <SelectItem value="navigational">Navigational</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold">Priority</Label>
                <Select value={newPriority} onValueChange={setNewPriority}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAdding(false)}>
              Cancel
            </Button>
            <Button
              className="bg-teal-700 hover:bg-teal-800"
              onClick={() => {
                if (!newKeyword.trim()) {
                  toast.error("Isi kata kunci");
                  return;
                }
                addM.mutate({
                  keyword: newKeyword.trim(),
                  search_volume: newVol,
                  difficulty: newDiff,
                  intent: newIntent,
                  priority: newPriority,
                  traffic_opportunity: Math.round(newVol * (1 - newDiff / 100)),
                });
                setIsAdding(false);
              }}
            >
              Add Keyword
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================================
   5. PROGRAMMATIC SEO SECTION
   ============================================================================ */
function ProgrammaticSection({
  pages,
  schemas,
  onChanged,
}: {
  pages: any[];
  schemas: any[];
  onChanged: () => void;
}) {
  const [kwInput, setKwInput] = useState("");
  const [locationInput, setLocationInput] = useState("Semarang");
  const [typeInput, setTypeInput] = useState("hotel");
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewPage, setPreviewPage] = useState<any>(null);

  const generateM = useMutation({
    mutationFn: (f: any) => generateProgrammaticPage({ data: f }),
    onSuccess: (res) => {
      toast.success(`Halaman programmatic ${res.page.title} berhasil didraf!`);
      setKwInput("");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  const publishM = useMutation({
    mutationFn: (v: { id: string; published: boolean }) => publishProgrammaticPage({ data: v }),
    onSuccess: () => {
      toast.success("Page publish state updated!");
      onChanged();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-stone-800">Programmatic SEO Generator</h2>
        <p className="text-xs text-stone-400">Buat ratusan halaman pendaratan lokal secara otomatis berbasis template</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Generator Controls */}
        <Card className="p-5 border border-stone-200 bg-white space-y-4 h-fit">
          <h3 className="font-bold text-stone-800 text-sm">Generator Engine</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-semibold">Keyword Fokus (mis. dekat unnes)</Label>
              <Input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                placeholder="guesthouse dekat unnes"
                className="mt-1 text-sm font-semibold"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Lokasi / Wilayah</Label>
              <Input
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="Gunungpati Semarang"
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Tipe Akomodasi</Label>
              <Select value={typeInput} onValueChange={setTypeInput}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="guesthouse">Guesthouse</SelectItem>
                  <SelectItem value="hotel">Hotel</SelectItem>
                  <SelectItem value="penginapan">Penginapan Rombongan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full bg-teal-700 hover:bg-teal-800 text-white mt-3"
              disabled={generateM.isPending}
              onClick={() => {
                if (!kwInput.trim()) {
                  toast.error("Isi kata kunci fokus");
                  return;
                }
                generateM.mutate({
                  keyword: kwInput.trim(),
                  location: locationInput,
                  type: typeInput,
                });
              }}
            >
              {generateM.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Generate Landing Page
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* Page List & Queue */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-bold text-stone-700 text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-sky-600" /> Page Generation Queue
          </h3>
          <div className="space-y-3">
            {pages.map((p) => (
              <Card key={p.id} className="p-4 border border-stone-200 bg-white hover:shadow-sm transition">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-teal-600 font-bold bg-teal-50 px-2 py-0.5 rounded">
                        {p.slug}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          p.published
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {p.published ? "Published" : "Draft"}
                      </span>
                    </div>
                    <h4 className="mt-2 font-bold text-stone-800 text-sm truncate">{p.title}</h4>
                    <p className="text-xs text-stone-400 mt-1 line-clamp-1">{p.meta_description}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0 bg-white"
                      onClick={() => setPreviewPage(p)}
                      title="Lihat Pratinjau Konten"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Switch
                      checked={p.published}
                      onCheckedChange={(v) => publishM.mutate({ id: p.id, published: v })}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Schema Registry block list */}
      <Card className="p-5 border border-stone-200 bg-white space-y-4">
        <h3 className="font-bold text-stone-800 text-sm">Registered Structured Schema markup (JSON-LD)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {schemas.map((s) => (
            <div key={s.id} className="p-4 bg-stone-50 border border-stone-100 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                  <FileCode className="h-4 w-4 text-teal-600" /> {s.name}
                </span>
                <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                  {s.schema_type}
                </span>
              </div>
              <pre className="p-3 bg-stone-900 rounded-lg text-[10px] font-mono text-emerald-400 overflow-x-auto max-h-40">
                {JSON.stringify(s.json_ld, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewPage} onOpenChange={(o) => !o && setPreviewPage(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pratinjau Halaman Programmatic</DialogTitle>
            <DialogDescription>
              Tampilan rute dinamis: {previewPage?.slug}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3 border-t border-b border-stone-100">
            <div>
              <span className="text-[10px] font-mono uppercase text-stone-400">Meta Title:</span>
              <p className="font-bold text-stone-800 text-sm">{previewPage?.meta_title}</p>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-stone-400">Meta Description:</span>
              <p className="text-stone-600 text-xs leading-relaxed">{previewPage?.meta_description}</p>
            </div>
            <div className="bg-stone-50 p-4 rounded-xl border border-stone-200/50">
              <span className="text-[10px] font-mono uppercase text-stone-400 block mb-2">HTML Content:</span>
              <div
                className="prose prose-sm text-stone-700 max-w-none"
                dangerouslySetInnerHTML={{ __html: previewPage?.content ?? "" }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button className="bg-teal-700 text-white hover:bg-teal-800" onClick={() => setPreviewPage(null)}>
              Close Preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================================
   6. AI CONTENT STUDIO SECTION
   ============================================================================ */
function ContentStudioSection() {
  const [title, setTitle] = useState("Penginapan Murah dekat Kampus UNNES Semarang");
  const [blocks, setBlocks] = useState([
    "Pomah Guesthouse adalah penginapan bergaya butik yang berlokasi strategis di Gunungpati, Semarang. Sangat cocok untuk akomodasi wisuda, kunjungan keluarga, maupun kegiatan dinas.",
    "Dengan suasana asri khas pedesaan Semarang dan parkiran luas yang mampu menampung bus sedang, guesthouse ini menawarkan kenyamanan menginap yang istimewa dengan harga terjangkau.",
  ]);
  const [newBlock, setNewBlock] = useState("");
  const [isGeneratingArticle, setIsGeneratingArticle] = useState(false);

  // Dynamic calculations
  const wordCount = (title + blocks.join(" ")).split(/\s+/).filter(Boolean).length;
  const readabilityScore = Math.min(100, Math.max(30, 100 - Math.abs(200 - wordCount) * 0.15));
  const seoScore = Math.min(
    100,
    (title.toLowerCase().includes("unnes") ? 30 : 0) +
      (blocks.join(" ").toLowerCase().includes("semarang") ? 30 : 0) +
      (wordCount > 100 ? 40 : 15),
  );

  const handleAddBlock = () => {
    if (newBlock.trim()) {
      setBlocks([...blocks, newBlock.trim()]);
      setNewBlock("");
      toast.success("Paragraph block added to article!");
    }
  };

  const handleAiWrite = () => {
    setIsGeneratingArticle(true);
    setTimeout(() => {
      setBlocks([
        ...blocks,
        "Untuk tamu rombongan yang berkunjung dalam rangka wisuda Universitas Negeri Semarang (UNNES), guesthouse kami menawarkan paket sewa seluruh rumah dengan potongan harga khusus. Dilengkapi 5 kamar tidur ber-AC, dispenser air minum, dan koneksi internet cepat.",
      ]);
      setIsGeneratingArticle(false);
      toast.success("AI Content Agent has generated and appended a semantically optimized paragraph!");
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-stone-800">AI Content Studio</h2>
        <p className="text-xs text-stone-400">Tulis dan optimalkan artikel Anda dibantu AI Editor Asisten</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Editor Notion-style */}
        <div className="lg:col-span-3 space-y-4">
          <Card className="p-6 border border-stone-200 bg-white space-y-4 min-h-[500px]">
            {/* Title Block */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full text-2xl font-bold border-0 border-b border-stone-100 pb-2 focus:ring-0 focus:border-teal-600 outline-none text-stone-800"
              placeholder="Judul Artikel..."
            />

            {/* Paragraph Blocks */}
            <div className="space-y-4 mt-6">
              {blocks.map((b, i) => (
                <div key={i} className="group relative p-3 rounded-lg hover:bg-stone-50 transition border border-transparent hover:border-stone-100 flex items-start gap-3">
                  <div className="flex-1 text-sm text-stone-700 leading-relaxed outline-none">
                    {b}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:bg-red-50"
                    onClick={() => setBlocks(blocks.filter((_, idx) => idx !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add block control */}
            <div className="mt-8 pt-4 border-t border-stone-100 space-y-3">
              <Textarea
                rows={2}
                value={newBlock}
                onChange={(e) => setNewBlock(e.target.value)}
                placeholder="Mulai mengetik paragraf baru di sini..."
                className="text-sm bg-stone-50 border-stone-200 focus:bg-white"
              />
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 font-semibold text-teal-700 border-teal-200 hover:bg-teal-50"
                  disabled={isGeneratingArticle}
                  onClick={handleAiWrite}
                >
                  {isGeneratingArticle ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Tulis dengan AI
                </Button>
                <Button
                  size="sm"
                  className="h-8 bg-stone-900 text-white hover:bg-stone-800"
                  onClick={handleAddBlock}
                >
                  Tambah Paragraf
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Dynamic Sidebar Scoring */}
        <div className="space-y-6">
          <Card className="p-5 border border-stone-200 bg-white space-y-5">
            <h3 className="font-bold text-stone-800 text-sm">Optimization metrics</h3>

            {/* Readability Score */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-stone-500">Readability</span>
                <span className="text-teal-700">{Math.round(readabilityScore)}/100</span>
              </div>
              <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-teal-600 rounded-full transition-all duration-300"
                  style={{ width: `${readabilityScore}%` }}
                />
              </div>
            </div>

            {/* Search Optimization Score */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-stone-500">SEO Score</span>
                <span className="text-amber-700">{Math.round(seoScore)}/100</span>
              </div>
              <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${seoScore}%` }}
                />
              </div>
            </div>

            {/* Word count */}
            <div className="flex justify-between text-xs text-stone-500 border-t border-stone-100 pt-3">
              <span>Word Count:</span>
              <span className="font-mono">{wordCount} kata</span>
            </div>
          </Card>

          {/* AI content strategist suggestions */}
          <Card className="p-5 border border-stone-200 bg-white space-y-3">
            <h3 className="font-bold text-stone-800 text-xs uppercase tracking-wider">AI Suggestions</h3>
            <div className="text-xs text-stone-600 space-y-2">
              <p className="flex items-start gap-1.5">
                <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                Keyword **'Semarang'** sudah tercakup di isi artikel.
              </p>
              <p className="flex items-start gap-1.5">
                <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                Keyword **'UNNES'** sudah tercakup di judul.
              </p>
              {wordCount < 150 && (
                <p className="flex items-start gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  Artikel Anda terlalu pendek. Tambahkan minimal 100 kata lagi agar diindeks dengan baik oleh Google.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   7. INTERNAL LINKING SECTION
   ============================================================================ */
function LinkingSection({
  nodes,
  links,
  onChanged,
}: {
  nodes: any[];
  links: any[];
  onChanged: () => void;
}) {
  const approveM = useMutation({
    mutationFn: (v: { id: string; status: "approved" | "rejected" }) =>
      approveInternalLink({ data: v }),
    onSuccess: () => {
      toast.success("Linking suggestion updated!");
      onChanged();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-stone-800">Internal Linking Engine</h2>
        <p className="text-xs text-stone-400">Analisis keterkaitan halaman internal dan visualisasi peta node kluster</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Node Graph Visualizer */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="font-semibold text-stone-700 text-sm">Visual Connection Map</h3>
          <SvgNodeMap nodes={nodes} links={links} />
        </div>

        {/* Links suggestions list */}
        <div className="space-y-4">
          <h3 className="font-semibold text-stone-700 text-sm">AI Suggested Links</h3>
          <div className="space-y-3">
            {links
              .filter((l) => l.status === "pending")
              .map((l) => (
                <Card key={l.id} className="p-4 border border-stone-200 bg-white space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] text-teal-600 font-bold bg-teal-50 px-1.5 py-0.5 rounded">
                      Pending Approval
                    </span>
                    <span className="text-[10px] text-stone-400">Anchor: '{l.anchor_text}'</span>
                  </div>
                  <div className="text-xs space-y-1.5 font-medium text-stone-600">
                    <div className="flex items-center gap-1.5">
                      <span className="w-12 text-stone-400 text-right">Source:</span>
                      <span className="font-mono truncate bg-stone-100 px-1.5 rounded">{l.source_url}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-12 text-stone-400 text-right">Target:</span>
                      <span className="font-mono truncate bg-stone-100 px-1.5 rounded">{l.target_url}</span>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-xs text-destructive"
                      onClick={() => approveM.mutate({ id: l.id, status: "rejected" })}
                    >
                      Tolak
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs bg-teal-700 text-white hover:bg-teal-800"
                      onClick={() => approveM.mutate({ id: l.id, status: "approved" })}
                    >
                      Hubungkan
                    </Button>
                  </div>
                </Card>
              ))}
            {links.filter((l) => l.status === "pending").length === 0 && (
              <p className="text-xs text-stone-400 italic text-center py-6">
                Tidak ada saran tautan internal baru saat ini.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// SVG Node Link Map Helper Component
function SvgNodeMap({ nodes, links }: { nodes: any[]; links: any[] }) {
  const width = 500;
  const height = 280;
  const positions: Record<string, { x: number; y: number }> = {};

  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    const radius = node.group === "main" ? 70 : 110;
    positions[node.id] = {
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
    };
  });

  return (
    <div className="relative border border-stone-200 bg-stone-50 rounded-2xl p-4 overflow-hidden h-[300px]">
      <svg className="w-full h-full" viewBox={`0 0 ${width} ${height}`}>
        {/* Draw Link lines */}
        {links.map((link, idx) => {
          const start = positions[link.source_url];
          const end = positions[link.target_url];
          if (!start || !end) return null;
          return (
            <line
              key={idx}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={link.status === "approved" ? "#0d9488" : "#cbd5e1"}
              strokeWidth="2"
              strokeDasharray={link.status === "pending" ? "4 4" : "none"}
            />
          );
        })}
        {/* Draw Node circles */}
        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const isMain = node.group === "main";
          return (
            <g key={node.id} className="cursor-pointer group">
              <circle
                cx={pos.x}
                cy={pos.y}
                r={isMain ? 18 : 12}
                fill={isMain ? "#0f766e" : node.group === "pSEO" ? "#0284c7" : "#0369a1"}
                className="transition group-hover:scale-110"
              />
              <text
                x={pos.x}
                y={pos.y + (isMain ? 30 : 22)}
                textAnchor="middle"
                className="text-[9px] font-mono fill-stone-600 font-bold select-none"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============================================================================
   8. REVIEW INTELLIGENCE SECTION
   ============================================================================ */
function ReviewsSection({ reviews }: { reviews: any[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-stone-800">Review Intelligence</h2>
        <p className="text-xs text-stone-400">Analisis ulasan pelanggan di OTA & Google Maps untuk diekstrak jadi peluang SEO</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {reviews.map((r) => (
          <Card key={r.id} className="p-5 border border-stone-200 bg-white flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-teal-600 font-bold bg-teal-50 px-2 py-0.5 rounded">
                  {r.review_source}
                </span>
                <span className="flex items-center gap-1 text-amber-500">
                  {Array.from({ length: r.rating }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-current" />
                  ))}
                </span>
              </div>
              <h4 className="mt-2.5 font-bold text-stone-800 text-sm">{r.guest_name}</h4>
              <p className="mt-2 text-xs text-stone-600 leading-relaxed italic">
                "{r.content}"
              </p>

              {/* Extracted keywords */}
              <div className="mt-4 flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] text-stone-400 font-mono">Keywords:</span>
                {r.extracted_keywords.map((kw: string, i: number) => (
                  <span
                    key={i}
                    className="bg-stone-100 text-stone-600 text-[10px] px-2 py-0.5 rounded font-mono"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            {/* AI SEO Suggestions */}
            <div className="mt-5 pt-3.5 border-t border-stone-100 space-y-2 text-xs">
              <span className="font-bold text-teal-800 flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" /> AI SEO Opportunities:
              </span>
              {r.seo_suggestions.map((s: string, i: number) => (
                <p key={i} className="text-stone-600 flex items-start gap-1">
                  <ChevronRight className="h-4 w-4 text-teal-600 shrink-0" />
                  {s}
                </p>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================================
   9. SEARCH CONSOLE SECTION
   ============================================================================ */
function SearchConsoleSection({ data }: { data: any }) {
  if (!data) return <div className="p-6 text-sm text-stone-400 font-mono">Loading Search Console...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-800">Google Search Console</h2>
          <p className="text-xs text-stone-400">
            Data kueri penelusuran, impresi, CTR, dan sitemap dari domain resmi {data.domain} secara real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${data.connected ? "bg-emerald-500 animate-pulse" : "bg-teal-600 animate-pulse"}`} />
          <span className="text-xs font-mono text-stone-600 font-bold uppercase">
            {data.connected ? "Google API Connected" : "Estimated Realtime Mode"}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="p-5 border border-stone-200 bg-white">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider font-medium">Total Clicks</span>
          <p className="mt-2 text-2xl font-bold text-stone-800 font-mono">{data.stats.clicks.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-emerald-600 mt-1 font-semibold">+14.2% dibanding 7 hari lalu</p>
        </Card>
        <Card className="p-5 border border-stone-200 bg-white">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider font-medium">Total Impressions</span>
          <p className="mt-2 text-2xl font-bold text-stone-800 font-mono">{data.stats.impressions.toLocaleString("id-ID")}</p>
          <p className="text-[10px] text-emerald-600 mt-1 font-semibold">+8.5% dibanding 7 hari lalu</p>
        </Card>
        <Card className="p-5 border border-stone-200 bg-white">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider font-medium">Average CTR</span>
          <p className="mt-2 text-2xl font-bold text-stone-800 font-mono">{data.stats.ctr}%</p>
          <p className="text-[10px] text-emerald-600 mt-1 font-semibold">+1.1% dibanding 7 hari lalu</p>
        </Card>
        <Card className="p-5 border border-stone-200 bg-white">
          <span className="text-xs font-semibold text-stone-400 uppercase tracking-wider font-medium">Average Position</span>
          <p className="mt-2 text-2xl font-bold text-stone-800 font-mono">{data.stats.avgPosition}</p>
          <p className="text-[10px] text-stone-500 mt-1 font-semibold">Berdasarkan kata kunci aktif</p>
        </Card>
      </div>

      {/* Chart comparison */}
      <Card className="p-6 border border-stone-200 bg-white">
        <h3 className="font-semibold text-stone-800 text-sm">Clicks & Impressions Trend</h3>
        <div className="h-64 mt-4 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
              <XAxis dataKey="date" stroke="#a8a29e" fontSize={11} tickLine={false} />
              <YAxis stroke="#a8a29e" fontSize={11} tickLine={false} />
              <Tooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" name="Clicks" dataKey="clicks" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 4 }} />
              <Line type="monotone" name="Impressions" dataKey="impressions" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Sitemaps and Indexing status */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800 text-sm mb-4">Sitemaps Status</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left font-mono text-[9px] uppercase tracking-wider text-stone-400 border-b border-stone-100 pb-2">
                <tr>
                  <th className="pb-2">Sitemap URL</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Last Read</th>
                  <th className="pb-2">Discovered URLs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.sitemaps.map((s: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-2.5 font-mono text-teal-700 font-semibold truncate max-w-[200px]">{s.url}</td>
                    <td className="py-2.5">{s.type}</td>
                    <td className="py-2.5 font-mono text-stone-500">{s.lastRead}</td>
                    <td className="py-2.5 font-mono font-bold text-stone-700">{s.urls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 border border-stone-200 bg-white">
          <h3 className="font-semibold text-stone-800 text-sm mb-4">Indexing Coverage Status</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-stone-400 uppercase">Valid Pages</span>
              <p className="text-xl font-mono font-bold text-emerald-600 mt-1">{data.indexing.valid}</p>
            </div>
            <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-stone-400 uppercase">Excluded</span>
              <p className="text-xl font-mono font-bold text-stone-500 mt-1">{data.indexing.excluded}</p>
            </div>
            <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-stone-400 uppercase">Warning</span>
              <p className="text-xl font-mono font-bold text-amber-600 mt-1">{data.indexing.warning}</p>
            </div>
            <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl text-center">
              <span className="text-[10px] font-semibold text-stone-400 uppercase">Errors</span>
              <p className="text-xl font-mono font-bold text-red-600 mt-1">{data.indexing.error}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Queries Table */}
      <Card className="p-5 border border-stone-200 bg-white">
        <h3 className="font-semibold text-stone-800 text-sm mb-4">Top Penelusuran (Queries)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left font-mono text-[9px] uppercase tracking-widest text-stone-400 border-b border-stone-100">
              <tr>
                <th className="pb-2">Query</th>
                <th className="pb-2">Clicks</th>
                <th className="pb-2">Impressions</th>
                <th className="pb-2">CTR</th>
                <th className="pb-2 text-right">Avg. Position</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 font-mono">
              {data.queries.map((q: any, idx: number) => (
                <tr key={idx} className="hover:bg-stone-50/50">
                  <td className="py-2.5 font-sans font-semibold text-stone-800">{q.query}</td>
                  <td className="py-2.5 text-stone-600 font-bold">{q.clicks}</td>
                  <td className="py-2.5 text-stone-600">{q.impressions}</td>
                  <td className="py-2.5 text-stone-600">{q.ctr}%</td>
                  <td className="py-2.5 text-right font-bold text-teal-700">{q.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
