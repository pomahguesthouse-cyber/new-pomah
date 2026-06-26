/**
 * Halaman pengaturan Training RAG.
 *
 * Memungkinkan admin mengatur seberapa banyak contoh training (top-K) dan
 * ambang kemiripan minimum yang dipakai chatbot saat menarik few-shot
 * examples dari `ai_conversation_logs`. Tersedia juga tombol backfill untuk
 * mengindeks contoh lama yang belum punya embedding.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Database } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  getAiLabConfig,
  updateAiLabConfig,
  TRAINING_RAG_DEFAULTS,
} from "./ai-lab.functions";
import { backfillTrainingEmbeddings } from "@/admin/modules/training/training.functions";

export function TrainingRagSettings() {
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getAiLabConfig);
  const saveConfig = useServerFn(updateAiLabConfig);
  const runBackfill = useServerFn(backfillTrainingEmbeddings);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-lab-config"],
    queryFn: () => fetchConfig(),
  });

  const [enabled, setEnabled] = useState(TRAINING_RAG_DEFAULTS.enabled);
  const [matchCount, setMatchCount] = useState(TRAINING_RAG_DEFAULTS.matchCount);
  const [minSimilarity, setMinSimilarity] = useState(TRAINING_RAG_DEFAULTS.minSimilarity);

  useEffect(() => {
    if (data?.config?.trainingRag) {
      setEnabled(data.config.trainingRag.enabled);
      setMatchCount(data.config.trainingRag.matchCount);
      setMinSimilarity(data.config.trainingRag.minSimilarity);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data?.id || !data?.config) throw new Error("Konfigurasi belum dimuat");
      const next = {
        ...data.config,
        trainingRag: { enabled, matchCount, minSimilarity },
      };
      return saveConfig({ data: { id: data.id, config: next } });
    },
    onSuccess: () => {
      toast.success("Pengaturan RAG disimpan");
      qc.invalidateQueries({ queryKey: ["ai-lab-config"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
  });

  const backfillMutation = useMutation({
    mutationFn: () => runBackfill({ data: { maxRows: 50 } }),
    onSuccess: (res) =>
      toast.success(
        `Backfill selesai: ${res.ok} berhasil, ${res.failed} gagal (dari ${res.processed})`,
      ),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Backfill gagal"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-teal-600" />
          Training RAG
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Atur bagaimana contoh training yang sudah disetujui di simulator
          ditarik kembali sebagai panduan jawaban chatbot.
        </p>
      </div>

      <Card className="space-y-6 p-4 sm:p-5">
        {/* Enable toggle */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="rag-enabled" className="text-sm font-medium">
              Aktifkan retrieval
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Jika nonaktif, chatbot kembali bekerja tanpa few-shot dari training.
            </p>
          </div>
          <Switch
            id="rag-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Top-K */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="rag-topk" className="text-sm font-medium">
              Jumlah contoh (top-K)
            </Label>
            <span className="text-sm font-mono tabular-nums text-muted-foreground">
              {matchCount}
            </span>
          </div>
          <Input
            id="rag-topk"
            type="number"
            min={1}
            max={10}
            step={1}
            value={matchCount}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setMatchCount(Math.min(10, Math.max(1, Math.round(n))));
            }}
            disabled={!enabled}
          />
          <p className="text-xs text-muted-foreground">
            Berapa banyak contoh paling mirip yang disuntikkan ke prompt
            (rekomendasi: 2–4). Nilai tinggi memakan lebih banyak token.
          </p>
        </div>

        {/* Threshold */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Ambang kemiripan minimum</Label>
            <span className="text-sm font-mono tabular-nums text-muted-foreground">
              {minSimilarity.toFixed(2)}
            </span>
          </div>
          <Slider
            min={0.5}
            max={0.95}
            step={0.01}
            value={[minSimilarity]}
            onValueChange={(v) => setMinSimilarity(v[0])}
            disabled={!enabled}
          />
          <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>0.50 — longgar</span>
            <span>0.95 — ketat</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Hanya contoh dengan cosine similarity ≥ nilai ini yang dipakai
            (rekomendasi: 0.75–0.82). Terlalu rendah → contoh tidak relevan;
            terlalu tinggi → jarang ada match.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !data?.id}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Simpan pengaturan
          </Button>
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-teal-600" />
          <h3 className="text-sm font-medium">Indeks ulang contoh lama</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Contoh training yang disimpan sebelum fitur RAG aktif belum memiliki
          embedding. Jalankan backfill untuk mengindeks hingga 50 baris
          sekaligus. Aman dijalankan berulang kali.
        </p>
        <div>
          <Button
            variant="outline"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending}
          >
            {backfillMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Database className="mr-2 h-4 w-4" />
            )}
            Jalankan backfill
          </Button>
        </div>
      </Card>
    </div>
  );
}
