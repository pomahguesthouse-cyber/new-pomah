/**
 * AI LAB → Percakapan Webchat.
 *
 * A read-only log of conversations from the public AI webchat widget,
 * grouped per session (thread). A right-hand panel analyses the selected
 * conversation — intent, agent escalation path, tools called, a
 * confidence score — and lets staff flag it as training material.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare,
  Loader2,
  Target,
  Bot,
  Wrench,
  Gauge,
  GraduationCap,
  ArrowDown,
} from "lucide-react";
import { listWebchatLogs, setWebchatTraining } from "@/admin/modules/training/training.functions";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type LogRow = {
  id: string;
  thread_id: string | null;
  user_message: string | null;
  ai_response: string | null;
  used: boolean | null;
  created_at: string;
};

type Thread = { id: string; threadId: string | null; rows: LogRow[]; last: string };

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
    threadId: list[0]?.thread_id ?? null,
    rows: list,
    last: list[list.length - 1]?.created_at ?? "",
  }));
  threads.sort((a, b) => b.last.localeCompare(a.last));
  return threads;
}

/* ------------------------------------------------------------------ */
/* Conversation analysis (heuristic)                                   */
/* ------------------------------------------------------------------ */

type Analysis = {
  intent: string;
  agent: string;
  tools: string[];
  confidence: number;
  escalation: string[];
};

const AGENT_BY_INTENT: Record<string, string> = {
  "Pemesanan kamar": "Front Office Agent",
  "Cek ketersediaan": "Front Office Agent",
  "Tanya harga": "Pricing Agent",
  "Tanya fasilitas": "Housekeeping Agent",
  "Tanya lokasi": "Front Office Agent",
  Pembayaran: "Finance Agent",
  "Pertanyaan umum": "Front Office Agent",
};

/** Derive intent / agent / tools / confidence from a conversation. */
function analyzeThread(rows: LogRow[]): Analysis {
  const userText = rows
    .map((r) => r.user_message ?? "")
    .join(" ")
    .toLowerCase();
  const aiText = rows
    .map((r) => r.ai_response ?? "")
    .join(" ")
    .toLowerCase();

  let intent = "Pertanyaan umum";
  if (/\b(pesan|booking|book|reservasi|memesan)\b/.test(userText)) intent = "Pemesanan kamar";
  else if (/(tersedia|kosong|ready|ketersediaan|ada kamar)/.test(userText))
    intent = "Cek ketersediaan";
  else if (/(harga|tarif|biaya|price|berapa)/.test(userText)) intent = "Tanya harga";
  else if (/(fasilitas|wifi|sarapan|parkir)/.test(userText)) intent = "Tanya fasilitas";
  else if (/(lokasi|alamat|dimana|peta|arah)/.test(userText)) intent = "Tanya lokasi";
  else if (/(bayar|pembayaran|transfer|rekening)/.test(userText)) intent = "Pembayaran";

  const tools: string[] = [];
  if (/ketersediaan kamar untuk|kamar tersedia/.test(aiText)) tools.push("Room Availability");
  if (/kode booking|pmh-|booking.*berhasil/.test(aiText)) tools.push("PMS Database");
  if (/rp\s?\d/.test(aiText)) tools.push("Pricing Engine");

  const agent = AGENT_BY_INTENT[intent] ?? "Front Office Agent";

  let confidence = 0.55;
  if (intent !== "Pertanyaan umum") confidence += 0.2;
  if (tools.length) confidence += 0.15;
  if (rows.some((r) => (r.ai_response?.length ?? 0) > 40)) confidence += 0.05;
  confidence = Math.min(0.97, confidence);

  const escalation = [
    "AI Orchestrator",
    agent,
    ...(tools.length ? tools : ["Tanpa tool"]),
    "Response Composer",
  ];
  return { intent, agent, tools, confidence, escalation };
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/* ================================================================== */

export function WebchatLogView() {
  const qc = useQueryClient();
  const fn = useServerFn(listWebchatLogs);
  const trainFn = useServerFn(setWebchatTraining);
  const { data, isLoading } = useQuery({
    queryKey: ["webchat-logs"],
    queryFn: () => fn(),
  });

  const threads = useMemo(() => groupThreads((data?.logs ?? []) as LogRow[]), [data]);
  const [active, setActive] = useState<string | null>(null);
  const current = threads.find((t) => t.id === active) ?? threads[0] ?? null;
  const analysis = useMemo(() => (current ? analyzeThread(current.rows) : null), [current]);

  const isTraining = !!current && current.rows.some((r) => r.used);
  const [saving, setSaving] = useState(false);

  const toggleTraining = async (value: boolean) => {
    if (!current?.threadId) {
      toast.error("Percakapan ini tidak punya ID sesi");
      return;
    }
    setSaving(true);
    try {
      await trainFn({ data: { threadId: current.threadId, used: value } });
      toast.success(value ? "Ditandai sebagai bahan training" : "Dihapus dari bahan training");
      qc.invalidateQueries({ queryKey: ["webchat-logs"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border bg-white">
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
                {t.rows.some((r) => r.used) ? " · ★ training" : ""}
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

      {/* Properties sidebar */}
      {current && analysis && (
        <aside className="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-border bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Properti Percakapan
          </p>

          <PropBlock icon={<Target className="h-4 w-4" />} label="Intent">
            <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">
              {analysis.intent}
            </span>
          </PropBlock>

          <PropBlock icon={<Bot className="h-4 w-4" />} label="Agent yang bekerja">
            <span className="text-sm font-medium">{analysis.agent}</span>
          </PropBlock>

          <PropBlock icon={<ArrowDown className="h-4 w-4" />} label="Jalur eskalasi">
            <div className="space-y-1">
              {analysis.escalation.map((step, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[9px] font-bold text-stone-600">
                    {i + 1}
                  </span>
                  <span className="text-xs text-stone-700">{step}</span>
                </div>
              ))}
            </div>
          </PropBlock>

          <PropBlock icon={<Wrench className="h-4 w-4" />} label="Tool yang dipanggil">
            {analysis.tools.length ? (
              <div className="flex flex-wrap gap-1">
                {analysis.tools.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Tidak ada tool dipanggil</span>
            )}
          </PropBlock>

          <PropBlock icon={<Gauge className="h-4 w-4" />} label="Confidence">
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200">
                <div
                  className={cn(
                    "h-full rounded-full",
                    analysis.confidence >= 0.8
                      ? "bg-emerald-500"
                      : analysis.confidence >= 0.65
                        ? "bg-amber-500"
                        : "bg-rose-500",
                  )}
                  style={{ width: `${Math.round(analysis.confidence * 100)}%` }}
                />
              </div>
              <span className="text-sm font-bold">{Math.round(analysis.confidence * 100)}%</span>
            </div>
          </PropBlock>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <GraduationCap className="h-4 w-4 text-teal-600" />
                Jadikan bahan training
              </p>
              <Switch checked={isTraining} disabled={saving} onCheckedChange={toggleTraining} />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Bila aktif, percakapan ini dipakai sebagai contoh dasar jawaban AI.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

function PropBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="text-teal-600">{icon}</span>
        {label}
      </p>
      {children}
    </div>
  );
}
