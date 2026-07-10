import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  Edit3,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDateID, formatRelativeDateID, formatTimeID } from "@/lib/utils";
import {
  createWhatsappCorrectionFromMessages,
  createWhatsappCorrectionSession,
  listWhatsappCorrectionSessions,
  listWhatsappCorrectionThreadMessages,
  listWhatsappCorrectionThreads,
} from "@/admin/modules/training/wa-correction.functions";
import { deleteWhatsappCorrectionSession } from "@/admin/modules/training/wa-correction-session.functions";
import { listWppSyncRuns, syncWhatsappThreadFromWppConnect } from "@/admin/modules/training/wpp-sync.functions";
import { syncWhatsappChatListFromWppConnect } from "@/admin/modules/training/wpp-chat-list-sync.functions";

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
  lid_alias?: string | null;
  identity_type?: string | null;
  sync_error?: string | null;
  last_synced_at?: string | null;
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
type SyncRunRow = {
  id: string;
  sync_type?: string;
  thread_id: string | null;
  phone: string | null;
  status: string;
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  created_at: string;
};

const INTENTS = [
  "general",
  "availability_check",
  "pricing_inquiry",
  "booking_start",
  "booking_inquiry",
  "payment",
  "complaint",
  "room_detail_question",
];
const AGENTS = ["front-office", "pricing", "customer-care", "finance", "manager"];
const ERRORS = [
  "wrong_intent",
  "wrong_agent",
  "wrong_date",
  "wrong_room_context",
  "availability_wrong",
  "price_wrong",
  "incomplete_answer",
  "too_short",
  "ignored_context",
  "tool_not_used",
];
const HIDDEN_ATTACHMENT_RE = /^\[Lampiran\s+(e2e_notification|notification_template|ciphertext)\]$/i;
const BUSINESS_SELF_RE = /pomah\s*guesthouse|pomah\s*guest\s*house|pomah\s*guesthouse\s*dewi/i;
const SELF_BUSINESS_PHONES = new Set(["6280883579129903"]);
const CHAT_BG_STYLE = {
  backgroundColor: "#efeae2",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='340' height='340' viewBox='0 0 340 340'%3E%3Cg fill='none' stroke='%23d8cbbb' stroke-opacity='.38' stroke-width='2'%3E%3Ccircle cx='42' cy='42' r='19'/%3E%3Cpath d='M102 35c24 17 24 39 0 58M176 24l22 16-8 26-28 0-8-26zM49 140h55M75 112v55M154 123c31 0 31 46 0 46s-31-46 0-46zM220 118l58 58M278 118l-58 58M126 242h72v48h-72zM292 253h28M306 239v28'/%3E%3C/g%3E%3C/svg%3E\")",
  backgroundSize: "340px 340px",
};

function digits(v: string | null | undefined) {
  return String(v ?? "").replace(/\D/g, "");
}
function isTrainingMessage(m: MessageRow) {
  return !HIDDEN_ATTACHMENT_RE.test((m.body ?? "").trim());
}
function isUsefulPreview(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return !!s && s !== "-" && !/^\[Lampiran\s+(e2e_notification|notification_template|ciphertext)\]$/i.test(s);
}
function isBusinessSelfThread(t: ThreadRow) {
  const phone = digits(t.phone);
  return SELF_BUSINESS_PHONES.has(phone) || BUSINESS_SELF_RE.test(t.display_name ?? "");
}
function threadKey(t: ThreadRow) {
  const phone = digits(t.phone);
  return phone || `name:${String(t.display_name ?? "").trim().toLowerCase()}` || t.id;
}
function threadScore(t: ThreadRow) {
  let score = 0;
  if (isUsefulPreview(t.last_message_preview)) score += 80;
  if (t.display_name && t.display_name !== t.phone) score += 20;
  if (/^628\d{8,14}$/.test(digits(t.phone))) score += 15;
  if (t.last_message_at) score += Math.min(10, Math.floor(new Date(t.last_message_at).getTime() / 86400000 / 100000));
  return score;
}
function dedupeThreads(rows: ThreadRow[]) {
  const byKey = new Map<string, ThreadRow>();
  for (const row of rows) {
    if (isBusinessSelfThread(row)) continue;
    const key = threadKey(row);
    const current = byKey.get(key);
    if (!current || threadScore(row) > threadScore(current)) byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime(),
  );
}
function messageKey(m: MessageRow) {
  const md = m.metadata ?? {};
  const external = String(md.external_message_id ?? md.wpp_id ?? md.id ?? "").trim();
  if (external) return `external:${external}`;
  const minute = Math.floor(new Date(m.sent_at).getTime() / 60000);
  const body = String(m.body ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return `${m.direction}|${minute}|${body}`;
}
function dedupeMessages(rows: MessageRow[]) {
  const map = new Map<string, MessageRow>();
  for (const row of rows) {
    const key = messageKey(row);
    const current = map.get(key);
    if (!current || String(row.metadata?.source ?? "") !== "wppconnect_sync") map.set(key, row);
  }
  return [...map.values()].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
}
function formatWaPhone(phone: string | null | undefined) {
  const p = digits(phone);
  if (!p.startsWith("62") || p.length < 10) return phone || "-";
  const local = `+${p.slice(0, 2)} ${p.slice(2, 5)}-${p.slice(5, 9)}-${p.slice(9)}`;
  return local.replace(/-$/g, "");
}
function isPublicPhone(value: string | null | undefined) {
  return /^62\d{8,14}$/.test(digits(value));
}
function primaryPhone(thread: ThreadRow | null | undefined) {
  if (!thread) return null;
  if (isPublicPhone(thread.canonical_phone)) return thread.canonical_phone;
  if (isPublicPhone(thread.phone)) return thread.phone;
  return thread.phone;
}
function hasUnresolvedIdentity(thread: ThreadRow | null | undefined) {
  if (!thread) return false;
  return !isPublicPhone(primaryPhone(thread)) || thread.identity_type === "lid" || !!thread.sync_error;
}
function looksLikeSession(value: string | null | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "pomahchatbot" || text.includes("session");
}
function displayName(thread: ThreadRow | null | undefined) {
  const name = String(thread?.display_name ?? "").trim();
  if (!name || name === thread?.phone || looksLikeSession(name) || digits(name) === digits(thread?.phone)) return "No Name";
  return name;
}
function avatarText(thread: ThreadRow | null | undefined) {
  const source = displayName(thread) !== "No Name" ? displayName(thread) : formatWaPhone(primaryPhone(thread));
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";
}
function messageDay(iso: string) {
  return new Date(iso).toDateString();
}
function buildContext(thread: ThreadRow | null, messages: MessageRow[]) {
  const json = thread?.chat_summary_json ?? {};
  const lines: string[] = [];
  if (thread) lines.push(`Tamu: ${displayName(thread)} (${formatWaPhone(thread.phone)})`);
  const summary = typeof json.summary === "string" ? json.summary.trim() : thread?.chat_summary?.trim();
  if (summary) lines.push(`Ringkasan: ${summary}`);
  for (const [label, key] of [
    ["Topik terakhir", "last_topic"],
    ["Tipe kamar", "room_type"],
    ["Pertanyaan belum terjawab", "unresolved_question"],
  ] as const) {
    const value = typeof json[key] === "string" ? String(json[key]).trim() : "";
    if (value) lines.push(`${label}: ${value}`);
  }
  const recent = messages.slice(-8).map((m) => `${m.direction === "in" ? "Tamu" : "Bot/Admin"}: ${m.body}`);
  if (recent.length) lines.push(`\nKonteks pesan terakhir:\n${recent.join("\n")}`);
  return lines.join("\n") || "Belum ada ringkasan.";
}

export function WhatsappCorrectionsPage() {
  const qc = useQueryClient();
  const latestRef = useRef<HTMLDivElement | null>(null);
  const threadsFn = useServerFn(listWhatsappCorrectionThreads);
  const messagesFn = useServerFn(listWhatsappCorrectionThreadMessages);
  const createCorrectionFn = useServerFn(createWhatsappCorrectionFromMessages);
  const createSessionFn = useServerFn(createWhatsappCorrectionSession);
  const sessionsFn = useServerFn(listWhatsappCorrectionSessions);
  const deleteSessionFn = useServerFn(deleteWhatsappCorrectionSession);
  const syncChatListFn = useServerFn(syncWhatsappChatListFromWppConnect);
  const syncThreadFn = useServerFn(syncWhatsappThreadFromWppConnect);
  const syncRunsFn = useServerFn(listWppSyncRuns);
  const autoSyncedThreadsRef = useRef<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState("");
  const [rightTab, setRightTab] = useState<"context" | "saved">("context");
  const [correctIntent, setCorrectIntent] = useState("general");
  const [correctAgent, setCorrectAgent] = useState("front-office");
  const [errorType, setErrorType] = useState("incomplete_answer");

  const { data: threadsData, isFetching: loadingThreads } = useQuery({
    queryKey: ["wa-correction-threads"],
    queryFn: () => threadsFn({ data: { limit: 200 } }),
  });
  const rawThreads = (threadsData?.rows ?? []) as ThreadRow[];
  const threads = useMemo(() => dedupeThreads(rawThreads), [rawThreads]);
  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      [displayName(t), t.phone, t.last_message_preview].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [threads, search]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? filteredThreads[0] ?? null;

  useEffect(() => {
    if (!selectedThreadId && filteredThreads[0]) setSelectedThreadId(filteredThreads[0].id);
  }, [filteredThreads, selectedThreadId]);
  useEffect(() => {
    if (selectedThreadId && !threads.some((t) => t.id === selectedThreadId)) setSelectedThreadId(filteredThreads[0]?.id ?? null);
  }, [selectedThreadId, threads, filteredThreads]);

  const { data: messagesData, isFetching: loadingMessages } = useQuery({
    queryKey: ["wa-correction-messages", selectedThread?.id],
    enabled: !!selectedThread?.id,
    queryFn: () => messagesFn({ data: { threadId: selectedThread!.id } }),
  });
  const messages = (messagesData?.rows ?? []) as MessageRow[];
  const trainingMessages = useMemo(() => dedupeMessages(messages.filter(isTrainingMessage)), [messages]);
  const { data: sessionsData } = useQuery({
    queryKey: ["wa-correction-sessions"],
    queryFn: () => sessionsFn({ data: { limit: 80 } }),
  });
  const sessions = (sessionsData?.rows ?? []) as SessionRow[];
  const { data: syncRunsData } = useQuery({
    queryKey: ["wa-wpp-sync-runs"],
    queryFn: () => syncRunsFn({ data: { limit: 10 } }),
  });
  const syncRuns = (syncRunsData?.rows ?? []) as SyncRunRow[];

  useEffect(() => {
    setEditedBodies({});
    setEditingMessageId(null);
    setDraftBody("");
  }, [selectedThread?.id]);
  useEffect(() => setSummary(buildContext(selectedThread, trainingMessages)), [selectedThread?.id, trainingMessages.length]);
  useEffect(() => {
    if (!loadingMessages && trainingMessages.length) window.setTimeout(() => latestRef.current?.scrollIntoView({ block: "start" }), 80);
  }, [loadingMessages, selectedThread?.id, trainingMessages.length]);

  function previousInboundId(outId: string) {
    const idx = trainingMessages.findIndex((m) => m.id === outId);
    for (let i = idx - 1; i >= 0; i--) if (trainingMessages[i].direction === "in") return trainingMessages[i].id;
    return null;
  }

  const syncChatListMut = useMutation({
    mutationFn: () => syncChatListFn({ data: { limit: 200 } }),
    onSuccess: (res) => {
      toast.success(`Sync daftar chat selesai: ${res.inserted} baru, ${res.updated} update, ${res.skipped} skip.`);
      qc.invalidateQueries({ queryKey: ["wa-correction-threads"] });
      qc.invalidateQueries({ queryKey: ["wa-wpp-sync-runs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const syncThreadMut = useMutation({
    mutationFn: (threadId: string) => syncThreadFn({ data: { threadId, limit: 120 } }),
    onSuccess: (res) => {
      toast.success(`Pesan WPP tersinkron: ${res.imported} baru, ${res.updated} update.`);
      qc.invalidateQueries({ queryKey: ["wa-correction-threads"] });
      qc.invalidateQueries({ queryKey: ["wa-correction-messages", res.threadId] });
      qc.invalidateQueries({ queryKey: ["wa-wpp-sync-runs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useEffect(() => {
    if (!selectedThread?.id) return;
    if (autoSyncedThreadsRef.current.has(selectedThread.id)) return;
    if (!hasUnresolvedIdentity(selectedThread) && trainingMessages.length > 0) return;
    autoSyncedThreadsRef.current.add(selectedThread.id);
    syncThreadMut.mutate(selectedThread.id);
  }, [selectedThread?.id]);
  const saveTurnMut = useMutation({
    mutationFn: async (message: MessageRow) => {
      const inboundId = previousInboundId(message.id);
      if (!inboundId) throw new Error("Tidak menemukan pesan tamu sebelum bubble bot ini.");
      const ideal = (editedBodies[message.id] ?? draftBody).trim();
      if (!ideal) throw new Error("Jawaban ideal belum diisi.");
      return createCorrectionFn({
        data: {
          userMessageId: inboundId,
          wrongReplyMessageId: message.id,
          idealReply: ideal,
          correctIntent,
          correctAgent,
          errorType,
          severity: "medium",
          notes: "Dikoreksi dari WhatsApp Corrections Mode.",
          status: "approved",
        },
      });
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
      return createSessionFn({
        data: {
          threadId: selectedThread.id,
          title: displayName(selectedThread) !== "No Name" ? displayName(selectedThread) : formatWaPhone(selectedThread.phone),
          summary: summary || selectedThread.last_message_preview || "Percakapan WhatsApp terkoreksi.",
          correctedTranscript,
          status: "approved",
        },
      });
    },
    onSuccess: () => {
      toast.success("Percakapan utuh disimpan sebagai training context.");
      setRightTab("saved");
      qc.invalidateQueries({ queryKey: ["wa-correction-sessions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const deleteSessionMut = useMutation({
    mutationFn: (id: string) => deleteSessionFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Percakapan tersimpan dihapus dari training.");
      qc.invalidateQueries({ queryKey: ["wa-correction-sessions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex h-screen min-h-0 bg-[#f0f2f5] text-[#111b21]">
      <aside className="flex min-h-0 w-[380px] min-w-[320px] max-w-[420px] flex-col border-r border-[#e9edef] bg-white">
        <div className="flex h-[58px] items-center justify-between bg-[#008069] px-4 text-white">
          <div className="font-semibold">WA Correction</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-full border-white/45 bg-white/10 px-3 text-xs text-white hover:bg-white/20 hover:text-white"
            disabled={syncChatListMut.isPending}
            onClick={() => syncChatListMut.mutate()}
          >
            {syncChatListMut.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Sinkron
          </Button>
        </div>
        <div className="border-b border-[#e9edef] px-3 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667781]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-full border-0 bg-[#f0f2f5] pl-9 text-sm shadow-none focus-visible:ring-0"
              placeholder="Cari nomor atau nama..."
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingThreads && filteredThreads.length === 0 ? (
            <p className="p-4 text-sm text-[#667781]">Memuat...</p>
          ) : filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#667781]">Belum ada percakapan.</div>
          ) : (
            filteredThreads.map((t) => (
              <ThreadListItem key={t.id} thread={t} active={selectedThread?.id === t.id} onClick={() => setSelectedThreadId(t.id)} />
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {selectedThread ? (
          <>
            <ThreadHeader
              thread={selectedThread}
              syncing={syncThreadMut.isPending}
              onRefresh={() => syncThreadMut.mutate(selectedThread.id)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(1.25rem,4vw,5rem)] py-5" style={CHAT_BG_STYLE}>
              {loadingMessages ? (
                <p className="rounded-lg bg-white/80 px-3 py-2 text-sm text-[#667781] shadow-sm">Memuat pesan...</p>
              ) : (
                <MessageTimeline
                  messages={trainingMessages}
                  latestRef={latestRef}
                  editingMessageId={editingMessageId}
                  setEditingMessageId={setEditingMessageId}
                  draftBody={draftBody}
                  setDraftBody={setDraftBody}
                  editedBodies={editedBodies}
                  setEditedBodies={setEditedBodies}
                  saveTurnMut={saveTurnMut}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[#f0f2f5] p-8 text-center text-sm text-[#667781]">
            Pilih percakapan di sebelah kiri untuk melihat pesan.
          </div>
        )}
      </section>

      <aside className="flex min-h-0 w-[380px] flex-col border-l border-[#e9edef] bg-white">
        <div className="border-b border-[#e9edef] bg-[#f0f2f5] p-3">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setRightTab("context")}
              className={cn(
                "rounded-full px-3 py-2 text-xs font-semibold transition",
                rightTab === "context" ? "bg-[#008069] text-white" : "text-[#667781] hover:text-[#111b21]",
              )}
            >
              Konteks
            </button>
            <button
              type="button"
              onClick={() => setRightTab("saved")}
              className={cn(
                "rounded-full px-3 py-2 text-xs font-semibold transition",
                rightTab === "saved" ? "bg-[#008069] text-white" : "text-[#667781] hover:text-[#111b21]",
              )}
            >
              Tersimpan
            </button>
          </div>
        </div>
        {rightTab === "context" ? (
          <RightContext
            summary={summary}
            setSummary={setSummary}
            correctIntent={correctIntent}
            setCorrectIntent={setCorrectIntent}
            correctAgent={correctAgent}
            setCorrectAgent={setCorrectAgent}
            errorType={errorType}
            setErrorType={setErrorType}
            syncRuns={syncRuns}
            saveSessionMut={saveSessionMut}
            trainingMessagesCount={trainingMessages.length}
          />
        ) : (
          <SavedPanel sessions={sessions} deleteSessionMut={deleteSessionMut} />
        )}
      </aside>
    </div>
  );
}

function ThreadListItem({ thread, active, onClick }: { thread: ThreadRow; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 border-b border-[#f5f6f6] px-4 py-3 text-left transition hover:bg-[#f5f6f6]",
        active && "bg-[#f0f2f5]",
      )}
    >
      <AvatarCircle thread={thread} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] font-semibold text-[#111b21]">{formatWaPhone(primaryPhone(thread))}</p>
          {thread.last_message_at && <span className="shrink-0 text-[10px] text-[#667781]">{formatRelativeDateID(thread.last_message_at)}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-[#667781]">
          {displayName(thread)}
          {hasUnresolvedIdentity(thread) ? " · LID belum terpetakan" : ""}
        </p>
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[#667781]">
          <span>{thread.last_message_preview ? "↘" : ""}</span>
          <span className="truncate">{thread.last_message_preview || "-"}</span>
        </div>
      </div>
    </button>
  );
}

function ThreadHeader({ thread, syncing, onRefresh }: { thread: ThreadRow; syncing: boolean; onRefresh: () => void }) {
  return (
    <header className="flex h-[58px] items-center gap-3 border-b border-[#e9edef] bg-white px-5">
      <AvatarCircle thread={thread} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-[#111b21]">{formatWaPhone(primaryPhone(thread))}</p>
        <p className="truncate text-xs text-[#667781]">
          {displayName(thread)}
          {hasUnresolvedIdentity(thread) ? " · mencari nomor WA dari VPS" : ""}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 rounded-full px-3 text-xs"
        disabled={syncing}
        onClick={onRefresh}
      >
        {syncing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
        Refresh WPP
      </Button>
    </header>
  );
}

function AvatarCircle({ thread }: { thread: ThreadRow | null }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dfe5e7] text-sm font-semibold text-[#54656f]">
      {thread ? avatarText(thread) : <MessageCircle className="h-5 w-5" />}
    </div>
  );
}

function MessageTimeline(props: {
  messages: MessageRow[];
  latestRef: React.RefObject<HTMLDivElement | null>;
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;
  draftBody: string;
  setDraftBody: (value: string) => void;
  editedBodies: Record<string, string>;
  setEditedBodies: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saveTurnMut: UseMutationResult<any, any, any, any>;
}) {
  let lastDay = "";
  return (
    <>
      {props.messages.map((message, idx) => {
        const day = messageDay(message.sent_at);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={message.id}>
            {showDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-lg bg-white/80 px-3 py-1 text-[11px] font-medium text-[#667781] shadow-sm">
                  {formatDateID(message.sent_at)}
                </span>
              </div>
            )}
            <ChatBubble
              message={message}
              latestRef={idx === props.messages.length - 1 ? props.latestRef : null}
              editingMessageId={props.editingMessageId}
              setEditingMessageId={props.setEditingMessageId}
              draftBody={props.draftBody}
              setDraftBody={props.setDraftBody}
              editedBodies={props.editedBodies}
              setEditedBodies={props.setEditedBodies}
              saveTurnMut={props.saveTurnMut}
            />
          </div>
        );
      })}
      <div className="h-[45vh]" />
    </>
  );
}

function ChatBubble(props: {
  message: MessageRow;
  latestRef: React.RefObject<HTMLDivElement | null> | null;
  editingMessageId: string | null;
  setEditingMessageId: (id: string | null) => void;
  draftBody: string;
  setDraftBody: (value: string) => void;
  editedBodies: Record<string, string>;
  setEditedBodies: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saveTurnMut: UseMutationResult<any, any, any, any>;
}) {
  const m = props.message;
  const out = m.direction === "out";
  const editing = props.editingMessageId === m.id;
  const shown = props.editedBodies[m.id] ?? m.body;
  return (
    <div ref={props.latestRef ?? undefined} className={cn("mb-0.5 flex scroll-mt-4", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative w-fit max-w-[min(620px,56%)] rounded-[7.5px] px-2 py-1 text-[14px] leading-snug shadow-[0_1px_0.5px_rgba(11,20,26,0.18)]",
          out ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white",
        )}
      >
        <span
          className={cn(
            "absolute top-0 h-0 w-0 border-t-[8px] border-t-current",
            out ? "-right-2 text-[#d9fdd3] border-r-[8px] border-r-transparent" : "-left-2 text-white border-l-[8px] border-l-transparent",
          )}
        />
        {editing ? (
          <Textarea
            rows={5}
            value={props.draftBody}
            onChange={(e) => props.setDraftBody(e.target.value)}
            className="min-w-[420px] border-[#d1d7db] bg-white text-sm"
          />
        ) : (
          <p className="whitespace-pre-wrap break-words pr-1">{shown}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-1 text-[10px] text-[#667781]">
          {props.editedBodies[m.id] && <Badge className="h-4 bg-[#e7fce3] px-1.5 text-[9px] text-[#008069] hover:bg-[#e7fce3]">edited</Badge>}
          {m.metadata?.source === "wppconnect_sync" && <Badge className="h-4 bg-sky-100 px-1.5 text-[9px] text-sky-700 hover:bg-sky-100">wpp sync</Badge>}
          {out && Boolean(m.metadata?.agent_key) && (
            <Badge className="h-4 bg-amber-100 px-1.5 text-[9px] text-amber-700 hover:bg-amber-100">{String(m.metadata?.agent_key ?? "")}</Badge>
          )}
          <span>{formatTimeID(m.sent_at)}</span>
        </div>
        {out && (
          <div className="mt-2 flex justify-end gap-1">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full bg-white px-2 text-[11px]"
                  onClick={() => {
                    props.setEditedBodies((prev) => ({ ...prev, [m.id]: props.draftBody }));
                    props.setEditingMessageId(null);
                  }}
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Terapkan
                </Button>
                <Button size="sm" className="h-7 rounded-full bg-[#008069] px-2 text-[11px] hover:bg-[#00695c]" onClick={() => props.saveTurnMut.mutate(m)} disabled={props.saveTurnMut.isPending}>
                  <Save className="mr-1 h-3 w-3" />
                  Simpan
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 rounded-full" onClick={() => props.setEditingMessageId(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 rounded-full px-2 text-[11px] text-[#667781] hover:bg-white/70"
                onClick={() => {
                  props.setEditingMessageId(m.id);
                  props.setDraftBody(shown);
                }}
              >
                <Edit3 className="mr-1 h-3 w-3" />
                Edit Koreksi
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RightContext(props: {
  summary: string;
  setSummary: (value: string) => void;
  correctIntent: string;
  setCorrectIntent: (value: string) => void;
  correctAgent: string;
  setCorrectAgent: (value: string) => void;
  errorType: string;
  setErrorType: (value: string) => void;
  syncRuns: SyncRunRow[];
  saveSessionMut: UseMutationResult<any, any, any, any>;
  trainingMessagesCount: number;
}) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <section className="rounded-lg border border-[#e9edef] bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold">Training Context</h2>
        <Textarea rows={9} className="mt-3 text-xs" value={props.summary} onChange={(e) => props.setSummary(e.target.value)} />
        <Button
          className="mt-3 w-full rounded-full bg-[#008069] hover:bg-[#00695c]"
          disabled={!props.trainingMessagesCount || props.saveSessionMut.isPending}
          onClick={() => props.saveSessionMut.mutate(undefined as never)}
        >
          {props.saveSessionMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Simpan Percakapan Utuh
        </Button>
      </section>
      <section className="rounded-lg border border-[#e9edef] bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold">Default koreksi bubble</h2>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <SelectField label="Intent" value={props.correctIntent} onChange={props.setCorrectIntent} options={INTENTS} />
          <SelectField label="Agent" value={props.correctAgent} onChange={props.setCorrectAgent} options={AGENTS} />
          <SelectField label="Error" value={props.errorType} onChange={props.setErrorType} options={ERRORS} />
        </div>
      </section>
      <section className="rounded-lg border border-[#e9edef] bg-white p-3 shadow-sm">
        <h2 className="text-sm font-semibold">WPPConnect Sync</h2>
        <p className="mt-1 text-xs text-[#667781]">Riwayat sinkron dari mirror WPPConnect ke Supabase.</p>
        <div className="mt-3 space-y-2">
          {props.syncRuns.slice(0, 5).map((r) => (
            <div key={r.id} className="rounded-lg border border-[#e9edef] p-2 text-xs">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[9px]">{r.status}</Badge>
                <span className="text-[10px] text-[#667781]">{formatRelativeDateID(r.created_at)}</span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-[#667781]">{r.sync_type || r.phone || "sync"}</p>
              <p className="mt-1">+{r.imported_count} baru - {r.updated_count} update - {r.skipped_count} skip</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SavedPanel({ sessions, deleteSessionMut }: { sessions: SessionRow[]; deleteSessionMut: UseMutationResult<any, any, any, any> }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Percakapan tersimpan</h2>
        <p className="text-xs text-[#667781]">Daftar full conversation training yang sudah disimpan.</p>
      </div>
      <div className="space-y-3">
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d1d7db] p-4 text-center text-xs text-[#667781]">Belum ada percakapan tersimpan.</div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="rounded-lg border border-[#e9edef] bg-white p-3 text-xs shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[9px]">{s.status}</Badge>
                <div className="flex items-center gap-1">
                  {s.embedding_updated_at ? (
                    <Badge className="bg-emerald-100 text-[9px] text-emerald-700 hover:bg-emerald-100">embedded</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px]">no embedding</Badge>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    disabled={deleteSessionMut.isPending}
                    onClick={() => {
                      if (window.confirm("Hapus percakapan tersimpan ini dari training? Chat WhatsApp asli tidak ikut terhapus.")) deleteSessionMut.mutate(s.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-3 font-semibold leading-snug">{s.title || "Percakapan"}</p>
              <p className="mt-1 whitespace-pre-wrap text-[#667781]">{s.conversation_summary || "-"}</p>
              <p className="mt-2 text-[10px] text-[#667781]">{formatRelativeDateID(s.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded-md border border-[#d1d7db] bg-white px-2 text-xs">
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
