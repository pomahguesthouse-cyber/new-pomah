import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Edit3, Loader2, Save, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatRelativeDateID, formatTimeID } from "@/lib/utils";
import {
  createWhatsappCorrectionFromMessages,
  createWhatsappCorrectionSession,
  listWhatsappCorrectionSessions,
  listWhatsappCorrectionThreadMessages,
  listWhatsappCorrectionThreads,
} from "@/admin/modules/training/wa-correction.functions";

export const Route = createFileRoute("/admin/whatsapp-corrections")({
  component: WhatsappCorrectionsPage,
});

type ThreadRow = {
  id: string;
  phone: string;
  display_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  status: string | null;
  ai_auto: boolean | null;
  chat_summary: string | null;
  chat_summary_json?: Record<string, unknown> | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  direction: "in" | "out" | string;
  body: string;
  sent_at: string;
  metadata: Record<string, unknown> | null;
};

type SessionRow = {
  id: string;
  title: string | null;
  conversation_summary: string | null;
  status: string;
  embedding_updated_at: string | null;
  created_at: string;
};

const INTENTS = ["general", "availability_check", "pricing_inquiry", "booking_start", "booking_inquiry", "payment", "complaint", "room_detail_question"];
const AGENTS = ["front-office", "pricing", "customer-care", "finance", "manager"];
const ERRORS = ["wrong_intent", "wrong_agent", "wrong_date", "wrong_room_context", "availability_wrong", "price_wrong", "incomplete_answer", "too_short", "ignored_context", "tool_not_used"];
const HIDDEN_ATTACHMENT_RE = /^\[Lampiran\s+(e2e_notification|notification_template|ciphertext)\]$/i;

function isHiddenAttachmentPlaceholder(body: string | null | undefined) {
  return HIDDEN_ATTACHMENT_RE.test((body ?? "").trim());
}

function formatTrainingContext(thread: ThreadRow | null, messages: MessageRow[]) {
  const json = thread?.chat_summary_json ?? null;
  const jsonSummary = typeof json?.summary === "string" ? json.summary.trim() : "";
  const jsonTopic = typeof json?.last_topic === "string" ? json.last_topic.trim() : "";
  const jsonRoom = typeof json?.room_type === "string" ? json.room_type.trim() : "";
  const jsonCheckIn = typeof json?.check_in === "string" ? json.check_in.trim() : "";
  const jsonCheckOut = typeof json?.check_out === "string" ? json.check_out.trim() : "";
  const jsonQuestion = typeof json?.unresolved_question === "string" ? json.unresolved_question.trim() : "";
  const lines: string[] = [];

  if (thread?.display_name || thread?.phone) lines.push(`Tamu: ${thread?.display_name || "—"} (${thread?.phone || "—"})`);
  if (jsonSummary) lines.push(`Ringkasan: ${jsonSummary}`);
  else if (thread?.chat_summary?.trim()) lines.push(`Ringkasan: ${thread.chat_summary.trim()}`);
  if (jsonTopic) lines.push(`Topik terakhir: ${jsonTopic}`);
  if (jsonRoom) lines.push(`Tipe kamar: ${jsonRoom}`);
  if (jsonCheckIn || jsonCheckOut) lines.push(`Tanggal: ${jsonCheckIn || "—"} s/d ${jsonCheckOut || "—"}`);
  if (jsonQuestion) lines.push(`Pertanyaan belum terjawab: ${jsonQuestion}`);

  const recent = messages.slice(-8).map((m) => {
    const who = m.direction === "in" ? "Tamu" : "Bot/Admin";
    return `${who}: ${m.body}`;
  });
  if (recent.length) lines.push(`\nKonteks pesan terakhir:\n${recent.join("\n")}`);

  if (!lines.length) return "Belum ada ringkasan. Koreksi bubble atau simpan percakapan utuh untuk membuat training context.";
  return lines.join("\n");
}

function WhatsappCorrectionsPage() {
  const qc = useQueryClient();
  const latestMessageRef = useRef<HTMLDivElement | null>(null);
  const threadsFn = useServerFn(listWhatsappCorrectionThreads);
  const messagesFn = useServerFn(listWhatsappCorrectionThreadMessages);
  const createCorrectionFn = useServerFn(createWhatsappCorrectionFromMessages);
  const createSessionFn = useServerFn(createWhatsappCorrectionSession);
  const sessionsFn = useServerFn(listWhatsappCorrectionSessions);

  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});
  const [correctIntent, setCorrectIntent] = useState("general");
  const [correctAgent, setCorrectAgent] = useState("front-office");
  const [errorType, setErrorType] = useState("incomplete_answer");
  const [summary, setSummary] = useState("");

  const { data: threadsData, isFetching: loadingThreads } = useQuery({
    queryKey: ["wa-correction-threads"],
    queryFn: () => threadsFn({ data: { limit: 100 } }),
  });
  const threads = (threadsData?.rows ?? []) as ThreadRow[];
  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => [t.display_name, t.phone, t.last_message_preview].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [threads, search]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? filteredThreads[0] ?? null;

  useEffect(() => {
    if (!selectedThreadId && filteredThreads[0]) setSelectedThreadId(filteredThreads[0].id);
  }, [filteredThreads, selectedThreadId]);

  const { data: messagesData, isFetching: loadingMessages } = useQuery({
    queryKey: ["wa-correction-messages", selectedThread?.id],
    enabled: !!selectedThread?.id,
    queryFn: () => messagesFn({ data: { threadId: selectedThread!.id } }),
  });
  const messages = (messagesData?.rows ?? []) as MessageRow[];
  const trainingMessages = useMemo(
    () => messages.filter((m) => !isHiddenAttachmentPlaceholder(m.body)),
    [messages],
  );

  const { data: sessionsData } = useQuery({
    queryKey: ["wa-correction-sessions"],
    queryFn: () => sessionsFn({ data: { limit: 20 } }),
  });
  const sessions = (sessionsData?.rows ?? []) as SessionRow[];

  useEffect(() => {
    setEditedBodies({});
    setEditingMessageId(null);
    setDraftBody("");
  }, [selectedThread?.id]);

  useEffect(() => {
    setSummary(formatTrainingContext(selectedThread, trainingMessages));
  }, [selectedThread?.id, trainingMessages.length]);

  useEffect(() => {
    if (!loadingMessages && trainingMessages.length > 0) {
      window.setTimeout(() => latestMessageRef.current?.scrollIntoView({ block: "start" }), 80);
    }
  }, [loadingMessages, selectedThread?.id, trainingMessages.length]);

  function previousInboundId(outMessageId: string) {
    const idx = trainingMessages.findIndex((m) => m.id === outMessageId);
    for (let i = idx - 1; i >= 0; i--) {
      if (trainingMessages[i].direction === "in") return trainingMessages[i].id;
    }
    return null;
  }

  const saveTurnMut = useMutation({
    mutationFn: async (message: MessageRow) => {
      const inboundId = previousInboundId(message.id);
      if (!inboundId) throw new Error("Tidak menemukan pesan tamu sebelum bubble bot ini.");
      const ideal = (editedBodies[message.id] ?? draftBody).trim();
      if (!ideal) throw new Error("Jawaban ideal belum diisi.");
      return createCorrectionFn({ data: {
        userMessageId: inboundId,
        wrongReplyMessageId: message.id,
        idealReply: ideal,
        correctIntent,
        correctAgent,
        errorType,
        severity: "medium",
        notes: "Dikoreksi dari WhatsApp Corrections Mode.",
        status: "approved",
      }});
    },
    onSuccess: () => {
      toast.success("Bubble disimpan sebagai koreksi training.");
      setEditingMessageId(null);
      setDraftBody("");
      qc.invalidateQueries({ queryKey: ["wa-corrections"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveSessionMut = useMutation({
    mutationFn: async () => {
      if (!selectedThread) throw new Error("Pilih percakapan dulu.");
      const correctedTranscript = trainingMessages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: editedBodies[m.id] ?? m.body,
        originalBody: m.body,
        edited: !!editedBodies[m.id] && editedBodies[m.id] !== m.body,
        sent_at: m.sent_at,
        metadata: m.metadata ?? {},
      }));
      return createSessionFn({ data: {
        threadId: selectedThread.id,
        title: selectedThread.display_name || selectedThread.phone,
        summary: summary || selectedThread.last_message_preview || "Percakapan WhatsApp terkoreksi.",
        correctedTranscript,
        status: "approved",
      }});
    },
    onSuccess: () => {
      toast.success("Percakapan utuh disimpan sebagai training context.");
      qc.invalidateQueries({ queryKey: ["wa-correction-sessions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex h-screen min-h-0 flex-col bg-stone-100">
      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_360px] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r bg-card">
          <div className="border-b p-3"><div className="relative"><Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" placeholder="Search name, phone, message" /></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingThreads && filteredThreads.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Memuat...</p> : filteredThreads.map((t) => (
              <button key={t.id} onClick={() => setSelectedThreadId(t.id)} className={cn("block w-full border-b p-3 text-left hover:bg-muted/60", selectedThread?.id === t.id && "bg-teal-50")}>
                <div className="flex items-center justify-between gap-2"><p className="truncate font-semibold">{t.display_name || t.phone}</p>{t.ai_auto && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">AI Auto</Badge>}</div>
                <p className="font-mono text-[10px] text-muted-foreground">{t.phone}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.last_message_preview || "—"}</p>
                {t.last_message_at && <p className="mt-1 text-[10px] text-muted-foreground">{formatRelativeDateID(t.last_message_at)}</p>}
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-[#eee8df]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-4 py-3">
            <div className="min-w-0 pr-3"><p className="truncate font-semibold">{selectedThread?.display_name || selectedThread?.phone || "Pilih percakapan"}</p><p className="truncate font-mono text-xs text-muted-foreground">{selectedThread?.phone}</p></div>
            <Button className="shrink-0 whitespace-nowrap" disabled={!trainingMessages.length || saveSessionMut.isPending} onClick={() => saveSessionMut.mutate()}>{saveSessionMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Simpan Percakapan Utuh</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loadingMessages ? <p className="text-sm text-muted-foreground">Memuat pesan...</p> : trainingMessages.map((m, idx) => {
              const outbound = m.direction === "out";
              const isEditing = editingMessageId === m.id;
              const shown = editedBodies[m.id] ?? m.body;
              const isLatest = idx === trainingMessages.length - 1;
              return (
                <div key={m.id} ref={isLatest ? latestMessageRef : undefined} className={cn("mb-3 flex scroll-mt-4", outbound ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[76%] rounded-xl px-3 py-2 shadow-sm", outbound ? "bg-green-100" : "bg-white")}>
                    {isEditing ? <Textarea rows={5} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} className="min-w-[420px] bg-white text-sm" /> : <p className="whitespace-pre-wrap text-sm leading-relaxed">{shown}</p>}
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-1 text-[10px] text-muted-foreground">
                      {editedBodies[m.id] && <Badge className="bg-teal-100 text-teal-700 hover:bg-teal-100">edited</Badge>}
                      {outbound && m.metadata?.agent_key && <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">{String(m.metadata.agent_key)}</Badge>}
                      <span>{formatTimeID(m.sent_at)}</span>
                    </div>
                    {outbound && (
                      <div className="mt-2 flex justify-end gap-1">
                        {isEditing ? <><Button size="sm" variant="outline" onClick={() => { setEditedBodies((p) => ({ ...p, [m.id]: draftBody })); setEditingMessageId(null); }}><CheckCircle2 className="mr-1 h-3 w-3" /> Terapkan</Button><Button size="sm" onClick={() => saveTurnMut.mutate(m)} disabled={saveTurnMut.isPending}><Save className="mr-1 h-3 w-3" /> Simpan Koreksi</Button><Button size="sm" variant="ghost" onClick={() => setEditingMessageId(null)}><X className="h-3 w-3" /></Button></> : <Button size="sm" variant="ghost" onClick={() => { setEditingMessageId(m.id); setDraftBody(shown); }}><Edit3 className="mr-1 h-3 w-3" /> Edit Koreksi</Button>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="h-[70vh]" />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l bg-card p-4">
          <section className="rounded-xl border p-3"><h2 className="text-sm font-semibold">Training Context</h2><p className="mt-1 text-xs text-muted-foreground">Ringkasan ini ikut di-embed bersama transcript terkoreksi.</p><Textarea rows={9} className="mt-3 text-xs" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Ringkasan, status, dan konteks pesan terakhir akan tampil di sini..." /></section>
          <section className="rounded-xl border p-3"><h2 className="text-sm font-semibold">Default koreksi bubble</h2><div className="mt-3 grid grid-cols-1 gap-2"><SelectField label="Intent" value={correctIntent} onChange={setCorrectIntent} options={INTENTS} /><SelectField label="Agent" value={correctAgent} onChange={setCorrectAgent} options={AGENTS} /><SelectField label="Error" value={errorType} onChange={setErrorType} options={ERRORS} /></div></section>
          <section className="rounded-xl border p-3"><h2 className="text-sm font-semibold">Percakapan tersimpan</h2><div className="mt-2 space-y-2">{sessions.map((s) => <div key={s.id} className="rounded-lg border p-2 text-xs"><div className="flex justify-between"><Badge variant="outline" className="text-[9px]">{s.status}</Badge>{s.embedding_updated_at ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[9px]">embedded</Badge> : <Badge variant="outline" className="text-[9px]">no embedding</Badge>}</div><p className="mt-2 line-clamp-1 font-medium">{s.title || "Percakapan"}</p><p className="mt-1 line-clamp-2 text-muted-foreground">{s.conversation_summary || "—"}</p></div>)}</div></section>
        </aside>
      </main>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return <label className="block space-y-1"><span className="text-[11px] font-medium">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-xs">{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}
