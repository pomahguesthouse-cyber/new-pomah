import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  Network,
  RefreshCw,
  Search,
  Sparkles,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeDateID, formatTimeID } from "@/lib/utils";
import {
  backfillWhatsappCorrectionEmbeddings,
  createWhatsappCorrectionFromMessages,
  listWhatsappCorrectionCandidates,
  listWhatsappCorrections,
} from "@/admin/modules/training/wa-correction.functions";

export const Route = createFileRoute("/admin/whatsapp-corrections")({
  component: WhatsappCorrectionsPage,
});

type Candidate = {
  phone: string;
  display_name: string | null;
  user_message_id: string;
  user_message: string;
  user_sent_at: string;
  wrong_reply_message_id: string;
  bot_wrong_reply: string;
  bot_sent_at: string;
  agent_key: string | null;
  intent: string | null;
};

type Correction = {
  id: string;
  user_message: string;
  ideal_reply: string;
  correct_intent: string | null;
  correct_agent: string | null;
  status: string;
  embedding_updated_at: string | null;
  created_at: string;
};

const INTENTS = ["general", "availability_check", "pricing_inquiry", "booking_start", "booking_inquiry", "payment", "complaint", "room_detail_question"];
const AGENTS = ["front-office", "pricing", "customer-care", "finance", "manager"];
const ERRORS = ["wrong_intent", "wrong_agent", "wrong_date", "wrong_room_context", "availability_wrong", "price_wrong", "incomplete_answer", "too_short", "ignored_context", "tool_not_used"];

const AI_LAB_MENU = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/admin/ai-lab" },
  { label: "WhatsApp", icon: MessageCircle, to: "/admin/ai-lab" },
  { label: "WhatsApp Corrections", icon: BrainCircuit, to: "/admin/whatsapp-corrections", active: true },
  { label: "Simulator Bot", icon: Bot, to: "/admin/ai-lab" },
  { label: "Knowledge & SOP", icon: BookOpen, to: "/admin/ai-lab" },
  { label: "RAG Settings", icon: Sparkles, to: "/admin/ai-lab" },
  { label: "Response Timing", icon: Timer, to: "/admin/ai-lab" },
  { label: "Aturan Intent", icon: Network, to: "/admin/ai-lab" },
  { label: "Queue Latency", icon: Clock, to: "/admin/ai-lab" },
];

function WhatsappCorrectionsPage() {
  const qc = useQueryClient();
  const candidatesFn = useServerFn(listWhatsappCorrectionCandidates);
  const correctionsFn = useServerFn(listWhatsappCorrections);
  const createFn = useServerFn(createWhatsappCorrectionFromMessages);
  const backfillFn = useServerFn(backfillWhatsappCorrectionEmbeddings);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [idealReply, setIdealReply] = useState("");
  const [correctIntent, setCorrectIntent] = useState("general");
  const [correctAgent, setCorrectAgent] = useState("front-office");
  const [errorType, setErrorType] = useState("incomplete_answer");
  const [notes, setNotes] = useState("");

  const { data: candidateData, isFetching } = useQuery({
    queryKey: ["wa-correction-candidates"],
    queryFn: () => candidatesFn({ data: { limit: 80 } }),
  });
  const { data: correctionData } = useQuery({
    queryKey: ["wa-corrections"],
    queryFn: () => correctionsFn({ data: { status: "all", limit: 50 } }),
  });

  const candidates = (candidateData?.rows ?? []) as Candidate[];
  const corrections = (correctionData?.rows ?? []) as Correction[];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => [c.phone, c.display_name, c.user_message, c.bot_wrong_reply, c.intent, c.agent_key].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [candidates, search]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Pilih kandidat dulu.");
      return createFn({ data: {
        userMessageId: selected.user_message_id,
        wrongReplyMessageId: selected.wrong_reply_message_id,
        idealReply,
        correctIntent,
        correctAgent,
        errorType,
        severity: "medium",
        notes: notes.trim() || null,
        status: "approved",
      }});
    },
    onSuccess: () => {
      toast.success("Koreksi tersimpan dan siap menjadi data training.");
      setSelected(null); setIdealReply(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["wa-correction-candidates"] });
      qc.invalidateQueries({ queryKey: ["wa-corrections"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const backfillMut = useMutation({
    mutationFn: () => backfillFn({ data: { maxRows: 50 } }),
    onSuccess: (res) => {
      toast.success(`Embedding diproses: ${res.ok}/${res.processed}`);
      qc.invalidateQueries({ queryKey: ["wa-corrections"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const open = (c: Candidate) => {
    setSelected(c);
    setIdealReply("");
    setCorrectIntent(c.intent || "general");
    setCorrectAgent(c.agent_key || "front-office");
    setErrorType("incomplete_answer");
    setNotes("");
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-stone-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:gap-4 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link to="/admin" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted sm:px-3 sm:text-sm">
            <ArrowLeft className="h-4 w-4" /> Keluar
          </Link>
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground sm:text-[10px]">Pomah Guesthouse</p>
            <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">AI LAB</h1>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700 sm:px-3 sm:text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> AI Aktif
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-card p-2 md:w-48 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:p-3">
          {AI_LAB_MENU.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition md:w-full",
                item.active ? "bg-teal-50 font-medium text-teal-900" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
        </nav>

        <main className="grid min-h-0 flex-1 grid-cols-[1fr_380px] gap-4 overflow-hidden p-4">
          <section className="flex min-h-0 flex-col rounded-xl border bg-card shadow-sm">
            <div className="border-b p-3">
              <div className="flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold">Kandidat balasan bot</h2><p className="text-xs text-muted-foreground">Pilih balasan yang salah lalu tulis jawaban ideal.</p></div>
                <div className="relative w-80"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari pesan, nomor, nama..." /></div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {isFetching && filtered.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Memuat...</div> : filtered.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Belum ada kandidat.</div> : (
                <div className="space-y-3">
                  {filtered.map((c) => (
                    <button key={c.wrong_reply_message_id} onClick={() => open(c)} className={cn("block w-full rounded-lg border bg-background p-3 text-left hover:border-teal-400", selected?.wrong_reply_message_id === c.wrong_reply_message_id && "border-teal-500 bg-teal-50")}>
                      <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{c.display_name || c.phone}</p><p className="font-mono text-[10px] text-muted-foreground">{c.phone}</p></div><div className="flex gap-1">{c.intent && <Badge variant="outline" className="text-[10px]">{c.intent}</Badge>}{c.agent_key && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">{c.agent_key}</Badge>}</div></div>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2"><div className="rounded-md border bg-white p-2"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Tamu</p><p className="mt-1 line-clamp-4 text-xs">{c.user_message}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatTimeID(c.user_sent_at)}</p></div><div className="rounded-md border border-rose-200 bg-rose-50 p-2"><p className="text-[10px] font-semibold uppercase text-rose-700">Balasan bot</p><p className="mt-1 line-clamp-4 text-xs">{c.bot_wrong_reply}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatTimeID(c.bot_sent_at)}</p></div></div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <section className="rounded-xl border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold">Form koreksi</h2>
              {!selected ? <p className="mt-3 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Pilih kandidat di kiri.</p> : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-md bg-muted/40 p-2 text-xs"><p className="font-semibold">{selected.display_name || selected.phone}</p><p className="mt-1 line-clamp-2 text-muted-foreground">{selected.user_message}</p></div>
                  <label className="block space-y-1"><span className="text-xs font-medium">Jawaban ideal</span><Textarea rows={7} value={idealReply} onChange={(e) => setIdealReply(e.target.value)} placeholder="Tulis jawaban yang seharusnya dikirim bot..." className="text-xs" /></label>
                  <div className="grid grid-cols-2 gap-2"><SelectField label="Intent" value={correctIntent} onChange={setCorrectIntent} options={INTENTS} /><SelectField label="Agent" value={correctAgent} onChange={setCorrectAgent} options={AGENTS} /><SelectField label="Error" value={errorType} onChange={setErrorType} options={ERRORS} /></div>
                  <label className="block space-y-1"><span className="text-xs font-medium">Catatan</span><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs" /></label>
                  <Button className="w-full" disabled={!idealReply.trim() || saveMut.isPending} onClick={() => saveMut.mutate()}>{saveMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Simpan & Training</Button>
                </div>
              )}
            </section>
            <section className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-card p-3 shadow-sm"><h2 className="text-sm font-semibold">Koreksi tersimpan</h2><div className="mt-3 space-y-2">{corrections.map((c) => <div key={c.id} className="rounded-lg border p-2 text-xs"><div className="flex justify-between gap-2"><Badge variant="outline" className="text-[9px]">{c.status}</Badge><span className="text-[10px] text-muted-foreground">{formatRelativeDateID(c.created_at)}</span></div><p className="mt-2 line-clamp-2 font-medium">{c.user_message}</p><p className="mt-1 line-clamp-2 text-muted-foreground">Ideal: {c.ideal_reply}</p><div className="mt-2 flex gap-1">{c.correct_intent && <Badge variant="secondary" className="text-[9px]">{c.correct_intent}</Badge>}{c.correct_agent && <Badge variant="secondary" className="text-[9px]">{c.correct_agent}</Badge>}{c.embedding_updated_at ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[9px]">embedded</Badge> : <Badge variant="outline" className="text-[9px] text-amber-700">no embedding</Badge>}</div></div>)}</div></section>
          </aside>
        </main>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <label className="block space-y-1"><span className="text-[11px] font-medium">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-xs">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
