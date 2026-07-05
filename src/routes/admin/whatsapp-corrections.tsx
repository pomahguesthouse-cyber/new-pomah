import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";
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
    <div className="flex h-screen flex-col bg-stone-100">
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/admin/ai-lab" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"><ArrowLeft className="h-4 w-4" /> AI LAB</Link>
          <div><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">WhatsApp Training</p><h1 className="text-lg font-semibold">Koreksi WA Asli</h1></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { qc.invalidateQueries({ queryKey: ["wa-correction-candidates"] }); qc.invalidateQueries({ queryKey: ["wa-corrections"] }); }}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
          <Button size="sm" disabled={backfillMut.isPending} onClick={() => backfillMut.mutate()}>{backfillMut.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Backfill Embedding</Button>
        </div>
      </header>

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
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <label className="block space-y-1"><span className="text-[11px] font-medium">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-xs">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
