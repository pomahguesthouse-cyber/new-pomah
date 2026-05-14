import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Send } from "lucide-react";
import { listThreads, getThread, sendMessage, draftAiReply } from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/whatsapp")({
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const listFn = useServerFn(listThreads);
  const getFn = useServerFn(getThread);
  const sendFn = useServerFn(sendMessage);
  const draftFn = useServerFn(draftAiReply);
  const qc = useQueryClient();

  const { data: threadsData } = useQuery({ queryKey: ["wa-threads"], queryFn: () => listFn() });
  const threads = threadsData?.threads ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const current = activeId ?? threads[0]?.id ?? null;

  const { data: thread } = useQuery({
    queryKey: ["wa-thread", current],
    queryFn: () => getFn({ data: { id: current! } }),
    enabled: !!current,
  });

  const [draft, setDraft] = useState("");

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

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[280px_1fr]">
      <aside className="overflow-y-auto border-r border-border bg-sidebar">
        <div className="border-b border-border p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Inbox</p>
        </div>
        <ul>
          {threads.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setActiveId(t.id)}
                className={`block w-full border-b border-border px-4 py-3 text-left hover:bg-accent/10 ${current === t.id ? "bg-accent/10" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <p className="truncate text-sm font-medium">{t.display_name ?? t.phone}</p>
                  {t.unread_count > 0 && <Badge>{t.unread_count}</Badge>}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{t.last_message_preview}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-col">
        {current && thread?.thread ? (
          <>
            <header className="border-b border-border p-4">
              <p className="font-semibold">{thread.thread.display_name ?? thread.thread.phone}</p>
              <p className="font-mono text-xs text-muted-foreground">{thread.thread.phone}</p>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {thread.messages.map((m) => (
                <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-md rounded-2xl px-4 py-2 text-sm ${m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                    {m.body}
                    <p className={`mt-1 font-mono text-[10px] ${m.direction === "out" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {new Date(m.sent_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="border-t border-border p-4">
              <Textarea
                placeholder="Type a reply…"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="mt-3 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={draftMut.isPending}
                  onClick={() => draftMut.mutate()}
                >
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {draftMut.isPending ? "Drafting…" : "AI draft"}
                </Button>
                <Button size="sm" disabled={!draft.trim() || sendMut.isPending} onClick={() => sendMut.mutate()}>
                  <Send className="mr-2 h-3.5 w-3.5" /> Send
                </Button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a thread
          </div>
        )}
      </section>
    </div>
  );
}
