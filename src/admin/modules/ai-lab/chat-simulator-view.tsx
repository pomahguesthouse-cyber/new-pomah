/**
 * Chatbot Simulator — AI Lab view.
 *
 * Interactive mode: type messages, see the bot reply through the real
 * orchestration pipeline (classifier → agent → tools → state machine).
 *
 * End-to-end: runs against a sandbox test phone and writes real data
 * (booking state, and create_booking creates real records). Use a test number.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot,
  Send,
  RotateCcw,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  Wrench,
  Activity,
  Pencil,
  Check,
  X,
  GraduationCap,
  MessagesSquare,
  Search,
  Trash2,
  BookOpen,
} from "lucide-react";
import {
  simulateChatTurn,
  resetSimulation,
  saveSimulationAsTraining,
  listSimulatorTraining,
  deleteSimulatorTraining,
} from "./simulator.functions";
import { listThreads, getThread } from "@/admin/functions/whatsapp.functions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type Direction = "in" | "out";
interface TranscriptMsg {
  direction: Direction;
  body: string;
}
interface TurnMeta {
  agentKey?: string;
  intent?: string;
  toolsUsed?: string[];
  bookingState?: string;
  elapsedMs?: number;
  status?: string;
  error?: string | null;
  trainingExamplesUsed?: number;
}



// ─── Component ──────────────────────────────────────────────────────────────────

export function ChatSimulatorView() {
  const runTurn = useServerFn(simulateChatTurn);
  const runReset = useServerFn(resetSimulation);
  const runSaveTraining = useServerFn(saveSimulationAsTraining);
  const runListThreads = useServerFn(listThreads);
  const runGetThread = useServerFn(getThread);
  const runListTraining = useServerFn(listSimulatorTraining);
  const runDeleteTraining = useServerFn(deleteSimulatorTraining);
  const qc = useQueryClient();

  const [phone, setPhone] = useState("6281234567899");
  const [transcript, setTranscript] = useState<TranscriptMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastMeta, setLastMeta] = useState<TurnMeta | null>(null);

  // Scenario runner state
  const [activeScenario, setActiveScenario] = useState<string>(SCENARIOS[0].key);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[]>([]);

  // Response modification states
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editedIndices, setEditedIndices] = useState<Record<number, string>>({}); // index -> original text

  // Save training states
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [savingTraining, setSavingTraining] = useState(false);

  // Import WhatsApp conversation states
  const [importOpen, setImportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [importingId, setImportingId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  async function sendOne(message: string, history: TranscriptMsg[]) {
    const res: any = await runTurn({ data: { phone, message, transcript: history, origin } });
    if (!res?.ok) {
      throw new Error(res?.error || "Gagal menjalankan simulasi");
    }
    const meta: TurnMeta = {
      agentKey: res.agentKey,
      intent: res.intent,
      toolsUsed: res.toolsUsed,
      bookingState: res.bookingState,
      elapsedMs: res.elapsedMs,
      status: res.status,
      error: res.error,
      trainingExamplesUsed: res.trainingExamplesUsed,
    };
    return { reply: res.reply as string | null, meta };
  }

  // ── Interactive send ──────────────────────────────────────────────────────────
  async function handleSend() {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    const history = transcript;
    const withUser = [...history, { direction: "in" as const, body: message }];
    setTranscript(withUser);
    scrollToBottom();
    setSending(true);
    try {
      const { reply, meta } = await sendOne(message, history);
      setLastMeta(meta);
      if (reply) {
        setTranscript([...withUser, { direction: "out", body: reply }]);
      } else {
        setTranscript([
          ...withUser,
          { direction: "out", body: `⚠️ (tidak ada balasan — ${meta.error ?? meta.status})` },
        ]);
      }
      scrollToBottom();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
      setTranscript(history); // roll back the optimistic user bubble
    } finally {
      setSending(false);
    }
  }

  async function handleReset() {
    try {
      await runReset({ data: { phone } });
      setTranscript([]);
      setLastMeta(null);
      setResults([]);
      setEditedIndices({});
      setEditingIdx(null);
      toast.success("Percakapan & state booking direset");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal reset");
    }
  }

  // ── Save simulation as training ───────────────────────────────────────────
  async function handleSaveTraining(pairs: any[]) {
    if (savingTraining || pairs.length === 0) return;
    setSavingTraining(true);
    try {
      const res = await runSaveTraining({ data: { pairs } });
      if (res.ok) {
        toast.success(`Berhasil menyimpan ${res.savedCount} pasangan percakapan ke training data.`);
        setSaveConfirmOpen(false);
        qc.invalidateQueries({ queryKey: ["simulator-training"] });
      } else {
        toast.error("Gagal menyimpan training data");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Error saat menyimpan training");
    } finally {
      setSavingTraining(false);
    }
  }

  // ── Saved training list ───────────────────────────────────────────────────
  const trainingQuery = useQuery({
    queryKey: ["simulator-training"],
    queryFn: () => runListTraining(),
  });
  const savedTraining: any[] = trainingQuery.data?.logs ?? [];

  async function handleDeleteTraining(id: string) {
    try {
      await runDeleteTraining({ data: { id } });
      qc.invalidateQueries({ queryKey: ["simulator-training"] });
      toast.success("Training data dihapus");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal menghapus");
    }
  }

  // ── Import WhatsApp conversation ──────────────────────────────────────────
  const threadsQuery = useQuery({
    queryKey: ["wa-threads"],
    queryFn: () => runListThreads(),
    enabled: importOpen,
  });

  const filteredThreads = useMemo(() => {
    const threads: any[] = threadsQuery.data?.threads ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const name = (t.display_name ?? "").toLowerCase();
      const phoneNum = (t.phone ?? "").toLowerCase();
      return name.includes(q) || phoneNum.includes(q);
    });
  }, [threadsQuery.data, searchQuery]);

  async function handleImportThread(thread: any) {
    if (importingId) return;
    setImportingId(thread.id);
    try {
      const res: any = await runGetThread({ data: { id: thread.id } });
      const messages: any[] = res?.messages ?? [];
      const imported: TranscriptMsg[] = messages
        .filter((m) => m.body)
        .map((m) => ({
          direction: m.direction === "in" ? "in" : "out",
          body: m.body as string,
        }));
      setTranscript(imported);
      setPhone(thread.phone ?? phone);
      setLastMeta(null);
      setResults([]);
      setEditedIndices({});
      setEditingIdx(null);
      setImportOpen(false);
      setSearchQuery("");
      scrollToBottom();
      toast.success(
        `Mengimpor ${imported.length} pesan dari ${thread.display_name || thread.phone}`,
      );
    } catch (e: any) {
      toast.error(e.message ?? "Gagal mengimpor percakapan");
    } finally {
      setImportingId(null);
    }
  }

  // ── Scenario runner ─────────────────────────────────────────────────────────
  async function handleRunScenario() {
    if (running) return;
    const scenario = SCENARIOS.find((s) => s.key === activeScenario);
    if (!scenario) return;
    setRunning(true);
    setResults([]);
    setTranscript([]);
    setLastMeta(null);
    try {
      // Fresh start
      await runReset({ data: { phone } });
      let history: TranscriptMsg[] = [];
      const stepResults: StepResult[] = [];
      for (const step of scenario.steps) {
        const withUser = [...history, { direction: "in" as const, body: step.send }];
        setTranscript(withUser);
        scrollToBottom();
        const { reply, meta } = await sendOne(step.send, history);
        const next = reply ? [...withUser, { direction: "out" as const, body: reply }] : withUser;
        setTranscript(next);
        setLastMeta(meta);
        history = next;
        const checks = evaluateChecks(step, reply, meta);
        const passed = checks.every((c) => c.ok);
        stepResults.push({ step, reply, meta, passed, checks });
        setResults([...stepResults]);
        scrollToBottom();
      }
      const allPass = stepResults.every((r) => r.passed);
      if (allPass) toast.success(`Skenario "${scenario.name}" lulus`);
      else toast.warning(`Skenario "${scenario.name}" ada langkah gagal`);
    } catch (e: any) {
      toast.error(e.message ?? "Skenario gagal dijalankan");
    } finally {
      setRunning(false);
    }
  }

  const busy = sending || running;
  const passCount = results.filter((r) => r.passed).length;

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
      {/* ── Left: chat ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
        <Card className="flex items-center gap-3 p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-100 text-teal-700">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">Simulator Chatbot</p>
            <p className="text-xs text-muted-foreground">
              Pipeline asli — menulis data nyata. Pakai nomor uji.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="sim-phone" className="text-xs text-muted-foreground">
              Nomor uji
            </Label>
            <Input
              id="sim-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-8 w-40 font-mono text-xs"
              placeholder="628xxxxxxxxxx"
            />
            {transcript.length > 0 && (
              <Button
                variant="default"
                size="sm"
                className="bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-sm transition-colors"
                onClick={() => setSaveConfirmOpen(true)}
                disabled={busy}
              >
                <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
                Simpan Training
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              disabled={busy}
            >
              <MessagesSquare className="mr-1 h-3.5 w-3.5" />
              Impor Chat WA
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={busy}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </Card>

        {/* Transcript */}
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-stone-50 p-4">
            {transcript.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                Mulai mengetik atau jalankan skenario otomatis di kanan.
              </div>
            ) : (
              transcript.map((m, i) => {
                const isEdited = editedIndices[i] !== undefined;
                const isEditing = editingIdx === i;

                return (
                  <div
                    key={i}
                    className={cn("flex", m.direction === "in" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "relative max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm group transition-all duration-200",
                        m.direction === "in"
                          ? "rounded-br-sm bg-emerald-600 text-white"
                          : cn(
                              "rounded-bl-sm bg-white text-stone-800 border border-transparent",
                              isEdited && "border-l-4 border-l-teal-500 bg-teal-50/40"
                            ),
                        !isEditing && m.direction === "out" && "pr-8"
                      )}
                    >
                      {isEditing ? (
                        <div className="space-y-2 min-w-[200px] sm:min-w-[300px]">
                          <Textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="text-xs p-2 min-h-[85px] bg-white text-stone-800 border border-stone-300 focus-visible:ring-teal-500"
                            placeholder="Tulis respon chatbot yang seharusnya..."
                            autoFocus
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs rounded-md"
                              onClick={() => setEditingIdx(null)}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Batal
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs bg-teal-700 hover:bg-teal-800 text-white rounded-md"
                              onClick={() => {
                                const trimmed = editingText.trim();
                                if (!trimmed) {
                                  toast.error("Respon tidak boleh kosong");
                                  return;
                                }
                                if (editedIndices[i] === undefined) {
                                  setEditedIndices((prev) => ({ ...prev, [i]: m.body }));
                                }
                                const updated = [...transcript];
                                updated[i] = { ...m, body: trimmed };
                                setTranscript(updated);
                                setEditingIdx(null);
                                toast.success("Respon chatbot berhasil dikoreksi");
                              }}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Simpan
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          {m.direction === "out" && !isEditing && (
                            <button
                              onClick={() => {
                                setEditingIdx(i);
                                setEditingText(m.body);
                              }}
                              className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-stone-100 rounded text-stone-400 hover:text-stone-700 transition cursor-pointer"
                              title="Koreksi respon chatbot"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {isEdited && (
                            <span className="mt-1 flex items-center justify-end gap-1 text-[9px] font-semibold text-teal-600 uppercase tracking-wider">
                              <Pencil className="h-2 w-2" /> Diedit
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> mengetik…
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="flex items-center gap-2 border-t border-border bg-card p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ketik pesan sebagai tamu…"
              disabled={busy}
            />
            <Button onClick={handleSend} disabled={busy || !input.trim()}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Right: meta + scenario runner ──────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {/* Last turn meta */}
        <Card className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Detail giliran terakhir
          </p>
          {lastMeta ? (
            <div className="space-y-1.5 text-sm">
              <MetaRow label="Agent" value={lastMeta.agentKey} />
              <MetaRow label="Intent" value={lastMeta.intent} />
              <MetaRow label="State booking" value={lastMeta.bookingState} mono />
              <MetaRow
                label="Tools"
                value={lastMeta.toolsUsed?.length ? lastMeta.toolsUsed.join(", ") : "—"}
              />
              <MetaRow
                label="Waktu"
                value={lastMeta.elapsedMs != null ? `${lastMeta.elapsedMs} ms` : undefined}
              />
              <MetaRow
                label="Training dipakai"
                value={
                  lastMeta.trainingExamplesUsed != null
                    ? `${lastMeta.trainingExamplesUsed} contoh`
                    : "—"
                }
              />
              {lastMeta.error && <p className="text-xs text-red-600">Error: {lastMeta.error}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada giliran.</p>
          )}
        </Card>

        {/* Scenario runner */}
        <Card className="flex min-h-0 flex-1 flex-col p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Play className="h-3.5 w-3.5" /> Runner skenario otomatis
          </p>

          <div className="space-y-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveScenario(s.key)}
                disabled={busy}
                className={cn(
                  "w-full rounded-lg border p-2.5 text-left transition",
                  activeScenario === s.key
                    ? "border-teal-500 bg-teal-50"
                    : "border-border hover:bg-muted",
                )}
              >
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {s.steps.length} langkah
                </p>
              </button>
            ))}
          </div>

          <Button className="mt-3" onClick={handleRunScenario} disabled={busy}>
            {running ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Menjalankan…
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-4 w-4" /> Jalankan skenario
              </>
            )}
          </Button>

          {/* Results */}
          {results.length > 0 && (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              <p className="mb-2 text-xs font-semibold">
                Hasil: {passCount}/{results.length} langkah lulus
              </p>
              <ol className="space-y-2">
                {results.map((r, i) => (
                  <li key={i} className="rounded-lg border border-border p-2 text-xs">
                    <div className="flex items-start gap-1.5">
                      {r.checks.length === 0 ? (
                        <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
                      ) : r.passed ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1 font-medium">
                          <User className="h-3 w-3" /> {r.step.send}
                        </p>
                        {r.checks.map((c, j) => (
                          <p
                            key={j}
                            className={cn(
                              "flex items-center gap-1",
                              c.ok ? "text-emerald-700" : "text-red-700",
                            )}
                          >
                            {c.ok ? "✓" : "✗"} {c.label}
                          </p>
                        ))}
                        {r.meta.toolsUsed && r.meta.toolsUsed.length > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                            <Wrench className="h-3 w-3" /> {r.meta.toolsUsed.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>

        {/* Saved training list */}
        <Card className="flex min-h-0 flex-col p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" /> Training tersimpan
            </p>
            {savedTraining.length > 0 && (
              <span className="text-[10px] font-medium text-muted-foreground">
                {savedTraining.length} item
              </span>
            )}
          </div>

          {trainingQuery.isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
            </div>
          ) : savedTraining.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Belum ada training tersimpan dari simulator.
            </p>
          ) : (
            <ScrollArea className="max-h-[320px]">
              <ul className="space-y-2 pr-2">
                {savedTraining.map((log) => (
                  <li
                    key={log.id}
                    className="group rounded-lg border border-border p-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="flex items-center gap-1 font-medium text-stone-700">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{log.user_message}</span>
                        </p>
                        <p className="flex items-start gap-1 text-stone-600">
                          <Bot className="mt-0.5 h-3 w-3 shrink-0 text-teal-600" />
                          <span className="line-clamp-3 whitespace-pre-wrap">
                            {log.ai_response}
                          </span>
                        </p>
                        {log.correction && (
                          <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-1 text-[8px] font-semibold uppercase tracking-wider text-teal-800">
                            <Pencil className="h-2 w-2" /> Dikoreksi
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteTraining(log.id)}
                        className="shrink-0 rounded p-1 text-stone-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        title="Hapus training"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </Card>
      </div>

      {/* Dialog Konfirmasi Simpan Training */}
      <Dialog open={saveConfirmOpen} onOpenChange={(open) => !open && setSaveConfirmOpen(false)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-teal-600" />
              Simpan sebagai Training Data
            </DialogTitle>
            <DialogDescription>
              Simpan pasangan percakapan dari simulasi ini sebagai data latih chatbot.
              Setiap pasangan akan ditandai dengan rating <strong>Baik</strong> agar digunakan chatbot sebagai panduan merespon di masa depan.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const pairs: Array<{
              userMessage: string;
              aiResponse: string;
              wasEdited: boolean;
              originalResponse?: string | null;
            }> = [];

            for (let i = 0; i < transcript.length; i++) {
              const msg = transcript[i];
              if (msg.direction === "out") {
                let priorUserMsg = "";
                for (let j = i - 1; j >= 0; j--) {
                  if (transcript[j].direction === "in") {
                    priorUserMsg = transcript[j].body;
                    break;
                  }
                }

                if (priorUserMsg && msg.body) {
                  const wasEdited = editedIndices[i] !== undefined;
                  pairs.push({
                    userMessage: priorUserMsg,
                    aiResponse: msg.body,
                    wasEdited,
                    originalResponse: wasEdited ? editedIndices[i] : null,
                  });
                }
              }
            }

            if (pairs.length === 0) {
              return (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Tidak ada pasangan pesan (tamu & respons bot) yang lengkap untuk disimpan.
                </div>
              );
            }

            return (
              <>
                <div className="my-2 border rounded-lg overflow-hidden bg-stone-50">
                  <div className="px-3 py-2 border-b bg-stone-100 flex justify-between text-xs font-semibold text-stone-600">
                    <span>Preview Training Data</span>
                    <span>{pairs.length} pasangan</span>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto p-3 space-y-3">
                    {pairs.map((p, idx) => (
                      <div key={idx} className="bg-white border rounded-md p-2.5 text-xs space-y-1.5 shadow-sm">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-stone-400 uppercase tracking-wider text-[9px] block">Tamu</span>
                          <p className="text-stone-700 font-medium">{p.userMessage}</p>
                        </div>
                        <div className="border-t pt-1.5 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-teal-600 uppercase tracking-wider text-[9px] block">Respons Ideal AI</span>
                            {p.wasEdited && (
                              <span className="bg-teal-100 text-teal-800 text-[8px] font-semibold px-1 rounded uppercase tracking-wider scale-90 origin-right">
                                Diedit
                              </span>
                            )}
                          </div>
                          <p className="text-stone-800 whitespace-pre-wrap">{p.aiResponse}</p>
                          {p.wasEdited && (
                            <p className="text-[10px] text-stone-400 mt-1 line-through italic">
                              Semula: {p.originalResponse}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setSaveConfirmOpen(false)} disabled={savingTraining}>
                    Batal
                  </Button>
                  <Button
                    className="bg-teal-700 hover:bg-teal-800 text-white"
                    disabled={savingTraining}
                    onClick={() => handleSaveTraining(pairs)}
                  >
                    {savingTraining ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Menyimpan…
                      </>
                    ) : (
                      <>
                        <GraduationCap className="mr-1.5 h-4 w-4" /> Simpan Training
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Dialog Impor Percakapan WhatsApp */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) {
            setImportOpen(false);
            setSearchQuery("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessagesSquare className="h-5 w-5 text-teal-600" />
              Impor Chat WhatsApp
            </DialogTitle>
            <DialogDescription>
              Pilih percakapan tamu riil untuk dimuat ke simulator. Nomor uji akan
              otomatis disesuaikan dengan nomor tamu.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama atau nomor telepon…"
              className="pl-8"
            />
          </div>

          <ScrollArea className="h-[340px] rounded-lg border">
            {threadsQuery.isLoading ? (
              <div className="flex h-[340px] items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat percakapan…
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="flex h-[340px] items-center justify-center text-center text-sm text-muted-foreground">
                Tidak ada percakapan yang cocok.
              </div>
            ) : (
              <ul className="divide-y">
                {filteredThreads.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => handleImportThread(t)}
                      disabled={!!importingId}
                      className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-muted disabled:opacity-60"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <User className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">
                            {t.display_name || t.phone}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                              t.ai_auto
                                ? "bg-teal-100 text-teal-700"
                                : "bg-stone-100 text-stone-600",
                            )}
                          >
                            {t.ai_auto ? "AI Auto" : "Human"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {t.last_message_preview || "—"}
                        </p>
                      </div>
                      {importingId === t.id && (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal-600" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-right text-sm font-medium", mono && "font-mono text-xs")}>
        {value ?? "—"}
      </span>
    </div>
  );
}
