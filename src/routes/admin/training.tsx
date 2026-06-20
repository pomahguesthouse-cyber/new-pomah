import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ThumbsUp,
  ThumbsDown,
  Download,
  Brain,
  Upload,
  Trash2,
  Save,
  ArrowUpRight,
} from "lucide-react";

import {
  listConversationLogs,
  rateConversationLog,
  exportTrainingData,
} from "@/admin/modules/training/training.functions";
import {
  listTrainingExamples,
  uploadTrainingExamples,
  updateTrainingExample,
  deleteTrainingExample,
  backfillCuratedEmbeddings,
  promoteLogToCurated,
  type TrainingExampleRow,
} from "@/admin/functions/chatbot-training.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatDateTimeID } from "@/lib/utils";

export const Route = createFileRoute("/admin/training")({
  component: TrainingPage,
});

function TrainingPage() {
  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Chatbot training
        </p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <Brain className="h-6 w-6 text-violet-600" />
          AI training data
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dua sumber data latihan dalam satu tempat: contoh kurasi (JSONL) dan
          log percakapan asli yang di-rating admin.
        </p>
      </header>

      <Tabs defaultValue="curated" className="space-y-4">
        <TabsList>
          <TabsTrigger value="curated">Curated examples</TabsTrigger>
          <TabsTrigger value="logs">Conversation logs</TabsTrigger>
        </TabsList>
        <TabsContent value="curated">
          <CuratedTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tab: Curated examples (JSONL) ───────────────────────────────────────────

interface ParsedLine {
  ok: boolean;
  raw: string;
  error?: string;
  value?: Record<string, unknown>;
}

function parseJsonl(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map<ParsedLine>((line) => {
      try {
        const obj = JSON.parse(line);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
          return { ok: false, raw: line, error: "Bukan objek JSON" };
        }
        const o = obj as Record<string, unknown>;
        if (typeof o.user_message !== "string" || !o.user_message.trim()) {
          return { ok: false, raw: line, error: "user_message wajib" };
        }
        if (
          typeof o.ideal_assistant_response !== "string" ||
          !o.ideal_assistant_response.trim()
        ) {
          return { ok: false, raw: line, error: "ideal_assistant_response wajib" };
        }
        return { ok: true, raw: line, value: o };
      } catch (e) {
        return { ok: false, raw: line, error: (e as Error).message };
      }
    });
}

function CuratedTab() {
  const listFn = useServerFn(listTrainingExamples);
  const uploadFn = useServerFn(uploadTrainingExamples);
  const updateFn = useServerFn(updateTrainingExample);
  const deleteFn = useServerFn(deleteTrainingExample);
  const backfillFn = useServerFn(backfillCuratedEmbeddings);
  const qc = useQueryClient();

  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["training-examples"],
    queryFn: () => listFn({}),
  });
  const examples = data?.examples ?? [];

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return examples;
    return examples.filter(
      (e) =>
        e.user_message.toLowerCase().includes(q) ||
        e.ideal_assistant_response.toLowerCase().includes(q) ||
        (e.intent ?? "").toLowerCase().includes(q) ||
        (e.stage ?? "").toLowerCase().includes(q),
    );
  }, [examples, filter]);

  const pendingEmbedding = examples.filter((e) => !e.embedding_updated_at).length;

  const uploadMut = useMutation({
    mutationFn: (p: { sourceFile: string; examples: Record<string, unknown>[] }) =>
      uploadFn({ data: p as never }),
    onSuccess: (r) => {
      toast.success(`Tersimpan ${r.inserted} dari ${r.total} contoh`);
      qc.invalidateQueries({ queryKey: ["training-examples"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: (p: { id: string; ideal_assistant_response?: string; is_active?: boolean }) =>
      updateFn({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["training-examples"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Contoh dihapus");
      qc.invalidateQueries({ queryKey: ["training-examples"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const backfillMut = useMutation({
    mutationFn: () => backfillFn({ data: { maxRows: 50 } }),
    onSuccess: (r) => {
      toast.success(
        `Backfill selesai: ${r.ok} berhasil, ${r.failed} gagal (dari ${r.processed}).`,
      );
      qc.invalidateQueries({ queryKey: ["training-examples"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function handleFile(file: File) {
    const text = await file.text();
    const parsed = parseJsonl(text);
    const valid = parsed.filter((p) => p.ok && p.value);
    const invalid = parsed.length - valid.length;
    if (valid.length === 0) {
      toast.error("Tidak ada baris valid pada file");
      return;
    }
    if (invalid > 0) {
      toast.warning(`${invalid} baris dilewati karena tidak valid`);
    }
    uploadMut.mutate({
      sourceFile: file.name,
      examples: valid.map((p) => p.value as Record<string, unknown>),
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Upload .jsonl berisi contoh percakapan ideal. Setiap baris harus
          memiliki <code>user_message</code> dan{" "}
          <code>ideal_assistant_response</code>. Contoh aktif diindeks lewat
          embedding dan dicari saat tamu mengirim pesan mirip.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".jsonl,application/jsonl,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          {pendingEmbedding > 0 && (
            <Button
              variant="outline"
              onClick={() => backfillMut.mutate()}
              disabled={backfillMut.isPending}
            >
              Backfill embedding ({pendingEmbedding})
            </Button>
          )}
          <Button onClick={() => fileRef.current?.click()} disabled={uploadMut.isPending}>
            <Upload className="mr-1.5 h-4 w-4" />
            Upload .jsonl
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <Input
          placeholder="Cari berdasarkan pesan, intent, atau stage…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </Card>

      {isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Memuat…</Card>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Belum ada contoh. Upload file .jsonl atau promosikan log percakapan.
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((ex: TrainingExampleRow) => (
          <Card key={ex.id} className={`p-4 ${ex.is_active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">{ex.id}</span>
              {ex.intent && (
                <Badge variant="outline" className="text-[10px]">
                  intent: {ex.intent}
                </Badge>
              )}
              {ex.stage && (
                <Badge variant="outline" className="text-[10px]">
                  stage: {ex.stage}
                </Badge>
              )}
              {ex.training_type && (
                <Badge variant="outline" className="text-[10px]">
                  {ex.training_type}
                </Badge>
              )}
              {ex.source_file && (
                <Badge variant="outline" className="text-[10px]">
                  {ex.source_file}
                </Badge>
              )}
              {ex.embedding_updated_at ? (
                <Badge variant="secondary" className="text-[10px]">
                  embedded
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-amber-600">
                  belum di-embed
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={ex.is_active}
                    onCheckedChange={(checked) =>
                      updateMut.mutate({ id: ex.id, is_active: checked })
                    }
                  />
                  Aktif
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm("Hapus contoh ini?")) deleteMut.mutate(ex.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  Pesan tamu
                </p>
                <div className="rounded-md bg-muted/40 p-2 text-sm whitespace-pre-wrap">
                  {ex.user_message}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  Jawaban ideal
                </p>
                <Textarea
                  defaultValue={ex.ideal_assistant_response}
                  rows={4}
                  className="text-sm"
                  onChange={(e) =>
                    setEditing((m) => ({ ...m, [ex.id]: e.target.value }))
                  }
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      editing[ex.id] === undefined ||
                      editing[ex.id] === ex.ideal_assistant_response
                    }
                    onClick={() =>
                      updateMut.mutate({
                        id: ex.id,
                        ideal_assistant_response: editing[ex.id],
                      })
                    }
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Simpan
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Conversation logs (rating + promote) ──────────────────────────────

type Filter = "all" | "good" | "bad" | "unrated";

function LogsTab() {
  const fn = useServerFn(listConversationLogs);
  const rate = useServerFn(rateConversationLog);
  const exp = useServerFn(exportTrainingData);
  const promote = useServerFn(promoteLogToCurated);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const { data } = useQuery({
    queryKey: ["ai-logs", filter],
    queryFn: () => fn({ data: { rating: filter } }),
  });
  useRealtimeInvalidate("admin-training-stream", ["ai_conversation_logs"], [["ai-logs"]]);

  const rateMut = useMutation({
    mutationFn: (v: { id: string; rating: "good" | "bad" | null; correction?: string | null }) =>
      rate({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-logs"] }),
  });

  const promoteMut = useMutation({
    mutationFn: (logId: string) => promote({ data: { logId } }),
    onSuccess: (r) => {
      toast.success(
        r.alreadyExisted ? "Log ini sudah pernah dipromosi." : "Berhasil dipromosi ke curated.",
      );
      qc.invalidateQueries({ queryKey: ["training-examples"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleExport = async () => {
    const { rows } = await exp();
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pomah-training-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["all", "unrated", "good", "bad"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md border px-3 py-1 font-mono text-xs uppercase tracking-widest ${
                filter === f
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Export labelled
        </Button>
      </div>

      <div className="space-y-3">
        {(data?.logs ?? []).map((l) => (
          <LogRow
            key={l.id}
            id={l.id}
            user_message={l.user_message}
            ai_response={l.ai_response}
            rating={l.rating as "good" | "bad" | null}
            correction={l.correction}
            created_at={l.created_at}
            onRate={(rating, correction) => rateMut.mutate({ id: l.id, rating, correction })}
            onPromote={() => promoteMut.mutate(l.id)}
            promoting={promoteMut.isPending}
          />
        ))}
        {(data?.logs ?? []).length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Belum ada percakapan. Ajak AI menjawab dari inbox WhatsApp untuk mengisi log ini.
          </p>
        )}
      </div>
    </div>
  );
}

function LogRow({
  id,
  user_message,
  ai_response,
  rating,
  correction,
  created_at,
  onRate,
  onPromote,
  promoting,
}: {
  id: string;
  user_message: string | null;
  ai_response: string;
  rating: "good" | "bad" | null;
  correction: string | null;
  created_at: string;
  onRate: (r: "good" | "bad" | null, correction?: string | null) => void;
  onPromote: () => void;
  promoting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(correction ?? "");
  void id;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {user_message && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Guest
              </p>
              <p className="mt-1 text-sm">{user_message}</p>
            </div>
          )}
          <div className="mt-3 border-l-2 border-accent pl-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              AI draft
            </p>
            <p className="mt-1 text-sm">{ai_response}</p>
          </div>
          {correction && (
            <div className="mt-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Correction
              </p>
              <p className="mt-1 text-sm text-foreground">{correction}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="font-mono text-[10px] text-muted-foreground">
            {formatDateTimeID(created_at)}
          </p>
          {rating && (
            <Badge variant={rating === "good" ? "default" : "destructive"}>{rating}</Badge>
          )}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={rating === "good" ? "default" : "outline"}
              onClick={() => onRate("good")}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant={rating === "bad" ? "destructive" : "outline"}
              onClick={() => {
                onRate("bad");
                setEditing(true);
              }}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          {rating === "good" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onPromote}
              disabled={promoting}
              title="Promosikan ke curated examples"
            >
              <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" />
              Promote
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Apa yang seharusnya dijawab AI?"
            rows={2}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onRate("bad", text);
                setEditing(false);
              }}
            >
              Simpan koreksi
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Batal
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
