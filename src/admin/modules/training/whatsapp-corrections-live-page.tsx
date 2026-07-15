import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Info,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDateID, formatRelativeDateID, formatTimeID } from "@/lib/utils";
import { listWhatsappCorrectionSessions } from "@/admin/modules/training/wa-correction.functions";
import { createWhatsappCorrectionLiveSession } from "@/admin/modules/training/wa-correction-live-session.functions";
import { deleteWhatsappCorrectionSession } from "@/admin/modules/training/wa-correction-session.functions";
import { listWppLiveChats, listWppLiveMessages } from "@/admin/modules/training/wpp-live.functions";
import { mapWhatsappLidToPhone } from "@/admin/modules/training/wa-identity-map.functions";

type ThreadRow = {
  id: string;
  phone: string;
  display_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  ai_auto: boolean | null;
  chat_summary: string | null;
  chat_summary_json?: Record<string, unknown> | null;
  canonical_phone?: string | null;
  external_chat_id?: string | null;
  identity_type?: string | null;
  sync_error?: string | null;
  source?: string | null;
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

type SimpleMutation = { isPending: boolean; mutate: (...args: any[]) => void };
type MobilePanel = "threads" | "chat" | "details";

const HIDDEN_ATTACHMENT_RE = /^\[Lampiran\s+(e2e_notification|notification_template|ciphertext)\]$/i;
const SELF_BUSINESS_PHONES = new Set(["6280883579129903"]);
const BUSINESS_SELF_RE = /pomah\s*guesthouse|pomah\s*guest\s*house|pomah\s*guesthouse\s*dewi/i;

function digits(v: string | null | undefined) { return String(v ?? "").replace(/\D/g, ""); }
function isPublicPhone(value: string | null | undefined) { return /^62\d{8,14}$/.test(digits(value)); }
function primaryPhone(t: ThreadRow | null | undefined) { if (!t) return null; return isPublicPhone(t.canonical_phone) ? t.canonical_phone : isPublicPhone(t.phone) ? t.phone : t.phone; }
function lidDigits(t: ThreadRow | null | undefined) { const raw = String(t?.external_chat_id || t?.phone || ""); const d = digits(raw); return d && !/^62\d{8,14}$/.test(d) ? d : ""; }
function formatWaPhone(phone: string | null | undefined) { const p = digits(phone); if (!p.startsWith("62") || p.length < 10) return phone || "-"; return `+${p.slice(0, 2)} ${p.slice(2, 5)}-${p.slice(5, 9)}-${p.slice(9)}`.replace(/-$/g, ""); }
function displayName(t: ThreadRow | null | undefined) { const name = String(t?.display_name ?? "").trim(); if (!name || name === t?.phone || digits(name) === digits(t?.phone)) return "No Name"; return name; }
function isBusinessSelfThread(t: ThreadRow) { return SELF_BUSINESS_PHONES.has(digits(t.phone)) || BUSINESS_SELF_RE.test(t.display_name ?? ""); }
function isTrainingMessage(m: MessageRow) { return !HIDDEN_ATTACHMENT_RE.test((m.body ?? "").trim()); }
function messageKey(m: MessageRow) { const external = String(m.metadata?.external_message_id ?? m.id ?? "").trim(); if (external) return `external:${external}`; const minute = Math.floor(new Date(m.sent_at).getTime() / 60000); return `${m.direction}|${minute}|${String(m.body ?? "").trim().toLowerCase()}`; }
function dedupeMessages(rows: MessageRow[]) { const map = new Map<string, MessageRow>(); for (const row of rows) map.set(messageKey(row), row); return [...map.values()].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()); }
function avatarText(t: ThreadRow | null | undefined) { const source = displayName(t) !== "No Name" ? displayName(t) : formatWaPhone(primaryPhone(t)); return source.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?"; }
function messageDay(iso: string) { return new Date(iso).toDateString(); }
function buildContext(thread: ThreadRow | null, messages: MessageRow[]) {
  const lines: string[] = [];
  if (thread) lines.push(`Tamu: ${displayName(thread)} (${formatWaPhone(primaryPhone(thread))})`);
  if (thread?.external_chat_id) lines.push(`WPP chatId: ${thread.external_chat_id}`);
  if (thread?.sync_error) lines.push(`Catatan: ${thread.sync_error}`);
  const recent = messages.slice(-10).map((m) => `${m.direction === "in" ? "Tamu" : "Bot/Admin"}: ${m.body}`);
  if (recent.length) lines.push(`\nKonteks pesan terakhir:\n${recent.join("\n")}`);
  return lines.join("\n") || "Belum ada ringkasan.";
}

export function WhatsappCorrectionsPage() {
  const qc = useQueryClient();
  const latestRef = useRef<HTMLDivElement | null>(null);
  const listChatsFn = useServerFn(listWppLiveChats);
  const listMessagesFn = useServerFn(listWppLiveMessages);
  const createLiveSessionFn = useServerFn(createWhatsappCorrectionLiveSession);
  const sessionsFn = useServerFn(listWhatsappCorrectionSessions);
  const deleteSessionFn = useServerFn(deleteWhatsappCorrectionSession);
  const mapIdentityFn = useServerFn(mapWhatsappLidToPhone);

  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [rightTab, setRightTab] = useState<"context" | "saved">("context");
  const [mapPhone, setMapPhone] = useState("");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("threads");

  const { data: chatsData, isFetching: loadingThreads, refetch: refetchChats, error: chatsError } = useQuery({
    queryKey: ["wa-correction-live-chats"],
    queryFn: () => listChatsFn({ data: { limit: 250 } }),
    refetchInterval: 30_000,
  });
  const threads = useMemo(() => ((chatsData?.rows ?? []) as ThreadRow[]).filter((t) => !isBusinessSelfThread(t)).sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime()), [chatsData]);
  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => [displayName(t), t.phone, t.external_chat_id, t.last_message_preview].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [threads, search]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? filteredThreads[0] ?? null;
  const selectedChatId = selectedThread?.external_chat_id ?? (selectedThread?.id ? decodeURIComponent(selectedThread.id.replace(/^live:/, "")) : null);

  useEffect(() => { if (!selectedThreadId && filteredThreads[0]) setSelectedThreadId(filteredThreads[0].id); }, [filteredThreads, selectedThreadId]);
  useEffect(() => { if (selectedThreadId && !threads.some((t) => t.id === selectedThreadId)) setSelectedThreadId(filteredThreads[0]?.id ?? null); }, [selectedThreadId, threads, filteredThreads]);

  const { data: messagesData, isFetching: loadingMessages, refetch: refetchMessages } = useQuery({
    queryKey: ["wa-correction-live-messages", selectedChatId],
    enabled: !!selectedChatId,
    queryFn: () => listMessagesFn({ data: { chatId: selectedChatId!, limit: 160 } }),
  });
  const trainingMessages = useMemo(() => dedupeMessages(((messagesData?.rows ?? []) as MessageRow[]).filter(isTrainingMessage)), [messagesData]);
  const { data: sessionsData } = useQuery({ queryKey: ["wa-correction-sessions"], queryFn: () => sessionsFn({ data: { limit: 80 } }) });
  const sessions = (sessionsData?.rows ?? []) as SessionRow[];

  useEffect(() => { setEditedBodies({}); setEditingMessageId(null); setDraftBody(""); setMapPhone(""); }, [selectedThread?.id]);
  useEffect(() => setSummary(buildContext(selectedThread, trainingMessages)), [selectedThread?.id, trainingMessages.length]);
  useEffect(() => { if (!loadingMessages && trainingMessages.length) window.setTimeout(() => latestRef.current?.scrollIntoView({ block: "start" }), 80); }, [loadingMessages, selectedThread?.id, trainingMessages.length]);

  const saveSessionMut = useMutation({
    mutationFn: async () => {
      if (!selectedThread) throw new Error("Pilih percakapan dulu.");
      if (!trainingMessages.length) throw new Error("Belum ada pesan untuk disimpan.");
      const correctedTranscript = trainingMessages.map((m) => ({ id: m.id, direction: m.direction, body: editedBodies[m.id] ?? m.body, originalBody: m.body, edited: !!editedBodies[m.id] && editedBodies[m.id] !== m.body, sent_at: m.sent_at, metadata: m.metadata ?? {} }));
      return createLiveSessionFn({ data: { canonicalPhone: primaryPhone(selectedThread), externalChatId: selectedThread.external_chat_id ?? selectedChatId, title: displayName(selectedThread) !== "No Name" ? displayName(selectedThread) : formatWaPhone(primaryPhone(selectedThread)), summary: summary || selectedThread.last_message_preview || "Percakapan WhatsApp live terkoreksi.", correctedTranscript, status: "approved" } });
    },
    onSuccess: () => { toast.success("Percakapan live disimpan sebagai training context."); setRightTab("saved"); setMobilePanel("details"); qc.invalidateQueries({ queryKey: ["wa-correction-sessions"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const mapIdentityMut = useMutation({
    mutationFn: async () => {
      if (!selectedThread) throw new Error("Pilih percakapan LID dulu.");
      const lid = lidDigits(selectedThread);
      if (!lid) throw new Error("Percakapan ini bukan LID atau LID tidak terbaca.");
      return mapIdentityFn({ data: { lid, phone: mapPhone, displayName: displayName(selectedThread) } });
    },
    onSuccess: (res) => {
      toast.success(`LID dipetakan ke ${formatWaPhone(res.canonicalPhone)}.`);
      qc.invalidateQueries({ queryKey: ["wa-correction-live-chats"] });
      qc.invalidateQueries({ queryKey: ["wa-correction-live-messages"] });
      refetchChats();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteSessionMut = useMutation({ mutationFn: (id: string) => deleteSessionFn({ data: { id } }), onSuccess: () => { toast.success("Percakapan tersimpan dihapus dari training."); qc.invalidateQueries({ queryKey: ["wa-correction-sessions"] }); }, onError: (e) => toast.error((e as Error).message) });

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-[#f0f2f5] text-[#111b21]">
      <aside className={cn("min-h-0 w-full flex-col border-r bg-white md:flex md:w-[360px] md:min-w-[300px] lg:w-[380px] lg:max-w-[420px]", mobilePanel === "threads" ? "flex" : "hidden")}>
        <div className="flex h-[58px] shrink-0 items-center justify-between bg-[#008069] px-3 text-white sm:px-4">
          <div><div className="font-semibold">WA Correction</div><div className="text-[10px] text-white/80">Supabase conversation DB</div></div>
          <Button size="sm" variant="outline" className="h-8 rounded-full border-white/45 bg-white/10 px-3 text-xs text-white hover:bg-white/20 hover:text-white" disabled={loadingThreads} onClick={() => refetchChats()}>{loadingThreads ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}Refresh</Button>
        </div>
        <div className="shrink-0 border-b px-3 py-2"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667781]" /><Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 rounded-full border-0 bg-[#f0f2f5] pl-9 text-sm shadow-none focus-visible:ring-0" placeholder="Cari live chat..." /></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {chatsError ? <div className="p-4 text-sm text-red-600">{(chatsError as Error).message}</div> : loadingThreads && filteredThreads.length === 0 ? <p className="p-4 text-sm text-[#667781]">Memuat percakapan...</p> : filteredThreads.length === 0 ? <div className="p-8 text-center text-sm text-[#667781]">Belum ada percakapan di Supabase.</div> : filteredThreads.map((t) => <ThreadListItem key={t.id} thread={t} active={selectedThread?.id === t.id} onClick={() => { setSelectedThreadId(t.id); setMobilePanel("chat"); }} />)}
        </div>
      </aside>

      <section className={cn("min-w-0 flex-1 flex-col", mobilePanel === "chat" ? "flex" : "hidden md:flex")}>
        {selectedThread ? <><ThreadHeader thread={selectedThread} loading={loadingMessages} onRefresh={() => refetchMessages()} onBack={() => setMobilePanel("threads")} onDetails={() => setMobilePanel("details")} /><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#efeae2] px-3 py-3 sm:px-5 md:px-[clamp(1.25rem,4vw,5rem)] md:py-5">{loadingMessages ? <p className="rounded-lg bg-white/80 px-3 py-2 text-sm text-[#667781] shadow-sm">Mengambil pesan dari Supabase...</p> : <MessageTimeline messages={trainingMessages} latestRef={latestRef} editingMessageId={editingMessageId} setEditingMessageId={setEditingMessageId} draftBody={draftBody} setDraftBody={setDraftBody} editedBodies={editedBodies} setEditedBodies={setEditedBodies} />}</div></> : <div className="flex flex-1 items-center justify-center bg-[#f0f2f5] p-8 text-center text-sm text-[#667781]">Pilih percakapan.</div>}
      </section>

      <aside className={cn("min-h-0 w-full flex-col border-l bg-white md:flex md:w-[340px] lg:w-[380px]", mobilePanel === "details" ? "flex" : "hidden md:flex")}>
        <div className="flex h-[58px] shrink-0 items-center gap-2 border-b bg-white px-3 md:hidden"><Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setMobilePanel("chat")}><ArrowLeft className="h-5 w-5" /></Button><div><p className="text-sm font-semibold">Detail Koreksi</p><p className="text-[11px] text-[#667781]">Konteks dan training tersimpan</p></div></div>
        <div className="shrink-0 border-b bg-[#f0f2f5] p-3"><div className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 shadow-sm"><button onClick={() => setRightTab("context")} className={cn("rounded-full px-3 py-2 text-xs font-semibold", rightTab === "context" ? "bg-[#008069] text-white" : "text-[#667781]")}>Konteks</button><button onClick={() => setRightTab("saved")} className={cn("rounded-full px-3 py-2 text-xs font-semibold", rightTab === "saved" ? "bg-[#008069] text-white" : "text-[#667781]")}>Tersimpan</button></div></div>
        {rightTab === "context" ? <RightContext summary={summary} setSummary={setSummary} saveSessionMut={saveSessionMut as SimpleMutation} trainingMessagesCount={trainingMessages.length} selectedThread={selectedThread} mapPhone={mapPhone} setMapPhone={setMapPhone} mapIdentityMut={mapIdentityMut as SimpleMutation} /> : <SavedPanel sessions={sessions} deleteSessionMut={deleteSessionMut as SimpleMutation} />}
      </aside>
    </div>
  );
}

function ThreadListItem({ thread, active, onClick }: { thread: ThreadRow; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={cn("flex min-h-[72px] w-full items-center gap-3 border-b px-3 py-3 text-left hover:bg-[#f5f6f6] sm:px-4", active && "bg-[#f0f2f5]")}><AvatarCircle thread={thread} /><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2"><p className="truncate text-[13px] font-semibold">{formatWaPhone(primaryPhone(thread))}</p>{thread.last_message_at && <span className="shrink-0 text-[10px] text-[#667781]">{formatRelativeDateID(thread.last_message_at)}</span>}</div><p className="mt-0.5 truncate text-xs text-[#667781]">{displayName(thread)}{thread.identity_type === "lid" ? " · LID live" : ""}</p><p className="mt-0.5 truncate text-xs text-[#667781]">{thread.last_message_preview || "-"}</p></div></button>;
}

function ThreadHeader({ thread, loading, onRefresh, onBack, onDetails }: { thread: ThreadRow; loading: boolean; onRefresh: () => void; onBack: () => void; onDetails: () => void }) {
  return <header className="flex h-[58px] shrink-0 items-center gap-2 border-b bg-white px-2 sm:gap-3 sm:px-4 md:px-5"><Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full md:hidden" onClick={onBack}><ArrowLeft className="h-5 w-5" /></Button><AvatarCircle thread={thread} compact /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold sm:text-[15px]">{formatWaPhone(primaryPhone(thread))}</p><p className="truncate text-[11px] text-[#667781] sm:text-xs">{displayName(thread)} · Supabase{thread.external_chat_id ? ` · ${thread.external_chat_id}` : ""}</p></div><Badge className="hidden bg-emerald-100 text-emerald-700 hover:bg-emerald-100 sm:inline-flex">DB</Badge><Button size="icon" variant="ghost" className="h-9 w-9 rounded-full md:hidden" onClick={onDetails}><Info className="h-5 w-5" /></Button><Button size="sm" variant="outline" className="hidden h-8 rounded-full px-3 text-xs sm:flex" disabled={loading} onClick={onRefresh}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Refresh</Button></header>;
}

function AvatarCircle({ thread, compact = false }: { thread: ThreadRow | null; compact?: boolean }) { return <div className={cn("flex shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f]", compact ? "h-9 w-9 sm:h-11 sm:w-11" : "h-11 w-11")}>{thread ? avatarText(thread) : <MessageCircle className="h-5 w-5" />}</div>; }

function MessageTimeline(props: { messages: MessageRow[]; latestRef: RefObject<HTMLDivElement | null>; editingMessageId: string | null; setEditingMessageId: (id: string | null) => void; draftBody: string; setDraftBody: (value: string) => void; editedBodies: Record<string, string>; setEditedBodies: Dispatch<SetStateAction<Record<string, string>>> }) {
  let lastDay = "";
  return <>{props.messages.map((message, idx) => { const day = messageDay(message.sent_at); const showDay = day !== lastDay; lastDay = day; return <div key={message.id}>{showDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/80 px-3 py-1 text-[11px] font-medium text-[#667781] shadow-sm">{formatDateID(message.sent_at)}</span></div>}<ChatBubble message={message} latestRef={idx === props.messages.length - 1 ? props.latestRef : null} editingMessageId={props.editingMessageId} setEditingMessageId={props.setEditingMessageId} draftBody={props.draftBody} setDraftBody={props.setDraftBody} editedBodies={props.editedBodies} setEditedBodies={props.setEditedBodies} /></div>; })}<div className="h-20 md:h-[45vh]" /></>;
}

function ChatBubble(props: { message: MessageRow; latestRef: RefObject<HTMLDivElement | null> | null; editingMessageId: string | null; setEditingMessageId: (id: string | null) => void; draftBody: string; setDraftBody: (value: string) => void; editedBodies: Record<string, string>; setEditedBodies: Dispatch<SetStateAction<Record<string, string>>> }) {
  const m = props.message; const out = m.direction === "out"; const editing = props.editingMessageId === m.id; const shown = props.editedBodies[m.id] ?? m.body;
  return <div ref={props.latestRef ?? undefined} className={cn("mb-1 flex", out ? "justify-end" : "justify-start")}><div className={cn("w-fit max-w-[88%] rounded-lg px-2.5 py-1.5 text-[13px] shadow sm:max-w-[78%] sm:text-[14px] lg:max-w-[min(620px,62%)]", out ? "bg-[#d9fdd3]" : "bg-white")}>{editing ? <Textarea rows={5} value={props.draftBody} onChange={(e) => props.setDraftBody(e.target.value)} className="w-[72vw] min-w-0 bg-white text-sm sm:w-[420px] sm:max-w-full" /> : <p className="whitespace-pre-wrap break-words">{shown}</p>}<div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-[#667781]">{props.editedBodies[m.id] && <Badge className="h-4 bg-[#e7fce3] px-1.5 text-[9px] text-[#008069]">edited</Badge>}<Badge className="h-4 bg-sky-100 px-1.5 text-[9px] text-sky-700">live</Badge><span>{formatTimeID(m.sent_at)}</span></div>{out && <div className="mt-2 flex justify-end gap-1">{editing ? <Button size="sm" className="h-8 rounded-full bg-[#008069] px-3 text-[11px]" onClick={() => { props.setEditedBodies((prev) => ({ ...prev, [m.id]: props.draftBody })); props.setEditingMessageId(null); }}>Terapkan</Button> : <Button size="sm" variant="ghost" className="h-8 rounded-full px-2 text-[11px] text-[#667781]" onClick={() => { props.setEditingMessageId(m.id); props.setDraftBody(shown); }}>Edit Koreksi</Button>}</div>}</div></div>;
}

function RightContext(props: { summary: string; setSummary: (value: string) => void; saveSessionMut: SimpleMutation; trainingMessagesCount: number; selectedThread: ThreadRow | null; mapPhone: string; setMapPhone: (value: string) => void; mapIdentityMut: SimpleMutation }) {
  const lid = lidDigits(props.selectedThread);
  return <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4"><section className="rounded-lg border bg-white p-3 shadow-sm"><h2 className="text-sm font-semibold">Training Context</h2><p className="mt-1 text-xs text-[#667781]">Pesan dibaca dari Supabase conversation DB; WPPConnect tetap dipakai untuk engine/session WhatsApp.</p><Textarea rows={10} className="mt-3 min-h-44 text-xs" value={props.summary} onChange={(e) => props.setSummary(e.target.value)} /><Button className="mt-3 h-11 w-full rounded-full bg-[#008069] hover:bg-[#00695c]" disabled={!props.trainingMessagesCount || props.saveSessionMut.isPending} onClick={() => props.saveSessionMut.mutate()}>{props.saveSessionMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Simpan Percakapan</Button></section><section className="rounded-lg border bg-white p-3 text-xs text-[#667781]"><h2 className="text-sm font-semibold text-[#111b21]">Identitas</h2><p className="mt-2 break-all">Nomor: {formatWaPhone(primaryPhone(props.selectedThread))}</p><p className="break-all">ChatId: {props.selectedThread?.external_chat_id || "-"}</p><p>Source: {props.selectedThread?.source || "supabase_mirror"}</p>{lid && !isPublicPhone(primaryPhone(props.selectedThread)) && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="font-semibold text-amber-800">Map LID ke Nomor WA</p><p className="mt-1 break-all text-[11px] text-amber-700">LID: {lid}</p><Input className="mt-2 h-10 bg-white text-xs" inputMode="numeric" placeholder="6281234567890" value={props.mapPhone} onChange={(e) => props.setMapPhone(e.target.value)} /><Button size="sm" className="mt-2 h-10 w-full rounded-full bg-[#008069] text-xs hover:bg-[#00695c]" disabled={props.mapIdentityMut.isPending || !props.mapPhone.trim()} onClick={() => props.mapIdentityMut.mutate()}>{props.mapIdentityMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Simpan Mapping</Button></div>}</section></div>;
}

function SavedPanel({ sessions, deleteSessionMut }: { sessions: SessionRow[]; deleteSessionMut: SimpleMutation }) {
  return <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4"><div className="mb-3"><h2 className="text-sm font-semibold">Percakapan tersimpan</h2><p className="text-xs text-[#667781]">Daftar full conversation training yang sudah disimpan.</p></div><div className="space-y-3">{sessions.length === 0 ? <div className="rounded-lg border border-dashed p-4 text-center text-xs text-[#667781]">Belum ada percakapan tersimpan.</div> : sessions.map((s) => <div key={s.id} className="rounded-lg border bg-white p-3 text-xs shadow-sm"><div className="flex items-center justify-between gap-2"><Badge variant="outline" className="text-[9px]">{s.status}</Badge><div className="flex items-center gap-1">{s.embedding_updated_at ? <Badge className="bg-emerald-100 text-[9px] text-emerald-700">embedded</Badge> : <Badge variant="outline" className="text-[9px]">no embedding</Badge>}<Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" disabled={deleteSessionMut.isPending} onClick={() => { if (window.confirm("Hapus percakapan tersimpan ini dari training?")) deleteSessionMut.mutate(s.id); }}><Trash2 className="h-4 w-4" /></Button></div></div><p className="mt-3 font-semibold leading-snug">{s.title || "Percakapan"}</p><p className="mt-1 whitespace-pre-wrap break-words text-[#667781]">{s.conversation_summary || "-"}</p><p className="mt-2 text-[10px] text-[#667781]">{formatRelativeDateID(s.created_at)}</p></div>)}</div></div>;
}
