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
  CheckCheck,
  Tag,
  User as UserIcon,
  CalendarDays,
  Phone,
  Wand2,
  MessagesSquare,
  Inbox,
  Plus,
} from "lucide-react";
import {
  listThreads,
  getThread,
  sendMessage,
  draftAiReply,
  markRead,
  togglePinned,
  setStatus,
  simulateInbound,
  summarizeThread,
  classifyIntent,
} from "@/lib/whatsapp.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { supabase } from "@/integrations/supabase/client";
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

export const Route = createFileRoute("/_admin/whatsapp")({
  component: WhatsAppPage,
});

const INTENT_STYLES: Record<string, { label: string; className: string }> = {
  booking_inquiry: { label: "Booking", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  service_request: { label: "Service", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  complaint: { label: "Complaint", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  recommendation: { label: "Recco", className: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  feedback: { label: "Feedback", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  other: { label: "Other", className: "bg-muted text-muted-foreground border-border" },
};

const TEMPLATES = [
  { label: "Welcome", body: "Welcome to Pomah Guesthouse! Let us know if you need anything during your stay." },
  { label: "Late check-out", body: "We can arrange a late check-out until 2 PM at no extra charge. Would that work?" },
  { label: "Check availability", body: "Let me check availability for those dates and get back to you within a few minutes." },
  { label: "Rate quote", body: "Our nightly rate for that room category starts at IDR 750.000, breakfast included. Want me to hold a room?" },
  { label: "Maintenance ack", body: "Sorry about that — I'm sending someone up right away to take a look. Apologies for the inconvenience." },
  { label: "Thank you", body: "Thank you so much for staying with us. We hope to welcome you back soon!" },
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

function WhatsAppPage() {
  const listFn = useServerFn(listThreads);
  const getFn = useServerFn(getThread);
  const sendFn = useServerFn(sendMessage);
  const draftFn = useServerFn(draftAiReply);
  const markReadFn = useServerFn(markRead);
  const pinFn = useServerFn(togglePinned);
  const statusFn = useServerFn(setStatus);
  const simulateFn = useServerFn(simulateInbound);
  const summarizeFn = useServerFn(summarizeThread);
  const classifyFn = useServerFn(classifyIntent);
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
  const [summary, setSummary] = useState<string | null>(null);

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
    setSummary(null);
  }, [current, threads, markReadFn, qc]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase
      .channel("wa-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_threads" }, () => {
        qc.invalidateQueries({ queryKey: ["wa-threads"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_messages" }, () => {
        qc.invalidateQueries({ queryKey: ["wa-thread", current] });
        qc.invalidateQueries({ queryKey: ["wa-threads"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, current]);

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

  const summarizeMut = useMutation({
    mutationFn: () => summarizeFn({ data: { threadId: current! } }),
    onSuccess: (res) => setSummary(res.summary),
    onError: (e) => toast.error((e as Error).message),
  });

  const classifyMut = useMutation({
    mutationFn: () => classifyFn({ data: { threadId: current! } }),
    onSuccess: (res) => {
      toast.success(`Tagged as ${INTENT_STYLES[res.intent]?.label ?? res.intent}`);
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pinMut = useMutation({
    mutationFn: (p: { id: string; pinned: boolean }) =>
      pinFn({ data: { threadId: p.id, pinned: p.pinned } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-threads"] }),
  });

  const statusMut = useMutation({
    mutationFn: (s: "open" | "closed") => statusFn({ data: { threadId: current!, status: s } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-threads"] }),
  });

  const simulateMut = useMutation({
    mutationFn: (body: string) => simulateFn({ data: { threadId: current!, body } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-thread", current] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
    },
  });

  const totalUnread = threads.reduce((s, t) => s + (t.unread_count ?? 0), 0);

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[300px_1fr_320px] bg-background">
      {/* THREADS LIST */}
      <aside className="flex min-h-0 flex-col border-r border-border bg-sidebar">
        <div className="border-b border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Inbox</p>
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
                          <Badge variant="outline" className={cn("h-4 px-1.5 text-[9px] font-medium", intent.className)}>
                            {intent.label}
                          </Badge>
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
                      INTENT_STYLES[thread.thread.intent]?.className ?? INTENT_STYLES.other.className,
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
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const t = thread.thread;
                    if (!t) return;
                    statusMut.mutate(t.status === "open" ? "closed" : "open");
                  }}
                >
                  <CheckCheck className="mr-1.5 h-4 w-4" />
                  {thread.thread.status === "open" ? "Close" : "Reopen"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Simulate
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                      Simulate inbound message
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {[
                      "Hi, do you have rooms tonight?",
                      "What time is breakfast?",
                      "The wifi is not working",
                      "Can we extend our stay by one night?",
                    ].map((s) => (
                      <DropdownMenuItem key={s} onClick={() => simulateMut.mutate(s)}>
                        <span className="truncate text-xs">{s}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-muted/20 px-6 py-4">
              <MessageStream messages={thread.messages} />
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
                  {classifyMut.isPending ? "Tagging…" : "Auto-tag"}
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
                <p className="font-mono text-[10px] text-muted-foreground">
                  {draft.length} chars
                </p>
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
                    {thread.guest.email && <Row icon={UserIcon} label="Email" value={thread.guest.email} />}
                    {thread.guest.country && (
                      <Row icon={UserIcon} label="Country" value={thread.guest.country} />
                    )}
                    {thread.guest.notes && (
                      <div className="rounded-md border border-border bg-card p-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</p>
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

              <div>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    AI Summary
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    disabled={summarizeMut.isPending}
                    onClick={() => summarizeMut.mutate()}
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    {summarizeMut.isPending ? "..." : "Generate"}
                  </Button>
                </div>
                {summary ? (
                  <div className="mt-2 whitespace-pre-line rounded-md border border-border bg-card p-3 text-xs leading-relaxed">
                    {summary}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Get a 3-bullet brief of what the guest needs and the next staff action.
                  </p>
                )}
              </div>
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

function MessageStream({ messages }: { messages: any[] }) {
  // Group by date
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
          <div className="my-3 flex items-center justify-center">
            <span className="rounded-full bg-card px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground shadow-sm">
              {g.label}
            </span>
          </div>
          <div className="space-y-2">
            {g.items.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex",
                  m.direction === "out" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-md whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                    m.direction === "out"
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-card text-foreground",
                  )}
                >
                  {m.body}
                  <p
                    className={cn(
                      "mt-1 text-right font-mono text-[10px]",
                      m.direction === "out"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatTimeID(m.sent_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
