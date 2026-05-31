import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  Search as SearchIcon,
  Pin,
  PinOff,

  Tag,
  User as UserIcon,
  UserCheck,
  ArrowUpRight,
  CalendarDays,
  Phone,
  Wand2,
  MessagesSquare,
  Inbox,
  Plus,
  Trash2,
  Bot,
  GitMerge,
  Wrench,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  FileText,
  Download,
} from "lucide-react";
import {
  listThreads,
  getThread,
  sendMessage,
  draftAiReply,
  markRead,
  togglePinned,

  setAiMode,
  simulateInbound,
  classifyIntent,
  deleteThread,
  setTrainingExample,
  updateChatSummary,
} from "@/admin/functions/whatsapp.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn, formatDateID, formatRelativeDateID, formatTimeID } from "@/lib/utils";

export const Route = createFileRoute("/admin/whatsapp")({
  component: WhatsAppPage,
});

const INTENT_STYLES: Record<string, { label: string; className: string }> = {
  booking_inquiry: {
    label: "Booking",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  service_request: {
    label: "Service",
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  },
  complaint: {
    label: "Complaint",
    className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  },
  recommendation: {
    label: "Recco",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  },
  feedback: {
    label: "Feedback",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  other: { label: "Other", className: "bg-muted text-muted-foreground border-border" },
};

const TEMPLATES = [
  {
    label: "Welcome",
    body: "Welcome to Pomah Guesthouse! Let us know if you need anything during your stay.",
  },
  {
    label: "Late check-out",
    body: "We can arrange a late check-out until 2 PM at no extra charge. Would that work?",
  },
  {
    label: "Check availability",
    body: "Let me check availability for those dates and get back to you within a few minutes.",
  },
  {
    label: "Rate quote",
    body: "Our nightly rate for that room category starts at IDR 750.000, breakfast included. Want me to hold a room?",
  },
  {
    label: "Maintenance ack",
    body: "Sorry about that — I'm sending someone up right away to take a look. Apologies for the inconvenience.",
  },
  {
    label: "Thank you",
    body: "Thank you so much for staying with us. We hope to welcome you back soon!",
  },
];

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return formatDateID(iso);
}

function dateLabel(iso: string) {
  return formatRelativeDateID(iso);
}

function initials(name?: string | null, fallback?: string) {
  const src = name ?? fallback ?? "?";
  return src
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

export function WhatsAppPage() {
  const listFn = useServerFn(listThreads);
  const getFn = useServerFn(getThread);
  const sendFn = useServerFn(sendMessage);
  const draftFn = useServerFn(draftAiReply);
  const markReadFn = useServerFn(markRead);
  const pinFn = useServerFn(togglePinned);

  const aiModeFn = useServerFn(setAiMode);
  const simulateFn = useServerFn(simulateInbound);
  const classifyFn = useServerFn(classifyIntent);
  const deleteFn = useServerFn(deleteThread);
  const trainingFn = useServerFn(setTrainingExample);
  const updateSummaryFn = useServerFn(updateChatSummary);
  
  const qc = useQueryClient();

  const { data: threadsData } = useQuery({ queryKey: ["wa-threads"], queryFn: () => listFn() });
  const threads = threadsData?.threads ?? [];
  useRealtimeInvalidate(
    "admin-wa-stream",
    ["whatsapp_threads", "whatsapp_messages"],
    [["wa-threads"], ["wa-thread"]],
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "open" | "closed">("all");
  const [draft, setDraft] = useState("");

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const matchSearch =
        !search ||
        (t.display_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        t.phone.includes(search) ||
        (t.last_message_preview ?? "").toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filter === "all"
          ? true
          : filter === "unread"
            ? (t.unread_count ?? 0) > 0
            : t.status === filter;
      return matchSearch && matchFilter;
    });
  }, [threads, search, filter]);

  const current = activeId ?? filteredThreads[0]?.id ?? null;

  const { data: thread } = useQuery({
    queryKey: ["wa-thread", current],
    queryFn: () => getFn({ data: { id: current! } }),
    enabled: !!current,
  });

  // Mark as read on open
  useEffect(() => {
    if (!current) return;
    const t = threads.find((x) => x.id === current);
    if (t && (t.unread_count ?? 0) > 0) {
      markReadFn({ data: { threadId: current } }).then(() => {
        qc.invalidateQueries({ queryKey: ["wa-threads"] });
      });
    }
  }, [current, threads, markReadFn, qc]);

  // Auto scroll on new messages
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread?.messages?.length]);

  const sendMut = useMutation({
    mutationFn: () => sendFn({ data: { threadId: current!, body: draft } }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const draftMut = useMutation({
    mutationFn: () => draftFn({ data: { threadId: current! } }),
    onSuccess: (res) => setDraft(res.draft),
    onError: (e) => toast.error((e as Error).message),
  });

  const classifyMut = useMutation({
    mutationFn: () => classifyFn({ data: { threadId: current! } }),
    onSuccess: (res) => {
      toast.success(`Dianalisis: ${INTENT_STYLES[res.intent]?.label ?? res.intent}`);
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const trainingMut = useMutation({
    mutationFn: (value: boolean) =>
      trainingFn({ data: { threadId: current!, value } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateSummaryMut = useMutation({
    mutationFn: (summary: string) =>
      updateSummaryFn({ data: { threadId: current!, summary } }),
    onSuccess: () => {
      toast.success("Ringkasan obrolan diperbarui");
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Takeover = set ai_auto=false (human takes over), Return = ai_auto=true (AI resumes)
  const takeoverMut = useMutation({
    mutationFn: (takeover: boolean) =>
      aiModeFn({ data: { threadId: current!, aiAuto: !takeover } }),
    onSuccess: (_, takeover) => {
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      toast.success(
        takeover
          ? "Percakapan diambil alih oleh Human (AI dinonaktifkan untuk chat ini)."
          : "Kendali dikembalikan ke AI (AI aktif membalas chat ini).",
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pinMut = useMutation({
    mutationFn: (p: { id: string; pinned: boolean }) =>
      pinFn({ data: { threadId: p.id, pinned: p.pinned } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-threads"] }),
  });



  const aiModeMut = useMutation({
    mutationFn: (aiAuto: boolean) => aiModeFn({ data: { threadId: current!, aiAuto } }),
    onSuccess: (_, aiAuto) => {
      toast.success(aiAuto ? "AI kembali menangani percakapan" : "Mode Human aktif — AI dihentikan");
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const simulateMut = useMutation({
    mutationFn: (body: string) => simulateFn({ data: { threadId: current!, body } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { threadId: id } }),
    onSuccess: () => {
      setActiveId(null);
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      toast.success("Percakapan dihapus");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const totalUnread = threads.reduce((s, t) => s + (t.unread_count ?? 0), 0);

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[300px_1fr_320px] bg-background">
      {/* THREADS LIST */}
      <aside className="flex min-h-0 flex-col border-r border-border bg-white">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Inbox
              </p>
            </div>
            {totalUnread > 0 && (
              <Badge variant="default" className="h-5 px-2 text-[10px]">
                {totalUnread} new
              </Badge>
            )}
          </div>
          <div className="relative mt-3">
            <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, message"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="mt-2 flex gap-1">
            {(["all", "unread", "open", "closed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                  filter === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/10",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          <ul>
            {filteredThreads.map((t) => {
              const intent = INTENT_STYLES[t.intent ?? "other"] ?? INTENT_STYLES.other;
              const active = current === t.id;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "group block w-full border-b border-border px-3 py-3 text-left transition-colors hover:bg-accent/10",
                      active && "bg-accent/15",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="text-[11px] font-semibold">
                          {initials(t.display_name, t.phone)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {t.pinned && <Pin className="h-3 w-3 shrink-0 text-amber-500" />}
                            <p className="truncate text-sm font-semibold">
                              {t.display_name ?? t.phone}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {timeAgo(t.last_message_at)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-xs",
                            (t.unread_count ?? 0) > 0
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {t.last_message_preview}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn("h-4 px-1.5 text-[9px] font-medium", intent.className)}
                          >
                            {intent.label}
                          </Badge>
                          {(t as any).ai_auto === false ? (
                            <Badge
                              variant="outline"
                              className="h-4 px-1.5 text-[9px] border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/35"
                            >
                              Human
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="h-4 px-1.5 text-[9px] border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/35"
                            >
                              AI Auto
                            </Badge>
                          )}
                          {t.status === "closed" && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                              closed
                            </Badge>
                          )}
                          {(t.unread_count ?? 0) > 0 && (
                            <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                              {t.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {filteredThreads.length === 0 && (
              <li className="p-6 text-center text-xs text-muted-foreground">No conversations</li>
            )}
          </ul>
        </ScrollArea>
      </aside>

      {/* CONVERSATION */}
      <section className="flex min-h-0 flex-col">
        {current && thread?.thread ? (
          <>
            <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="text-xs font-semibold">
                    {initials(thread.thread.display_name, thread.thread.phone)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold">
                    {thread.thread.display_name ?? thread.thread.phone}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {thread.thread.phone}
                  </p>
                </div>
                {thread.thread.intent && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "ml-2",
                      INTENT_STYLES[thread.thread.intent]?.className ??
                        INTENT_STYLES.other.className,
                    )}
                  >
                    <Tag className="mr-1 h-3 w-3" />
                    {INTENT_STYLES[thread.thread.intent]?.label ?? thread.thread.intent}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const t = thread.thread;
                    if (!t) return;
                    pinMut.mutate({ id: current, pinned: !t.pinned });
                  }}
                  title={thread.thread.pinned ? "Unpin" : "Pin"}
                >
                  {thread.thread.pinned ? (
                    <PinOff className="h-4 w-4" />
                  ) : (
                    <Pin className="h-4 w-4" />
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const t = thread.thread;
                    if (!t) return;
                    // takeover=true when AI currently auto (ai_auto !== false)
                    const currentlyAi = (t as any).ai_auto !== false;
                    takeoverMut.mutate(currentlyAi);
                  }}
                  className={cn(
                    "gap-2 font-medium transition-all rounded-[8px] border-[1.5px] bg-background px-4 py-1.5 h-9",
                    "border-[#0e7490] text-[#0e7490] hover:bg-[#0e7490]/5 hover:text-[#0e7490]",
                    "dark:border-cyan-500 dark:text-cyan-400 dark:hover:bg-cyan-950/20"
                  )}
                  title={
                    (thread.thread as any).ai_auto === false
                      ? "Human mengambil alih. Klik untuk menyerahkan kembali ke AI."
                      : "AI aktif membalas. Klik untuk mengambil alih ke Human (Matikan AI)."
                  }
                  disabled={takeoverMut.isPending}
                >
                  {(thread.thread as any).ai_auto === false ? (
                    <>
                      <ArrowUpRight className="h-4 w-4 stroke-[2.2]" />
                      Kembalikan ke AI
                    </>
                  ) : (
                    <>
                      <UserCheck className="h-4 w-4 stroke-[2.2]" />
                      Ambil Alih
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (!confirm("Hapus percakapan ini beserta semua pesannya?")) return;
                    deleteMut.mutate(current!);
                  }}
                  title="Hapus percakapan"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#efeae2] px-6 py-4 dark:bg-[#0b141a] relative">
              {/* Optional WhatsApp doodle pattern background overlay can be placed here */}
              <div className="absolute inset-0 opacity-[0.06] dark:opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("https://w7.pngwing.com/pngs/396/505/png-transparent-whatsapp-pattern-black-and-white-floral.png")', backgroundSize: '400px', backgroundRepeat: 'repeat' }} />
              <div className="relative z-10">
                <MessageStream messages={thread.messages} />
              </div>
            </div>

            <footer className="border-t border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <MessagesSquare className="mr-1.5 h-3.5 w-3.5" /> Templates
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                      Quick reply templates
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {TEMPLATES.map((t) => (
                      <DropdownMenuItem key={t.label} onClick={() => setDraft(t.body)}>
                        <div>
                          <p className="text-xs font-medium">{t.label}</p>
                          <p className="line-clamp-1 text-[10px] text-muted-foreground">{t.body}</p>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={draftMut.isPending}
                  onClick={() => draftMut.mutate()}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {draftMut.isPending ? "Drafting…" : "AI draft"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={classifyMut.isPending}
                  onClick={() => classifyMut.mutate()}
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  {classifyMut.isPending ? "Menganalisis…" : "Auto-tag"}
                </Button>
              </div>
              <Textarea
                placeholder="Type a reply…  ⌘/Ctrl + Enter to send"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && draft.trim()) {
                    sendMut.mutate();
                  }
                }}
                className="resize-none"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="font-mono text-[10px] text-muted-foreground">{draft.length} chars</p>
                <Button
                  size="sm"
                  disabled={!draft.trim() || sendMut.isPending}
                  onClick={() => sendMut.mutate()}
                >
                  <Send className="mr-2 h-3.5 w-3.5" />
                  {sendMut.isPending ? "Sending…" : "Send"}
                </Button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessagesSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">Select a conversation</p>
            </div>
          </div>
        )}
      </section>

      {/* GUEST CONTEXT */}
      <aside className="flex min-h-0 flex-col border-l border-border bg-sidebar">
        {current && thread?.thread ? (
          <ScrollArea className="flex-1">
            <div className="space-y-5 p-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Guest
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="text-sm font-semibold">
                      {initials(thread.thread.display_name, thread.thread.phone)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold">
                      {thread.thread.display_name ?? "Unknown"}
                    </p>
                    <p className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                      <Phone className="h-3 w-3" /> {thread.thread.phone}
                    </p>
                  </div>
                </div>
                {thread.thread.tags && thread.thread.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {thread.thread.tags.map((t: string) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Profile
                </p>
                {thread.guest ? (
                  <dl className="mt-2 space-y-2 text-xs">
                    <Row icon={UserIcon} label="Name" value={thread.guest.full_name} />
                    {thread.guest.email && (
                      <Row icon={UserIcon} label="Email" value={thread.guest.email} />
                    )}
                    {thread.guest.country && (
                      <Row icon={UserIcon} label="Country" value={thread.guest.country} />
                    )}
                    {thread.guest.notes && (
                      <div className="rounded-md border border-border bg-card p-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Notes
                        </p>
                        <p className="mt-1 text-xs">{thread.guest.notes}</p>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No guest profile linked to this number yet.
                  </p>
                )}
              </div>

              <Separator />

              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Latest Booking
                </p>
                {thread.booking ? (
                  <div className="mt-2 rounded-md border border-border bg-card p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                        {formatDateID(thread.booking.check_in)} →{" "}
                        {formatDateID(thread.booking.check_out)}
                      </span>
                      <Badge variant="outline" className="text-[9px]">
                        {thread.booking.status}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {thread.booking.adults} adult{thread.booking.adults !== 1 && "s"}
                      {thread.booking.children > 0 && `, ${thread.booking.children} child`}
                    </p>
                    {thread.booking.special_requests && (
                      <p className="mt-2 border-t border-border pt-2 text-[11px] italic text-muted-foreground">
                        "{thread.booking.special_requests}"
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No booking on file.</p>
                )}
              </div>

              <Separator />

              <WhatsappSummary
                thread={thread.thread}
                onSaveSummary={(summary) => updateSummaryMut.mutate(summary)}
                savingSummary={updateSummaryMut.isPending}
                onToggleTraining={(v) => trainingMut.mutate(v)}
                togglingTraining={trainingMut.isPending}
              />
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
            Guest context will appear here.
          </div>
        )}
      </aside>
    </div>
  );
}

function WhatsappSummary({
  thread,
  onSaveSummary,
  savingSummary,
  onToggleTraining,
  togglingTraining,
}: {
  thread: Record<string, any>;
  onSaveSummary: (summary: string) => void;
  savingSummary: boolean;
  onToggleTraining: (v: boolean) => void;
  togglingTraining: boolean;
}) {
  const [summary, setSummary] = useState(thread.chat_summary || "");
  const isTraining = !!thread.is_training_example;

  useEffect(() => {
    setSummary(thread.chat_summary || "");
  }, [thread.chat_summary, thread.id]);

  const hasChanged = summary !== (thread.chat_summary || "");

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          WhatsApp Summary
        </p>
        <div className="mt-2 space-y-2">
          <Textarea
            placeholder="Belum ada ringkasan obrolan. Chatbot akan merangkum otomatis setelah obrolan idle 5 menit, atau Anda dapat menulis ringkasan manual di sini..."
            rows={5}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="resize-none text-xs leading-relaxed"
          />
          {hasChanged && (
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                disabled={savingSummary}
                onClick={() => onSaveSummary(summary)}
              >
                {savingSummary ? "Menyimpan..." : "Simpan Ringkasan"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Training toggle */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <GraduationCap className="h-3.5 w-3.5 text-primary" />
              Jadikan bahan training
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Bila aktif, percakapan ini dipakai sebagai contoh dasar jawaban AI.
            </p>
          </div>
          <button
            disabled={togglingTraining}
            onClick={() => onToggleTraining(!isTraining)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none",
              isTraining ? "bg-primary" : "bg-muted",
              togglingTraining && "opacity-50",
            )}
            role="switch"
            aria-checked={isTraining}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform",
                isTraining ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3 w-3 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-xs">{value}</p>
      </div>
    </div>
  );
}

function MessageBadges({ m }: { m: any }) {
  const meta = m.metadata as Record<string, unknown> | null | undefined;
  const isOut = m.direction === "out";

  if (!isOut) {
    const intent = meta?.intent_label as string | undefined;
    if (!intent) return null;
    return (
      <div className="mt-1 flex justify-start">
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
          {intent}
        </span>
      </div>
    );
  }

  const agent = meta?.agent as string | undefined;
  const isFallback = meta?.is_fallback as boolean | undefined;
  const tools = Array.isArray(meta?.tools_used) ? (meta.tools_used as string[]) : [];
  
  // If it's an outgoing message with no AI agent and it's not a fallback, it's sent manually
  const isHuman = !agent && !isFallback;

  if (isHuman) {
    return (
      <div className="mt-[3px] flex flex-wrap justify-end gap-1 relative z-10">
        <span className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-semibold text-amber-700 shadow-sm dark:bg-amber-950/50 dark:border-amber-900/40 dark:text-amber-400">
          👤 Human
        </span>
      </div>
    );
  }

  if (!agent && tools.length === 0) return null;

  return (
    <div className="mt-[3px] flex flex-wrap justify-end gap-1 relative z-10">
      {agent && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8.5px] font-medium text-amber-700 dark:text-amber-300">
          {agent}
        </span>
      )}
      {tools.map((t) => (
        <span
          key={t}
          className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[8.5px] font-medium text-sky-700 dark:text-sky-300"
        >
          Tools: {t}
        </span>
      ))}
    </div>
  );
}

type AttachmentInfo = { url: string; kind: "image" | "video" | "audio" | "file"; name: string; mime: string };

/**
 * Extract an attachment (image/video/audio/file) from a message's
 * metadata. Supports several common webhook field shapes so incoming
 * WhatsApp media is rendered regardless of the exact key used.
 */
function getAttachment(m: any): AttachmentInfo | null {
  const meta = (m.metadata ?? {}) as Record<string, any>;
  const media = (meta.media ?? meta.attachment ?? null) as Record<string, any> | null;
  const url =
    meta.media_url ?? meta.mediaUrl ?? meta.attachment_url ?? meta.file_url ??
    meta.fileUrl ?? meta.url ?? media?.url ?? media?.link ?? null;
  if (!url || typeof url !== "string") return null;

  const mime = String(
    meta.mime_type ?? meta.mimetype ?? meta.media_type ?? meta.content_type ??
    media?.mime_type ?? media?.type ?? "",
  ).toLowerCase();
  const name =
    String(meta.file_name ?? meta.filename ?? meta.media_name ?? media?.file_name ?? media?.filename ?? "") ||
    (url.split("?")[0].split("/").pop() ?? "file");
  const ext = (url.split("?")[0].split(".").pop() ?? "").toLowerCase();

  const isImg = mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "bmp", "svg"].includes(ext);
  const isVid = mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext);
  const isAud = mime.startsWith("audio/") || ["mp3", "ogg", "opus", "wav", "m4a", "aac"].includes(ext);
  const kind: AttachmentInfo["kind"] = isImg ? "image" : isVid ? "video" : isAud ? "audio" : "file";
  return { url, kind, name, mime };
}

/** Render an attachment inside a message bubble (image/video/audio/file card). */
function MessageAttachment({ m }: { m: any }) {
  const a = getAttachment(m);
  if (!a) return null;

  if (a.kind === "image") {
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        <img src={a.url} alt={a.name} className="max-h-64 w-full max-w-[280px] rounded-md object-cover" />
      </a>
    );
  }
  if (a.kind === "video") {
    return <video src={a.url} controls className="mb-1 max-h-64 w-full max-w-[280px] rounded-md" />;
  }
  if (a.kind === "audio") {
    return <audio src={a.url} controls className="mb-1 w-[240px]" />;
  }
  // Generic file (PDF, doc, etc.) — card with icon + name + download.
  const label = a.mime.includes("pdf") || a.name.toLowerCase().endsWith(".pdf") ? "PDF" : (a.mime || "Berkas");
  return (
    <a href={a.url} target="_blank" rel="noopener noreferrer"
      className="mb-1 flex items-center gap-2.5 rounded-md bg-black/[0.06] px-2.5 py-2 transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-red-500 text-white">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-[11px] uppercase opacity-60">{label}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-60" />
    </a>
  );
}

function MessageStream({ messages }: { messages: any[] }) {
  const groups: { label: string; items: any[] }[] = [];
  let last = "";
  for (const m of messages) {
    const lbl = dateLabel(m.sent_at);
    if (lbl !== last) {
      groups.push({ label: lbl, items: [] });
      last = lbl;
    }
    groups[groups.length - 1].items.push(m);
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="my-3 flex items-center justify-center relative z-10">
            <span className="rounded-md bg-[#ffffff]/90 dark:bg-[#182229]/90 px-3 py-1 font-sans text-[11px] font-medium text-[#54656f] dark:text-[#8696a0] shadow-sm">
              {g.label}
            </span>
          </div>
          <div className="space-y-1.5 relative z-10">
            {g.items.map((m) => (
              <div
                key={m.id}
                className={cn("flex flex-col group", m.direction === "out" ? "items-end pl-12" : "items-start pr-12")}
              >
                <div
                  className={cn(
                    "relative whitespace-pre-wrap rounded-lg px-2.5 pb-1.5 pt-1.5 text-[14.2px] shadow-sm flex flex-col",
                    m.direction === "out"
                      ? "rounded-tr-none bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]"
                      : "rounded-tl-none bg-[#ffffff] text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]",
                  )}
                  style={{ maxWidth: '85%' }}
                >
                  {/* Tail for bubbles */}
                  <div className={cn(
                    "absolute top-0 w-2 h-3",
                    m.direction === "out"
                      ? "-right-2 bg-[#d9fdd3] dark:bg-[#005c4b] rounded-bl-full"
                      : "-left-2 bg-[#ffffff] dark:bg-[#202c33] rounded-br-full"
                  )} style={{ clipPath: m.direction === "out" ? 'polygon(0 0, 100% 0, 0 100%)' : 'polygon(0 0, 100% 0, 100% 100%)' }} />

                  <MessageAttachment m={m} />
                  {m.body && <span className="leading-[19px]">{m.body}</span>}
                  <div
                    className={cn(
                      "mt-[2px] self-end font-sans text-[10px] flex items-center gap-1",
                      m.direction === "out"
                        ? "text-[#667781] dark:text-[#8596a0]"
                        : "text-[#667781] dark:text-[#8596a0]",
                    )}
                  >
                    {formatTimeID(m.sent_at)}
                  </div>
                </div>
                <MessageBadges m={m} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
