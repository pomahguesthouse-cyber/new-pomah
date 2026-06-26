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
  Paperclip,
  PlayCircle,
  StopCircle,
  ChevronRight,
  ExternalLink,
  FileText,
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
import { getAiLabConfig, formatAgentBadge } from "@/admin/modules/ai-lab/ai-lab.functions";
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
  intent?: string;
  agentKey?: string;
  /** Attachment the WA worker would send alongside this reply (brochure/invoice). */
  attachment?: { url: string; name?: string };
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
  const { data: aiLabConfig } = useQuery({ queryKey: ["ai-lab-config"], queryFn: () => getAiLabConfig() });

  const [phone, setPhone] = useState("6281234567899");
  const [transcript, setTranscript] = useState<TranscriptMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [lastMeta, setLastMeta] = useState<TurnMeta | null>(null);
  /** Payment-proof image attached to the next outgoing message (sim only). */
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /**
   * Pre-scripted demo runner. demoStep = index of the NEXT step to run
   * (so after a turn finishes, the user clicks "Lanjut" to fire the
   * step at demoStep). -1 means the demo is not active.
   */
  const [demoStep, setDemoStep] = useState<number>(-1);
  // We keep a ref alongside the state so the async runner can read the
  // latest transcript without stale closure issues.
  const transcriptRef = useRef<TranscriptMsg[]>([]);
  transcriptRef.current = transcript;

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
  const activeEditorRef = useRef<HTMLTextAreaElement>(null);

  function insertFormatToTextarea(
    text: string,
    setText: (val: string) => void,
    textareaEl: HTMLTextAreaElement | null,
    type: "bold" | "italic" | "strike"
  ) {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    const selected = text.substring(start, end);

    let prefix = "";
    let suffix = "";
    if (type === "bold") {
      prefix = "*";
      suffix = "*";
    } else if (type === "italic") {
      prefix = "_";
      suffix = "_";
    } else if (type === "strike") {
      prefix = "~";
      suffix = "~";
    }

    const formatted = prefix + selected + suffix;
    const newText = text.substring(0, start) + formatted + text.substring(end);
    setText(newText);

    setTimeout(() => {
      textareaEl.focus();
      textareaEl.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  }

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : undefined;

  async function sendOne(
    message: string,
    history: TranscriptMsg[],
    imageDataUrl?: string,
  ) {
    const cleanHistory = history
      .filter((m) => m.direction === "in" || m.direction === "out")
      .map((m) => ({ direction: m.direction, body: m.body }));
    const res: any = await runTurn({
      data: { phone, message, transcript: cleanHistory, origin, imageDataUrl },
    });
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
    const attachment = res.attachment as { url: string; name?: string } | undefined;
    const ocrResult = res.ocrResult as
      | { ocr: Record<string, any>; match: Record<string, any> }
      | null
      | undefined;
    return { reply: res.reply as string | null, meta, attachment, ocrResult };
  }

  // ── Booking form integration ────────────────────────────────────────────
  // Bot reply yang berisi URL `/booking/form/<token>` di-render dengan tombol
  // "Buka formulir". Setelah dibuka, simulator polling endpoint publik untuk
  // mendeteksi submission, lalu otomatis mengirim `[FORM_SUBMITTED:<token>]`
  // sebagai pesan tamu — meniru perilaku worker WA di produksi.
  const FORM_URL_REGEX = /\/booking\/form\/([A-Za-z0-9_-]{16,})/;
  function extractFormToken(body: string): string | null {
    const m = body.match(FORM_URL_REGEX);
    return m ? m[1] : null;
  }

  // Token yang sedang dipantau, supaya tidak double-poll dan tidak dobel kirim.
  const pollingTokensRef = useRef<Set<string>>(new Set());
  const submittedTokensRef = useRef<Set<string>>(new Set());

  async function pollFormSubmission(token: string) {
    if (pollingTokensRef.current.has(token) || submittedTokensRef.current.has(token)) return;
    pollingTokensRef.current.add(token);
    const deadline = Date.now() + 5 * 60 * 1000; // 5 menit
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const res = await fetch(`/api/public/booking-form/${token}`, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (data?.status === "submitted") {
              if (submittedTokensRef.current.has(token)) return;
              submittedTokensRef.current.add(token);
              // Kirim pesan sintetis melalui pipeline simulator.
              const syntheticMessage = `[FORM_SUBMITTED:${token}]`;
              const history = transcriptRef.current;
              const userBubble: TranscriptMsg = { direction: "in", body: "📝 Formulir booking terkirim" };
              const withUser = [...history, userBubble];
              setTranscript(withUser);
              scrollToBottom();
              setSending(true);
              try {
                const { reply, meta, attachment } = await sendOne(syntheticMessage, history);
                setLastMeta(meta);
                const systemMessages: TranscriptMsg[] = (meta.toolsUsed ?? []).map((tool) => ({
                  direction: "system" as const,
                  body: `🔧 Tool: ${tool}`,
                }));
                setTranscript([
                  ...withUser,
                  ...systemMessages,
                  ...(reply
                    ? [{ direction: "out" as const, body: reply, attachment }]
                    : [{ direction: "out" as const, body: `⚠️ (tidak ada balasan — ${meta.error ?? meta.status})` }]),
                ]);
                scrollToBottom();
                toast.success("Formulir terkirim — chatbot melanjutkan");
              } finally {
                setSending(false);
              }
              return;
            }
            if (data?.status === "expired") {
              toast.warning("Token formulir kedaluwarsa");
              return;
            }
          }
        } catch {
          // network blip — coba lagi
        }
      }
    } finally {
      pollingTokensRef.current.delete(token);
    }
  }

  function openBookingForm(token: string) {
    const url = `/booking/form/${token}`;
    window.open(url, "_blank", "noopener,noreferrer");
    void pollFormSubmission(token);
  }

  async function handleSend() {
    const message = input.trim() || (attachedImage ? "Saya kirim bukti transfer Kak" : "");
    if (!message || sending) return;
    const imgPayload = attachedImage;
    setInput("");
    setAttachedImage(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    const history = transcript;
    const userBubble: TranscriptMsg = {
      direction: "in",
      body: message,
      attachment: imgPayload ? { url: imgPayload.dataUrl, name: imgPayload.name } : undefined,
    };
    const withUser = [...history, userBubble];
    setTranscript(withUser);
    scrollToBottom();
    setSending(true);
    try {
      const { reply, meta, attachment, ocrResult } = await sendOne(
        message,
        history,
        imgPayload?.dataUrl,
      );
      setLastMeta(meta);

      const systemMessages: TranscriptMsg[] = [];
      if (ocrResult) {
        const o = ocrResult.ocr;
        const m = ocrResult.match;
        const nominal = o.nominal != null ? `Rp ${Number(o.nominal).toLocaleString("id-ID")}` : "-";
        const bank = o.bank_pengirim ?? "-";
        const matchLabel = m.status === "matched"
          ? `cocok dengan ${m.booking_code}`
          : m.status === "unmatched"
          ? `tidak cocok (booking ${m.booking_code}, selisih ${m.amount_diff})`
          : m.status === "ambiguous"
          ? `ambigu (booking ${m.booking_code})`
          : m.status === "no_pending_booking"
          ? "tidak ada booking pending"
          : m.status;
        systemMessages.push({
          direction: "system",
          body: `📸 OCR: ${nominal} via ${bank} — ${matchLabel}`,
        });
      }
      if (meta.toolsUsed && meta.toolsUsed.length > 0) {
        meta.toolsUsed.forEach((tool) => {
          systemMessages.push({
            direction: "system",
            body: `🔧 Tool: ${tool}`,
          });
        });
      }

      const updatedWithUser = [...withUser];
      if (updatedWithUser.length > 0 && updatedWithUser[updatedWithUser.length - 1].direction === "in") {
        updatedWithUser[updatedWithUser.length - 1] = {
          ...updatedWithUser[updatedWithUser.length - 1],
          intent: meta.intent,
        };
      }

      if (reply) {
        setTranscript([
          ...updatedWithUser,
          ...systemMessages,
          { direction: "out", body: reply, attachment },
        ]);
      } else {
        setTranscript([
          ...updatedWithUser,
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
      setDemoStep(-1);
      toast.success("Percakapan & state booking direset");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal reset");
    }
  }

  // ── Export transcript as JSON ───────────────────────────────────────────
  // Saves the current simulator conversation (or any imported WA chat
  // loaded into the transcript) to a downloadable JSON file. Useful for
  // sharing a problematic flow with the team or seeding the same dialog
  // back into the simulator later via "Impor Chat WA".
  function handleExportJson() {
    if (transcript.length === 0) {
      toast.error("Belum ada percakapan untuk diekspor.");
      return;
    }
    // Strip transient UI-only fields (none currently, but future-proof).
    const messages = transcript.map((m) => ({
      direction: m.direction,
      body:      m.body,
      ...(m.intent     ? { intent: m.intent } : {}),
      ...(m.attachment ? { attachment: m.attachment } : {}),
    }));
    const payload = {
      exportedAt: new Date().toISOString(),
      phone,
      messageCount: messages.filter((m) => m.direction === "in" || m.direction === "out").length,
      messages,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const ts   = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `wa-simulator-${phone || "chat"}-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Diunduh ${payload.messageCount} pesan ke ${a.download}.`);
  }

  // ── Pre-scripted booking demo ───────────────────────────────────────────
  // Drives the bot through: greeting → room inquiry → pricing → booking
  // initiation → name → email → phone → confirmation → invoice. The last
  // step lands in PAYMENT_PENDING; the state machine returns the invoice
  // + bank details. Test Finance Agent separately by attaching a real
  // bukti transfer image after the demo finishes.
  const DEMO_SCRIPT: Array<{ label: string; message: string }> = [
    { label: "Sapaan",              message: "Halo, selamat siang" },
    { label: "Tanya kamar Deluxe",  message: "Saya mau tanya kamar Deluxe" },
    { label: "Tanya harga (ikuti konteks)", message: "Berapa harganya?" },
    { label: "Mulai booking",       message: "Saya mau booking kamar Deluxe untuk check-in besok, 2 malam, 2 orang dewasa" },
    { label: "Beri nama",           message: "Budi Santoso" },
    { label: "Konfirmasi nama",     message: "ya" },
    { label: "Beri email",          message: "budi.test@example.com" },
    { label: "Konfirmasi nomor",    message: "ya" },
    { label: "Konfirmasi booking → invoice", message: "ya lanjut" },
  ];

  async function runDemoStep(stepIdx: number) {
    if (stepIdx >= DEMO_SCRIPT.length) {
      setDemoStep(-1);
      toast.success("Demo booking selesai");
      return;
    }
    const step = DEMO_SCRIPT[stepIdx];
    const history = transcriptRef.current;
    const userBubble: TranscriptMsg = { direction: "in", body: step.message };
    setTranscript([...history, userBubble]);
    scrollToBottom();
    setSending(true);
    try {
      const { reply, meta, attachment } = await sendOne(step.message, history);
      setLastMeta(meta);

      const updatedUser: TranscriptMsg = { ...userBubble, intent: meta.intent };
      const systemMessages: TranscriptMsg[] = (meta.toolsUsed ?? []).map((tool) => ({
        direction: "system" as const,
        body: `🔧 Tool: ${tool}`,
      }));
      const newTranscript: TranscriptMsg[] = [
        ...history,
        updatedUser,
        ...systemMessages,
        ...(reply
          ? [{ direction: "out" as const, body: reply, attachment }]
          : [{ direction: "out" as const, body: `⚠️ (tidak ada balasan — ${meta.error ?? meta.status})` }]),
      ];
      setTranscript(newTranscript);
      setDemoStep(stepIdx + 1);
      scrollToBottom();
    } catch (e: any) {
      toast.error(`Step ${stepIdx + 1} gagal: ${e.message ?? e}`);
      setDemoStep(-1);
    } finally {
      setSending(false);
    }
  }

  async function startDemo() {
    const warn = window.confirm(
      "Simulasi akan:\n" +
      "• Reset state booking untuk nomor ini\n" +
      "• MEMBUAT booking & invoice NYATA di database\n" +
      "• Mengirim notifikasi (jika dikonfigurasi)\n\n" +
      "Pastikan nomor di atas adalah nomor UJI, bukan nomor tamu nyata.\n\n" +
      "Lanjutkan?",
    );
    if (!warn) return;
    try {
      await runReset({ data: { phone } });
      setTranscript([]);
      setLastMeta(null);
      setEditedIndices({});
      setEditingIdx(null);
      setDemoStep(0);
      // Kick off step 0 immediately so the user sees activity.
      await runDemoStep(0);
    } catch (e: any) {
      toast.error(e.message ?? "Gagal memulai demo");
      setDemoStep(-1);
    }
  }

  function stopDemo() {
    setDemoStep(-1);
    toast.info("Demo dihentikan");
  }

  // ── Save full conversation as training ──────────────────────────────────
  async function openSaveDialog() {
    setSaveConfirmOpen(true);
    setSaveTitle("");
    setTitleLoading(true);
    try {
      const cleanTranscript = transcript
        .filter((m) => m.direction === "in" || m.direction === "out")
        .map((m) => ({ direction: m.direction, body: m.body }));
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
    const cleanTranscript = transcript
      .filter((m) => m.direction === "in" || m.direction === "out")
      .map((m) => ({ direction: m.direction, body: m.body }));
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
          intent: m.metadata?.intent,
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
                    <div className="flex gap-1 mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`edit-textarea-${i}`) as HTMLTextAreaElement;
                          insertFormatToTextarea(m.body, (val) => updateEditTurn(i, val), el, "bold");
                        }}
                        className="h-5 w-5 inline-flex items-center justify-center text-[10px] font-bold hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                        title="Tebal (Bold) - *"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`edit-textarea-${i}`) as HTMLTextAreaElement;
                          insertFormatToTextarea(m.body, (val) => updateEditTurn(i, val), el, "italic");
                        }}
                        className="h-5 w-5 inline-flex items-center justify-center text-[10px] italic hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                        title="Miring (Italic) - _"
                      >
                        I
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(`edit-textarea-${i}`) as HTMLTextAreaElement;
                          insertFormatToTextarea(m.body, (val) => updateEditTurn(i, val), el, "strike");
                        }}
                        className="h-5 w-5 inline-flex items-center justify-center text-[10px] line-through hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                        title="Coret (Strikethrough) - ~"
                      >
                        S
                      </button>
                    </div>
                    <Textarea
                      id={`edit-textarea-${i}`}
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
            <Button
              variant="outline"
              size="sm"
              onClick={startDemo}
              disabled={sending || demoStep !== -1}
              title="Jalankan skenario booking lengkap step-by-step"
            >
              <PlayCircle className="mr-1 h-3.5 w-3.5" />
              Demo Booking
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportJson}
              disabled={sending || transcript.length === 0}
              title="Unduh percakapan ini sebagai file JSON"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Ekspor JSON
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
                          <div className="flex gap-1.5 p-1 rounded bg-stone-100 border border-stone-200 w-fit">
                            <button
                              type="button"
                              onClick={() => insertFormatToTextarea(editingText, setEditingText, activeEditorRef.current, "bold")}
                              className="h-6 w-6 inline-flex items-center justify-center text-xs font-bold hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                              title="Tebal (Bold) - *"
                            >
                              B
                            </button>
                            <button
                              type="button"
                              onClick={() => insertFormatToTextarea(editingText, setEditingText, activeEditorRef.current, "italic")}
                              className="h-6 w-6 inline-flex items-center justify-center text-xs italic hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                              title="Miring (Italic) - _"
                            >
                              I
                            </button>
                            <button
                              type="button"
                              onClick={() => insertFormatToTextarea(editingText, setEditingText, activeEditorRef.current, "strike")}
                              className="h-6 w-6 inline-flex items-center justify-center text-xs line-through hover:bg-stone-200 rounded border border-stone-300 bg-white cursor-pointer"
                              title="Coret (Strikethrough) - ~"
                            >
                              S
                            </button>
                          </div>
                          <Textarea
                            ref={activeEditorRef}
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
                          {m.direction === "in" && m.attachment?.url?.startsWith("data:image") && (
                            <img
                              src={m.attachment.url}
                              alt="Bukti transfer"
                              className="mb-2 max-h-40 rounded-md border border-emerald-700/40 object-contain bg-white/10"
                            />
                          )}
                          <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          {m.direction === "out" && m.attachment && (
                            <a
                              href={m.attachment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 transition"
                              title="WA akan melampirkan file ini"
                            >
                              <Paperclip className="h-3 w-3" />
                              {m.attachment.name ?? "Lampiran"}
                            </a>
                          )}
                          {m.direction === "in" && m.intent && (
                            <span className="mt-1.5 flex items-center justify-end gap-1 text-[9px] font-bold text-emerald-100 uppercase tracking-wider bg-emerald-700/50 w-fit ml-auto px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono select-none">
                              Intent: {m.intent}
                            </span>
                          )}
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
                          {m.direction === "out" && m.agentKey && !isEditing && (
                            <span className="mt-1.5 flex items-center justify-end gap-1 text-[9px] font-bold text-sky-700 dark:text-sky-300 uppercase tracking-wider bg-sky-100/50 dark:bg-sky-900/50 w-fit ml-auto px-1.5 py-0.5 rounded border border-sky-500/20 font-mono select-none">
                              Agent: {aiLabConfig?.config?.agents ? formatAgentBadge(m.agentKey, aiLabConfig.config.agents) : m.agentKey}
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

          {/* Demo stepper banner */}
          {demoStep >= 0 && (
            <div className="border-t border-indigo-200 bg-indigo-50 px-3 py-2 flex items-center gap-3">
              <PlayCircle className="h-4 w-4 text-indigo-600 shrink-0" />
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-semibold text-indigo-900">
                  Demo {demoStep < DEMO_SCRIPT.length
                    ? `${demoStep + 1}/${DEMO_SCRIPT.length}`
                    : `${DEMO_SCRIPT.length}/${DEMO_SCRIPT.length}`}
                  {demoStep < DEMO_SCRIPT.length && (
                    <span className="ml-2 font-normal text-indigo-700/80">
                      Berikutnya: <span className="font-medium">{DEMO_SCRIPT[demoStep].label}</span>
                    </span>
                  )}
                </div>
                {demoStep < DEMO_SCRIPT.length && (
                  <div className="text-indigo-700/70 truncate italic">
                    "{DEMO_SCRIPT[demoStep].message}"
                  </div>
                )}
                {demoStep >= DEMO_SCRIPT.length && (
                  <div className="text-indigo-700/70">
                    Selesai — booking dibuat. Lampirkan bukti transfer untuk uji Finance Agent.
                  </div>
                )}
              </div>
              {demoStep < DEMO_SCRIPT.length ? (
                <Button
                  size="sm"
                  className="h-7 bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => runDemoStep(demoStep)}
                  disabled={sending}
                >
                  {sending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ChevronRight className="mr-1 h-3.5 w-3.5" />
                  )}
                  Lanjut
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-indigo-300 text-indigo-700"
                  onClick={() => setDemoStep(-1)}
                >
                  Tutup
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-indigo-700 hover:bg-indigo-100"
                onClick={stopDemo}
                disabled={sending}
                title="Hentikan demo (state booking tidak di-reset)"
              >
                <StopCircle className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Composer */}
          <div className="border-t border-border bg-card">
            {attachedImage && (
              <div className="flex items-center gap-2 px-3 pt-3">
                <div className="relative inline-flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-1.5 pr-2">
                  <img
                    src={attachedImage.dataUrl}
                    alt="preview"
                    className="h-12 w-12 rounded object-cover border border-emerald-200"
                  />
                  <div className="flex flex-col text-[11px]">
                    <span className="font-medium text-emerald-900 truncate max-w-[180px]">
                      {attachedImage.name}
                    </span>
                    <span className="text-emerald-700/70">Akan dijalankan OCR + match booking</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachedImage(null);
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    }}
                    className="ml-1 self-start rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
                    title="Hapus lampiran"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 p-3">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 4 * 1024 * 1024) {
                    toast.error("Maksimum 4 MB");
                    e.target.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    setAttachedImage({ dataUrl: String(reader.result), name: file.name });
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => imageInputRef.current?.click()}
                disabled={sending}
                title="Lampirkan bukti transfer (PNG/JPG)"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={attachedImage ? "Tambahkan pesan (opsional)…" : "Ketik pesan sebagai tamu…"}
                disabled={sending}
              />
              <Button onClick={handleSend} disabled={sending || (!input.trim() && !attachedImage)}>
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
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
