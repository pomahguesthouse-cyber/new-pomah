/**
 * AI LAB → Percakapan Webchat.
 *
 * A read-only log of conversations from the public AI webchat widget,
 * grouped per session (thread). Each thread shows the guest messages and
 * the assistant replies in order.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Loader2 } from "lucide-react";
import { listWebchatLogs } from "@/admin/modules/training/training.functions";
import { cn } from "@/lib/utils";

type LogRow = {
  id: string;
  thread_id: string | null;
  user_message: string | null;
  ai_response: string | null;
  created_at: string;
};

type Thread = { id: string; rows: LogRow[]; last: string };

/** Group flat log rows into threads, newest thread first. */
function groupThreads(rows: LogRow[]): Thread[] {
  const map = new Map<string, LogRow[]>();
  for (const r of rows) {
    const key = r.thread_id ?? r.id;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  const threads: Thread[] = [...map.entries()].map(([id, list]) => ({
    id,
    rows: list,
    last: list[list.length - 1]?.created_at ?? "",
  }));
  threads.sort((a, b) => b.last.localeCompare(a.last));
  return threads;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function WebchatLogView() {
  const fn = useServerFn(listWebchatLogs);
  const { data, isLoading } = useQuery({
    queryKey: ["webchat-logs"],
    queryFn: () => fn(),
  });

  const threads = useMemo(() => groupThreads((data?.logs ?? []) as LogRow[]), [data]);
  const [active, setActive] = useState<string | null>(null);
  const current = threads.find((t) => t.id === active) ?? threads[0] ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Memuat percakapan…
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
        <MessageSquare className="h-8 w-8" />
        <p className="text-sm">Belum ada percakapan webchat yang tercatat.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Thread list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r border-border bg-white">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Percakapan Webchat</p>
          <p className="text-xs text-muted-foreground">{threads.length} sesi tercatat</p>
        </div>
        {threads.map((t) => {
          const first = t.rows[0]?.user_message?.trim() || "(tanpa pesan)";
          const isActive = (current?.id ?? null) === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition",
                isActive ? "bg-teal-50" : "hover:bg-muted",
              )}
            >
              <span className="line-clamp-1 text-sm font-medium">{first}</span>
              <span className="text-[11px] text-muted-foreground">
                {fmt(t.last)} · {t.rows.length} pesan
              </span>
            </button>
          );
        })}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto bg-stone-50">
        {current && (
          <div className="mx-auto max-w-2xl space-y-4 px-6 py-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Transkrip · {fmt(current.rows[0]?.created_at ?? current.last)}
            </p>
            {current.rows.map((r) => (
              <div key={r.id} className="space-y-2">
                {r.user_message ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-line rounded-2xl bg-teal-600 px-3 py-2 text-sm text-white">
                      {r.user_message}
                    </div>
                  </div>
                ) : null}
                {r.ai_response ? (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] whitespace-pre-line rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                      {r.ai_response}
                    </div>
                  </div>
                ) : null}
                <p className="text-center text-[10px] text-muted-foreground">{fmt(r.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
