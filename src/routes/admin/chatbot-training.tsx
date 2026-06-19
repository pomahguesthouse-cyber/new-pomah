import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Brain, Upload, Trash2, Save } from "lucide-react";

import {
  listTrainingExamples,
  uploadTrainingExamples,
  updateTrainingExample,
  deleteTrainingExample,
  type TrainingExampleRow,
} from "@/admin/functions/chatbot-training.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/chatbot-training")({
  component: ChatbotTrainingPage,
});

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

function ChatbotTrainingPage() {
  const listFn = useServerFn(listTrainingExamples);
  const uploadFn = useServerFn(uploadTrainingExamples);
  const updateFn = useServerFn(updateTrainingExample);
  const deleteFn = useServerFn(deleteTrainingExample);
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
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-5 w-5 text-violet-600" />
            Chatbot training examples
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload file .jsonl berisi contoh percakapan ideal. Setiap baris harus
            memiliki <code>user_message</code> dan <code>ideal_assistant_response</code>.
            Contoh aktif akan otomatis dirujuk oleh chatbot sebelum membalas.
          </p>
        </div>
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
          Belum ada contoh. Upload file .jsonl untuk memulai.
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
