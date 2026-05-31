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
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot,
  Send,
  RotateCcw,
  Loader2,
  User,
  Activity,
  Pencil,
  Check,
  X,
  GraduationCap,
  MessagesSquare,
  Search,
  Trash2,
  BookOpen,
  Download,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  simulateChatTurn,
  resetSimulation,
  saveSimulationAsTraining,
  listSimulatorTraining,
  deleteSimulatorTraining,
  updateSimulatorTraining,
  exportSimulatorTraining,
  suggestTrainingTitle,
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

type Direction = "in" | "out" | "system";
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

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatSimulatorView() {
  const runTurn = useServerFn(simulateChatTurn);
  const runReset = useServerFn(resetSimulation);
  const runSaveTraining = useServerFn(saveSimulationAsTraining);
  const runListThreads = useServerFn(listThreads);
  const runGetThread = useServerFn(getThread);
  const runListTraining = useServerFn(listSimulatorTraining);
  const runDeleteTraining = useServerFn(deleteSimulatorTraining);
  const runUpdateTraining = useServerFn(updateSimulatorTraining);
  const runExportTraining = useServerFn(exportSimulatorTraining);
  const runSuggestTitle = useServerFn(suggestTrainingTitle);
  const qc = useQueryClient();

  const [phone, setPhone] = useState("6281234567899");
  const [transcript, setTranscript] = useState<TranscriptMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastMeta, setLastMeta] = useState<TurnMeta | null>(null);

  // Inline correction on bot bubbles
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editedIndices, setEditedIndices] = useState<Record<number, string>>({});

  // Save training dialog state
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [savingTraining, setSavingTraining] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [titleLoading, setTitleLoading] = useState(false);

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
    const cleanHistory = history.filter((m) => m.direction === "in" || m.direction === "out");
    const res: any = await runTurn({ data: { phone, message, transcript: cleanHistory, origin } });
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

      const systemMessages: TranscriptMsg[] = [];
      if (meta.toolsUsed && meta.toolsUsed.length > 0) {
        meta.toolsUsed.forEach((tool) => {
          systemMessages.push({
            direction: "system",
            body: `🔧 Tool: ${tool}`,
          });
        });
      }

      if (reply) {
        setTranscript([...withUser, ...systemMessages, { direction: "out", body: reply }]);
      } else {
        setTranscript([
          ...withUser,
          ...systemMessages,
          { direction: "out", body: `⚠️ (tidak ada balasan — ${meta.error ?? meta.status})` },
        ]);
      }
      scrollToBottom();
    } catch (e: any) {
      toast.error(e.message ?? "Error");
      setTranscript(history);
    } finally {
      setSending(false);
    }
  }

  async function handleReset() {
    try {
      await runReset({ data: { phone } });
      setTranscript([]);
      setLastMeta(null);
      setEditedIndices({});
      setEditingIdx(null);
      toast.success("Percakapan & state booking direset");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal reset");
    }
  }

  // ── Save full conversation as training ──────────────────────────────────
  async function openSaveDialog() {
    setSaveConfirmOpen(true);
    setSaveTitle("");
    setTitleLoading(true);
    try {
      const cleanTranscript = transcript.filter((m) => m.direction === "in" || m.direction === "out");
      const res = await runSuggestTitle({ data: { transcript: cleanTranscript } });
      setSaveTitle(res?.title ?? "");
    } catch {
      setSaveTitle("");
    } finally {
      setTitleLoading(false);
    }
  }

  async function handleSaveTraining() {
    const title = saveTitle.trim();
    if (!title) {
      toast.error("Judul tidak boleh kosong");
      return;
    }
    const cleanTranscript = transcript.filter((m) => m.direction === "in" || m.direction === "out");
    if (cleanTranscript.length < 2) {
      toast.error("Percakapan terlalu pendek untuk disimpan");
      return;
    }
    setSavingTraining(true);
    try {
      const res: any = await runSaveTraining({ data: { title, transcript: cleanTranscript } });
      if (res?.ok) {
        toast.success("Percakapan disimpan sebagai training");
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

  // ── Saved training list ─────────────────────────────────────────────────
  const trainingQuery = useQuery({
    queryKey: ["simulator-training"],
    queryFn: () => runListTraining(),
  });
  const savedTraining: any[] = trainingQuery.data?.logs ?? [];

  async function handleDeleteTraining(id: string) {
    if (!confirm("Hapus training data ini? Tindakan tidak bisa dibatalkan.")) return;
    try {
      await runDeleteTraining({ data: { id } });
      qc.invalidateQueries({ queryKey: ["simulator-training"] });
      toast.success("Training data dihapus");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal menghapus");
    }
  }

  // ── Edit saved training (judul + transcript) ────────────────────────────
  const [editTrainingId, setEditTrainingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTranscript, setEditTranscript] = useState<TranscriptMsg[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  function openEditTraining(log: any) {
    setEditTrainingId(log.id);
    setEditTitle(log.title ?? "");
    const t: TranscriptMsg[] = Array.isArray(log.transcript) ? log.transcript : [];
    if (t.length > 0) {
      setEditTranscript(t);
    } else {
      // Fallback untuk baris tanpa transcript: rekonstruksi dari user_message + ai_response
      setEditTranscript([
        { direction: "in", body: log.user_message ?? "" },
        { direction: "out", body: log.ai_response ?? "" },
      ]);
    }
  }

  function updateEditTurn(idx: number, body: string) {
    setEditTranscript((prev) => prev.map((m, i) => (i === idx ? { ...m, body } : m)));
  }

  function removeEditTurn(idx: number) {
    setEditTranscript((prev) => prev.filter((_, i) => i !== idx));
  }

  function addEditTurn(direction: Direction) {
    setEditTranscript((prev) => [...prev, { direction, body: "" }]);
  }

  async function handleSaveEditTraining() {
    if (!editTrainingId) return;
    const title = editTitle.trim();
    const cleaned = editTranscript
      .map((m) => ({ ...m, body: m.body.trim() }))
      .filter((m) => m.body.length > 0);
    if (!title) {
      toast.error("Judul tidak boleh kosong");
      return;
    }
    if (cleaned.length < 2 || !cleaned.some((m) => m.direction === "in") || !cleaned.some((m) => m.direction === "out")) {
      toast.error("Minimal 1 pesan tamu dan 1 balasan bot");
      return;
    }
    setSavingEdit(true);
    try {
      await runUpdateTraining({
        data: { id: editTrainingId, title, transcript: cleaned },
      });
      qc.invalidateQueries({ queryKey: ["simulator-training"] });
      toast.success("Training data diperbarui");
      setEditTrainingId(null);
    } catch (e: any) {
      toast.error(e.message ?? "Gagal memperbarui");
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Export training ─────────────────────────────────────────────────────
  function downloadFile(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toCsv(rows: any[]): string {
    const headers = ["id", "title", "user_message", "ai_response", "correction", "rating", "used", "created_at"];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(","));
    return lines.join("\n");
  }

  async function handleExport(format: "json" | "csv") {
    try {
      const res: any = await runExportTraining();
      const rows: any[] = res?.rows ?? [];
      if (!rows.length) {
        toast.info("Belum ada training data untuk diekspor");
        return;
      }
      const ts = new Date().toISOString().slice(0, 10);
      if (format === "json") {
        downloadFile(
          `training-simulator-${ts}.json`,
          JSON.stringify(rows, null, 2),
          "application/json",
        );
      } else {
        downloadFile(`training-simulator-${ts}.csv`, toCsv(rows), "text/csv");
      }
      toast.success(`Mengekspor ${rows.length} baris (${format.toUpperCase()})`);
    } catch (e: any) {
      toast.error(e.message ?? "Gagal mengekspor");
    }
  }

  // ── Import WhatsApp conversation ────────────────────────────────────────
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

  // Reset edit dialog when closed
  useEffect(() => {
    if (editTrainingId === null) {
      setEditTitle("");
      setEditTranscript([]);
    }
  }, [editTrainingId]);

  return (
    <div className="grid h-full grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_480px]">
      {/* ── Left: chat ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3">
      {editTrainingId !== null ? (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-teal-600" />
              <div>
                <p className="text-sm font-semibold leading-tight">Edit Percakapan Training</p>
                <p className="text-xs text-muted-foreground">
                  Ubah judul dan isi tiap pesan. Perubahan akan di-embed ulang.
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditTrainingId(null)}
              disabled={savingEdit}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Tutup
            </Button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto bg-stone-50 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Judul percakapan</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                placeholder="Mis. Tanya harga kamar deluxe untuk akhir pekan"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Transcript ({editTranscript.length} pesan)</Label>
              <div className="space-y-2">
                {editTranscript.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-md border p-2",
                      m.direction === "in"
                        ? "border-emerald-200 bg-emerald-50/40"
                        : "border-teal-200 bg-teal-50/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                        {m.direction === "in" ? "Tamu" : "Bot"}
                      </span>
                      <button
                        onClick={() => removeEditTurn(i)}
                        className="rounded p-0.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                        title="Hapus pesan"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <Textarea
                      value={m.body}
                      onChange={(e) => updateEditTurn(i, e.target.value)}
                      className="min-h-[60px] text-xs"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => addEditTurn("in")}
                >
                  <Plus className="mr-1 h-3 w-3" /> Pesan tamu
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => addEditTurn("out")}
                >
                  <Plus className="mr-1 h-3 w-3" /> Balasan bot
                </Button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border bg-card p-3">
            <Button
              variant="outline"
              onClick={() => setEditTrainingId(null)}
              disabled={savingEdit}
            >
              Batal
            </Button>
            <Button
              className="bg-teal-700 hover:bg-teal-800 text-white"
              onClick={handleSaveEditTraining}
              disabled={savingEdit}
            >
              {savingEdit ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Menyimpan…
                </>
              ) : (
                <>
                  <Check className="mr-1.5 h-4 w-4" /> Simpan perubahan
                </>
              )}
            </Button>
          </div>
        </Card>
      ) : (
        <>

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
            {transcript.length >= 2 && (
              <Button
                variant="default"
                size="sm"
                className="bg-teal-700 hover:bg-teal-800 text-white font-medium shadow-sm transition-colors"
                onClick={openSaveDialog}
                disabled={sending}
              >
                <GraduationCap className="mr-1.5 h-3.5 w-3.5" />
                Simpan Training
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
              disabled={sending}
            >
              <MessagesSquare className="mr-1 h-3.5 w-3.5" />
              Impor Chat WA
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={sending}>
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
                Mulai mengetik untuk menguji chatbot.
              </div>
            ) : (
              transcript.map((m, i) => {
                if (m.direction === "system") {
                  return (
                    <div key={i} className="flex justify-center my-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-200/60 border border-stone-300 px-3 py-0.5 text-[10px] font-semibold text-stone-500 shadow-sm font-mono uppercase tracking-wider">
                        {m.body}
                      </span>
                    </div>
                  );
                }

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
                              isEdited && "border-l-4 border-l-teal-500 bg-teal-50/40",
                            ),
                        !isEditing && m.direction === "out" && "pr-8",
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
            {sending && (
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
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={sending || !input.trim()}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </Card>
        </>
      )}
      </div>


      {/* ── Right: meta + saved training ──────────────────────────────────── */}
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

        {/* Saved training list */}
        <Card className="flex min-h-0 flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" /> Training tersimpan
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => handleExport("json")}
                title="Ekspor JSON"
              >
                <Download className="mr-1 h-3 w-3" /> JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => handleExport("csv")}
                title="Ekspor CSV"
              >
                <Download className="mr-1 h-3 w-3" /> CSV
              </Button>
              {savedTraining.length > 0 && (
                <span className="ml-1 text-[10px] font-medium text-muted-foreground">
                  {savedTraining.length}
                </span>
              )}
            </div>
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
            <ScrollArea className="max-h-[420px]">
              <ul className="space-y-2 pr-2">
                {savedTraining.map((log) => {
                  const turns: TranscriptMsg[] = Array.isArray(log.transcript)
                    ? log.transcript
                    : [];
                  const turnCount = turns.length;
                  const preview = (log.user_message ?? "").slice(0, 120);
                  const dateStr = log.created_at
                    ? new Date(log.created_at).toLocaleDateString("id-ID", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "";

                  return (
                    <li
                      key={log.id}
                      className={cn(
                        "rounded-lg border p-2.5 text-xs transition",
                        editTrainingId === log.id
                          ? "border-teal-400 bg-teal-50/40"
                          : "border-border",
                      )}
                    >
                      <div className="space-y-1">
                        <p className="truncate text-sm font-semibold text-stone-800">
                          {log.title || "(Tanpa judul)"}
                        </p>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{dateStr}</span>
                          {turnCount > 0 && (
                            <>
                              <span>•</span>
                              <span>{turnCount} pesan</span>
                            </>
                          )}
                        </div>
                        <p className="flex items-start gap-1 text-stone-600">
                          <User className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2 whitespace-pre-wrap">{preview}</span>
                        </p>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-border/60 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => openEditTraining(log)}
                        >
                          <Pencil className="mr-1 h-3 w-3" /> Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleDeleteTraining(log.id)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" /> Hapus
                        </Button>
                      </div>
                    </li>

                  );
                })}
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
              Seluruh percakapan akan disimpan sebagai satu entri training dengan judul di
              bawah. Chatbot akan memakainya sebagai panduan jawaban di masa depan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs">
                Judul percakapan
                {titleLoading && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
                    <Sparkles className="h-3 w-3" /> Menyarankan…
                  </span>
                )}
              </Label>
              <Input
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                maxLength={120}
                disabled={titleLoading || savingTraining}
                placeholder="Mis. Tanya harga kamar untuk akhir pekan"
              />
              <p className="text-[10px] text-muted-foreground">
                Disarankan otomatis — silakan ubah jika perlu (maks. 120 karakter).
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border bg-stone-50">
              <div className="flex justify-between border-b bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-600">
                <span>Preview percakapan</span>
                <span>{transcript.filter((m) => m.direction === "in" || m.direction === "out").length} pesan</span>
              </div>
              <div className="max-h-[260px] space-y-2 overflow-y-auto p-3">
                {transcript
                  .filter((m) => m.direction === "in" || m.direction === "out")
                  .map((m, idx) => (
                    <div
                      key={idx}
                      className={cn("flex", m.direction === "in" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs shadow-sm",
                          m.direction === "in"
                            ? "rounded-br-sm bg-emerald-600 text-white"
                            : "rounded-bl-sm bg-white text-stone-800 border",
                        )}
                      >
                        <span className="block whitespace-pre-wrap break-words">{m.body}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setSaveConfirmOpen(false)}
              disabled={savingTraining}
            >
              Batal
            </Button>
            <Button
              className="bg-teal-700 hover:bg-teal-800 text-white"
              disabled={savingTraining || titleLoading || !saveTitle.trim()}
              onClick={handleSaveTraining}
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
