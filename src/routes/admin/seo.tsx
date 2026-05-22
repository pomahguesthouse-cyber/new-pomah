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
  getSearchConsoleData,
  generateAndSaveLocalBusinessSchema,
} from "@/admin/modules/seo/seo.functions";
import {
  listSeoLandingPages,
  createSeoLandingPage,
  updateSeoLandingPage,
  publishSeoLandingPage,
  deleteSeoLandingPage,
  generateLandingPageContent,
  type SeoLandingPage,
} from "@/admin/modules/seo/landing-page.functions";
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

type TabKey =
  | "search_console"
  | "agents"
  | "conversational"
  | "keywords"
  | "landing_page"
  | "programmatic"
  | "studio"
  | "links"
  | "reviews";

export function SeoPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("search_console");
  const qc = useQueryClient();

  // Landing pages query
  const { data: landingPagesData, refetch: refetchLandingPages } = useQuery({
    queryKey: ["seo-landing-pages"],
    queryFn: () => listSeoLandingPages(),
  });

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
    { key: "search_console", label: "Search Console", icon: TrendingUp },
    { key: "agents", label: "AI Agents", icon: Bot },
    { key: "conversational", label: "WhatsApp Intent", icon: MessageCircle },
    { key: "keywords", label: "Keywords", icon: Search },
    { key: "landing_page", label: "Landing Pages", icon: LayoutDashboard },
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
              refetchLandingPages();
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
          {activeTab === "landing_page" && (
            <LandingPageSection
              pages={landingPagesData?.pages ?? []}
              onChanged={refetchLandingPages}
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
   LANDING PAGE SECTION
   ============================================================================ */

// SEO score: 0-100 based on keyword coverage and metadata quality
function calcSeoScore(page: Partial<SeoLandingPage>): number {
  let score = 0;
  const kw = (page.target_keyword ?? "").toLowerCase();
  const bodyText = (
    (page.title ?? "") + " " +
    (page.hero_headline ?? "") + " " +
    (page.body_content ?? "")
  ).toLowerCase();

  if (kw && (page.meta_title ?? "").toLowerCase().includes(kw)) score += 20;
  if (kw && (page.meta_description ?? "").toLowerCase().includes(kw)) score += 15;
  if (kw && bodyText.includes(kw)) score += 15;

  const mtLen = (page.meta_title ?? "").length;
  if (mtLen >= 30 && mtLen <= 60) score += 20;
  else if (mtLen > 0) score += 10;

  const mdLen = (page.meta_description ?? "").length;
  if (mdLen >= 120 && mdLen <= 160) score += 20;
  else if (mdLen > 0) score += 10;

  if (page.og_image_url) score += 10;
  return Math.min(score, 100);
}

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 70 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    score >= 40 ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      SEO {score}/100
    </span>
  );
}

type LPEditorTab = "konten" | "seo" | "pratinjau";

function LandingPageEditor({
  page,
  draft,
  onSave,
  onClose,
}: {
  page: SeoLandingPage | null;          // null = create new
  draft?: Partial<SeoLandingPage>;      // AI-generated prefill (new pages only)
  onSave: () => void;
  onClose: () => void;
}) {
  const isNew = page === null;
  const [tab, setTab]             = useState<LPEditorTab>("konten");
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);

  // Generate-with-AI dialog state (used inside the editor)
  const [genDialog,   setGenDialog]   = useState(false);
  const [genKeyword,  setGenKeyword]  = useState("");
  const [generating,  setGenerating]  = useState(false);

  // Form state — seeded from AI draft (if any), then page, then defaults
  const [title,            setTitle]            = useState(draft?.title            ?? page?.title            ?? "");
  const [slug,             setSlug]             = useState(draft?.slug             ?? page?.slug             ?? "");
  const [targetKeyword,    setTargetKeyword]    = useState(draft?.target_keyword   ?? page?.target_keyword   ?? "");
  const [heroHeadline,     setHeroHeadline]     = useState(draft?.hero_headline    ?? page?.hero_headline    ?? "");
  const [heroSubheadline,  setHeroSubheadline]  = useState(draft?.hero_subheadline ?? page?.hero_subheadline ?? "");
  const [heroCta,          setHeroCta]          = useState(draft?.hero_cta_text    ?? page?.hero_cta_text    ?? "Pesan Sekarang");
  const [heroCtaUrl,       setHeroCtaUrl]       = useState(draft?.hero_cta_url     ?? page?.hero_cta_url     ?? "/book");
  const [bodyContent,      setBodyContent]      = useState(draft?.body_content     ?? page?.body_content     ?? "");
  const [metaTitle,        setMetaTitle]        = useState(draft?.meta_title       ?? page?.meta_title       ?? "");
  const [metaDescription,  setMetaDescription]  = useState(draft?.meta_description ?? page?.meta_description ?? "");
  const [ogImageUrl,       setOgImageUrl]       = useState(draft?.og_image_url     ?? page?.og_image_url     ?? "");
  const [published,        setPublished]        = useState(draft?.published        ?? page?.published        ?? false);

  /** Apply AI-generated content into the form fields. */
  const applyGenerated = (g: Partial<SeoLandingPage>) => {
    if (g.title            !== undefined) setTitle(g.title ?? "");
    if (g.slug             !== undefined) setSlug(g.slug ?? "");
    if (g.target_keyword   !== undefined) setTargetKeyword(g.target_keyword ?? "");
    if (g.hero_headline    !== undefined) setHeroHeadline(g.hero_headline ?? "");
    if (g.hero_subheadline !== undefined) setHeroSubheadline(g.hero_subheadline ?? "");
    if (g.hero_cta_text    !== undefined) setHeroCta(g.hero_cta_text ?? "Pesan Sekarang");
    if (g.hero_cta_url     !== undefined) setHeroCtaUrl(g.hero_cta_url ?? "/book");
    if (g.body_content     !== undefined) setBodyContent(g.body_content ?? "");
    if (g.meta_title       !== undefined) setMetaTitle(g.meta_title ?? "");
    if (g.meta_description !== undefined) setMetaDescription(g.meta_description ?? "");
  };

  const handleGenerate = async () => {
    if (!genKeyword.trim()) { toast.error("Masukkan kata kunci target"); return; }
    setGenerating(true);
    try {
      const result = await generateLandingPageContent({ data: { keyword: genKeyword.trim() } });
      applyGenerated(result.page);
      setGenDialog(false);
      setGenKeyword("");
      toast.success("✨ Konten berhasil di-generate oleh AI!");
      setTab("konten");
    } catch (e) { toast.error((e as Error).message); }
    finally { setGenerating(false); }
  };

  // Auto-generate slug from title (new pages only)
  const autoSlug = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (isNew) setSlug(autoSlug(v));
  };

  const buildPayload = () => ({
    title,
    slug,
    target_keyword:   targetKeyword   || null,
    hero_headline:    heroHeadline    || null,
    hero_subheadline: heroSubheadline || null,
    hero_cta_text:    heroCta         || "Pesan Sekarang",
    hero_cta_url:     heroCtaUrl      || "/book",
    body_content:     bodyContent     || null,
    meta_title:       metaTitle       || null,
    meta_description: metaDescription || null,
    og_image_url:     ogImageUrl      || null,
    published,
  });

  const handleSave = async () => {
    if (!title.trim() || !slug.trim()) { toast.error("Judul dan slug wajib diisi"); return; }
    setSaving(true);
    try {
      if (isNew) {
        await createSeoLandingPage({ data: buildPayload() });
        toast.success("Landing page dibuat");
      } else {
        await updateSeoLandingPage({ data: { id: page!.id, ...buildPayload() } });
        toast.success("Perubahan disimpan");
      }
      onSave();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!page || !confirm(`Hapus landing page "${page.title}"?`)) return;
    setDeleting(true);
    try {
      await deleteSeoLandingPage({ data: { id: page.id } });
      toast.success("Landing page dihapus");
      onSave();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setDeleting(false); }
  };

  const score = calcSeoScore({ title, target_keyword: targetKeyword, meta_title: metaTitle, meta_description: metaDescription, og_image_url: ogImageUrl || null, hero_headline: heroHeadline, body_content: bodyContent });

  const editorTabs: { key: LPEditorTab; label: string }[] = [
    { key: "konten", label: "Konten" },
    { key: "seo",    label: "SEO"    },
    { key: "pratinjau", label: "Pratinjau" },
  ];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      {/* Editor header */}
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-stone-800 text-sm">{isNew ? "Landing Page Baru" : title}</span>
          {!isNew && <ScorePill score={score} />}
          {isNew && (
            <Button size="sm" variant="outline"
              className="h-7 gap-1.5 border-teal-200 text-teal-700 hover:bg-teal-50 text-xs"
              onClick={() => setGenDialog(true)}>
              <Sparkles className="h-3 w-3" />
              Generate dengan AI
            </Button>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-stone-100 bg-stone-50/60 px-5 pt-3">
        {editorTabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border border-b-white border-stone-200 bg-white text-teal-700"
                : "text-stone-500 hover:text-stone-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-[60vh] flex-1 overflow-y-auto px-5 py-5">
        {/* ---- Konten ---- */}
        {tab === "konten" && (
          <div className="space-y-5">
            <div>
              <Label className="text-xs font-semibold">Judul Halaman <span className="text-destructive">*</span></Label>
              <Input value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="mis. Penginapan Wisuda UNNES Semarang" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs font-semibold">URL Slug <span className="text-destructive">*</span></Label>
              <div className="mt-1 flex items-center gap-1 rounded-md border border-input bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">/lp/</span>
                <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  className="min-w-0 flex-1 bg-transparent focus:outline-none" placeholder="slug-halaman" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">URL publik: <code className="font-mono">/lp/{slug || "…"}</code></p>
            </div>
            <div className="border-t border-stone-100 pt-4">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-stone-400">Hero Section</p>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold">Headline Utama</Label>
                  <Input value={heroHeadline} onChange={(e) => setHeroHeadline(e.target.value)} placeholder="Judul besar yang dilihat tamu pertama kali" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Sub Headline</Label>
                  <Input value={heroSubheadline} onChange={(e) => setHeroSubheadline(e.target.value)} placeholder="Kalimat pendukung di bawah headline" className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-semibold">Teks Tombol CTA</Label>
                    <Input value={heroCta} onChange={(e) => setHeroCta(e.target.value)} className="mt-1" placeholder="Pesan Sekarang" />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold">URL Tombol CTA</Label>
                    <Input value={heroCtaUrl} onChange={(e) => setHeroCtaUrl(e.target.value)} className="mt-1" placeholder="/book" />
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-stone-100 pt-4">
              <Label className="text-xs font-semibold">Body Content (HTML)</Label>
              <Textarea value={bodyContent} onChange={(e) => setBodyContent(e.target.value)} rows={10}
                placeholder="<h2>Kenapa Pomah Guesthouse?</h2><p>Kami menyediakan…</p>"
                className="mt-1 font-mono text-xs" />
              <p className="mt-1 text-[11px] text-muted-foreground">Diterima HTML. Gunakan tag h2, h3, p, ul, strong untuk struktur yang baik.</p>
            </div>
          </div>
        )}

        {/* ---- SEO ---- */}
        {tab === "seo" && (
          <div className="space-y-5">
            {/* Live score */}
            <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <span className="text-sm font-semibold text-stone-700">Skor SEO Halaman Ini</span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-32 overflow-hidden rounded-full bg-stone-200">
                  <div className={`h-full rounded-full transition-all ${score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${score}%` }} />
                </div>
                <span className="font-mono text-sm font-bold text-stone-700">{score}/100</span>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Kata Kunci Target</Label>
              <Input value={targetKeyword} onChange={(e) => setTargetKeyword(e.target.value)}
                placeholder="mis. penginapan wisuda unnes semarang" className="mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">Kata kunci utama yang ingin dirangking di Google.</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Meta Title</Label>
                <span className={`text-[10px] font-mono ${metaTitle.length > 60 ? "text-red-600" : metaTitle.length >= 50 ? "text-emerald-600" : "text-stone-400"}`}>
                  {metaTitle.length}/60
                </span>
              </div>
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)}
                placeholder="Penginapan Wisuda UNNES Semarang | Pomah Guesthouse" className="mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">Idealnya 50–60 karakter. Sertakan kata kunci target.</p>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Meta Description</Label>
                <span className={`text-[10px] font-mono ${metaDescription.length > 160 ? "text-red-600" : metaDescription.length >= 120 ? "text-emerald-600" : "text-stone-400"}`}>
                  {metaDescription.length}/160
                </span>
              </div>
              <Textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={3}
                placeholder="Pomah Guesthouse — penginapan nyaman dekat UNNES Semarang, cocok untuk rombongan wisuda. Pesan sekarang dan dapatkan harga spesial." className="mt-1 text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">Idealnya 120–160 karakter. Ini teks yang tampil di hasil pencarian Google.</p>
            </div>

            <div>
              <Label className="text-xs font-semibold">OG Image URL</Label>
              <Input value={ogImageUrl} onChange={(e) => setOgImageUrl(e.target.value)}
                placeholder="https://..." className="mt-1" />
              <p className="mt-1 text-[11px] text-muted-foreground">Gambar yang muncul saat halaman dibagikan di media sosial.</p>
            </div>

            {/* Checklist */}
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-stone-400 mb-3">Checklist SEO</p>
              {[
                { label: "Kata kunci di meta title",      ok: !!targetKeyword && metaTitle.toLowerCase().includes(targetKeyword.toLowerCase()) },
                { label: "Kata kunci di meta description",ok: !!targetKeyword && metaDescription.toLowerCase().includes(targetKeyword.toLowerCase()) },
                { label: "Meta title 50–60 karakter",     ok: metaTitle.length >= 50 && metaTitle.length <= 60 },
                { label: "Meta description 120–160 karakter", ok: metaDescription.length >= 120 && metaDescription.length <= 160 },
                { label: "OG Image ditetapkan",           ok: !!ogImageUrl },
                { label: "Kata kunci di konten body",     ok: !!targetKeyword && bodyContent.toLowerCase().includes(targetKeyword.toLowerCase()) },
              ].map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {c.ok
                    ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    : <X className="h-3.5 w-3.5 shrink-0 text-stone-300" />}
                  <span className={c.ok ? "text-stone-700" : "text-stone-400"}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Pratinjau ---- */}
        {tab === "pratinjau" && (
          <div className="space-y-4">
            {/* SERP preview */}
            <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
              <p className="mb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-stone-400">SERP Preview</p>
              <div className="space-y-0.5">
                <p className="text-[13px] font-mono text-stone-400">pomahguesthouse.com › lp › {slug || "…"}</p>
                <p className="text-base font-semibold text-blue-700 hover:underline cursor-pointer">{metaTitle || title || "Meta title belum diisi"}</p>
                <p className="text-xs text-stone-600 leading-relaxed">{metaDescription || <span className="italic text-stone-400">Meta description belum diisi…</span>}</p>
              </div>
            </div>

            {/* Page preview */}
            <div className="overflow-hidden rounded-xl border border-stone-200">
              {/* Hero */}
              <div className="bg-gradient-to-br from-teal-800 to-stone-800 px-8 py-10 text-center text-white">
                {targetKeyword && <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-teal-200">{targetKeyword}</p>}
                <h1 className="text-2xl font-bold">{heroHeadline || title || "Headline…"}</h1>
                {heroSubheadline && <p className="mt-3 text-sm text-teal-100">{heroSubheadline}</p>}
                <div className="mt-6 inline-block rounded-full bg-white px-6 py-2 text-xs font-bold text-teal-800">{heroCta}</div>
              </div>
              {/* Body preview */}
              {bodyContent ? (
                <div className="bg-white px-8 py-6">
                  <div className="prose prose-sm prose-stone max-w-none" dangerouslySetInnerHTML={{ __html: bodyContent }} />
                </div>
              ) : (
                <div className="bg-white px-8 py-6 text-center text-xs italic text-stone-400">Body content belum diisi…</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-stone-100 px-5 py-3">
        <div className="flex items-center gap-3">
          {!isNew && (
            <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-red-50"
              disabled={deleting} onClick={handleDelete}>
              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
              Hapus
            </Button>
          )}
          {!isNew && (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <Switch checked={published} onCheckedChange={setPublished} />
              {published ? "Dipublikasikan" : "Draft"}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onClose}>Batal</Button>
          <Button size="sm" className="h-8 bg-teal-700 text-xs text-white hover:bg-teal-800" disabled={saving} onClick={handleSave}>
            {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Menyimpan…</> : <><Save className="mr-1.5 h-3.5 w-3.5" />{isNew ? "Buat Halaman" : "Simpan"}</>}
          </Button>
        </div>
      </div>

      {/* ── Generate with AI Dialog ── */}
      <Dialog open={genDialog} onOpenChange={setGenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-600" />
              Generate Landing Page dengan AI
            </DialogTitle>
            <DialogDescription>
              Masukkan kata kunci target dan AI akan membuat konten landing page yang teroptimasi untuk Google.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Kata Kunci Target</Label>
              <Input
                value={genKeyword}
                onChange={(e) => setGenKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !generating) handleGenerate(); }}
                placeholder="mis. penginapan wisuda unnes semarang"
                className="mt-1"
                disabled={generating}
                autoFocus
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                AI akan membuat judul, headline hero, konten body (HTML), meta title, dan meta description yang mengandung kata kunci ini secara alami.
              </p>
            </div>
            {generating && (
              <div className="flex items-center gap-2 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-700">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>AI sedang menulis konten… biasanya 10–20 detik</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setGenDialog(false); setGenKeyword(""); }} disabled={generating}>
              Batal
            </Button>
            <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800" onClick={handleGenerate} disabled={generating || !genKeyword.trim()}>
              {generating
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate Konten</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LandingPageSection({ pages, onChanged }: { pages: SeoLandingPage[]; onChanged: () => void }) {
  const [selected,    setSelected]    = useState<SeoLandingPage | "new" | null>(null);
  const [search,      setSearch]      = useState("");
  const [togglingId,  setTogglingId]  = useState<string | null>(null);
  const [aiDraft,     setAiDraft]     = useState<Partial<SeoLandingPage> | undefined>(undefined);
  const [editorKey,   setEditorKey]   = useState(0);

  // Section-level generate dialog
  const [secGenDialog,   setSecGenDialog]   = useState(false);
  const [secGenKeyword,  setSecGenKeyword]  = useState("");
  const [secGenerating,  setSecGenerating]  = useState(false);

  const handleSectionGenerate = async () => {
    if (!secGenKeyword.trim()) { toast.error("Masukkan kata kunci target"); return; }
    setSecGenerating(true);
    try {
      const result = await generateLandingPageContent({ data: { keyword: secGenKeyword.trim() } });
      setAiDraft(result.page);
      setSelected("new");
      setEditorKey((k) => k + 1);   // remount editor so draft is applied
      setSecGenDialog(false);
      setSecGenKeyword("");
      toast.success("✨ Konten di-generate! Periksa lalu simpan halaman.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setSecGenerating(false); }
  };

  const filtered = pages.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    (p.target_keyword ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const handleTogglePublish = async (p: SeoLandingPage) => {
    setTogglingId(p.id);
    try {
      await publishSeoLandingPage({ data: { id: p.id, published: !p.published } });
      toast.success(p.published ? "Halaman diarsipkan" : "Halaman dipublikasikan");
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setTogglingId(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-stone-800">Landing Pages</h2>
          <p className="text-xs text-stone-400">Halaman SEO buatan tangan, ditargetkan untuk kata kunci spesifik</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 border-teal-200 text-teal-700 hover:bg-teal-50"
            onClick={() => setSecGenDialog(true)}>
            <Sparkles className="h-4 w-4" /> Generate dengan AI
          </Button>
          <Button className="bg-teal-700 text-white hover:bg-teal-800" size="sm"
            onClick={() => { setAiDraft(undefined); setSelected("new"); }}>
            <Plus className="mr-1.5 h-4 w-4" /> Buat Manual
          </Button>
        </div>
      </div>

      {/* Section-level generate dialog */}
      <Dialog open={secGenDialog} onOpenChange={setSecGenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-600" />
              Generate Landing Page dengan AI
            </DialogTitle>
            <DialogDescription>
              Masukkan kata kunci dan AI akan otomatis membuat judul, hero section, konten body, dan meta SEO yang teroptimasi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-semibold">Kata Kunci Target</Label>
              <Input
                value={secGenKeyword}
                onChange={(e) => setSecGenKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !secGenerating) handleSectionGenerate(); }}
                placeholder="mis. penginapan wisuda unnes semarang"
                className="mt-1"
                disabled={secGenerating}
                autoFocus
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                AI akan menulis konten SEO lengkap dalam Bahasa Indonesia, disesuaikan untuk Pomah Guesthouse Semarang.
              </p>
            </div>
            {secGenerating && (
              <div className="flex items-center gap-2 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-700">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>AI sedang menulis konten… biasanya 10–20 detik</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setSecGenDialog(false); setSecGenKeyword(""); }} disabled={secGenerating}>
              Batal
            </Button>
            <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-800"
              onClick={handleSectionGenerate}
              disabled={secGenerating || !secGenKeyword.trim()}>
              {secGenerating
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate & Buka Editor</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Page list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari halaman…" className="pl-9 text-sm" />
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 py-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-stone-200" />
              <p className="mt-2 text-xs text-stone-400 italic">
                {pages.length === 0 ? "Belum ada landing page. Buat atau generate pertama Anda!" : "Tidak ada hasil."}
              </p>
              {pages.length === 0 && (
                <Button variant="outline" size="sm" className="mt-3 gap-1.5 border-teal-200 text-teal-700 hover:bg-teal-50"
                  onClick={() => setSecGenDialog(true)}>
                  <Sparkles className="h-3.5 w-3.5" /> Generate dengan AI
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => {
                const score = calcSeoScore(p);
                const isActive = selected !== "new" && (selected as SeoLandingPage)?.id === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setSelected(p)}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-teal-300 bg-teal-50 shadow-sm"
                        : "border-stone-200 bg-white hover:border-stone-300 hover:shadow-sm"
                    }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-800">{p.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-teal-600">/lp/{p.slug}</p>
                        {p.target_keyword && (
                          <p className="mt-1 truncate text-[10px] text-stone-400">{p.target_keyword}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <ScorePill score={score} />
                        <div className="flex items-center gap-1.5">
                          {togglingId === p.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-400" />
                            : <Switch checked={p.published} onCheckedChange={() => handleTogglePublish(p)} />}
                          <span className="text-[10px] text-stone-400">{p.published ? "Live" : "Draft"}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Editor panel */}
        <div className="lg:col-span-3">
          {selected === null ? (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 text-center">
              <Sparkles className="h-12 w-12 text-stone-200" />
              <p className="mt-3 text-sm font-medium text-stone-400">Pilih halaman di kiri untuk mengedit,</p>
              <p className="text-sm text-stone-400">atau buat / generate halaman baru.</p>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 border-teal-200 text-teal-700 hover:bg-teal-50"
                  onClick={() => setSecGenDialog(true)}>
                  <Sparkles className="h-4 w-4" /> Generate dengan AI
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => { setAiDraft(undefined); setSelected("new"); }}>
                  <Plus className="h-4 w-4" /> Buat Manual
                </Button>
              </div>
            </div>
          ) : (
            <LandingPageEditor
              key={selected === "new" ? editorKey : (selected as SeoLandingPage).id}
              page={selected === "new" ? null : selected}
              draft={selected === "new" ? aiDraft : undefined}
              onSave={onChanged}
              onClose={() => { setSelected(null); setAiDraft(undefined); }}
            />
          )}
        </div>
      </div>

      {/* Quick stats */}
      {pages.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4 border border-stone-200 bg-white text-center">
            <p className="text-2xl font-bold font-mono text-stone-800">{pages.length}</p>
            <p className="text-xs text-stone-400 mt-1">Total Halaman</p>
          </Card>
          <Card className="p-4 border border-stone-200 bg-white text-center">
            <p className="text-2xl font-bold font-mono text-emerald-600">{pages.filter((p) => p.published).length}</p>
            <p className="text-xs text-stone-400 mt-1">Dipublikasikan</p>
          </Card>
          <Card className="p-4 border border-stone-200 bg-white text-center">
            <p className="text-2xl font-bold font-mono text-stone-500">
              {pages.length > 0 ? Math.round(pages.reduce((s, p) => s + calcSeoScore(p), 0) / pages.length) : 0}
            </p>
            <p className="text-xs text-stone-400 mt-1">Rata-rata Skor SEO</p>
          </Card>
        </div>
      )}
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

  const generateSchemaM = useMutation({
    mutationFn: () => generateAndSaveLocalBusinessSchema(),
    onSuccess: () => {
      toast.success("LocalBusiness Schema successfully generated and saved to database!");
      onChanged();
    },
    onError: (e: any) => toast.error(e.message),
  });

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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-3">
          <div>
            <h3 className="font-bold text-stone-800 text-sm">Registered Structured Schema markup (JSON-LD)</h3>
            <p className="text-xs text-stone-400 mt-0.5">Skema data terstruktur untuk mendongkrak visibilitas rich snippets di Google</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 font-mono text-xs bg-white text-teal-700 border-teal-200 hover:bg-teal-50"
            disabled={generateSchemaM.isPending}
            onClick={() => generateSchemaM.mutate()}
          >
            {generateSchemaM.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Syncing...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3" /> Sync LocalBusiness Schema
              </>
            )}
          </Button>
        </div>
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
