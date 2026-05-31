/**
 * AI LAB → Training Percakapan
 *
 * CRUD interface for managing conversation training examples.
 * Admins write Q&A pairs (user message + ideal AI response) that the
 * chatbot uses as a basis for future answers.
 */
import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Loader2,
} from "lucide-react";

import {
  listConversationLogs,
  saveTrainingExample,
  deleteConversationLog,
  updateConversationLog,
} from "@/admin/modules/training/training.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type Rating = "good" | "bad" | null;

type LogRow = {
  id: string;
  user_message: string | null;
  ai_response: string | null;
  rating: Rating;
  used: boolean | null;
  created_at: string;
};

type FilterTab = "all" | "good" | "bad" | "unrated";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RatingBadge({ rating }: { rating: Rating }) {
  if (rating === "good")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <ThumbsUp className="h-3 w-3" />
        Baik
      </span>
    );
  if (rating === "bad")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <ThumbsDown className="h-3 w-3" />
        Buruk
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
      Belum dinilai
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Training example dialog (create / edit)                             */
/* ------------------------------------------------------------------ */

type ExampleDialogProps = {
  open: boolean;
  initial?: LogRow | null;
  onClose: () => void;
  onSaved: () => void;
};

function ExampleDialog({ open, initial, onClose, onSaved }: ExampleDialogProps) {
  const isEdit = !!initial;

  const fnCreate = useServerFn(saveTrainingExample);
  const fnUpdate = useServerFn(updateConversationLog);

  const [userMsg, setUserMsg] = React.useState("");
  const [aiResp, setAiResp] = React.useState("");
  const [rating, setRating] = React.useState<Rating>(null);
  const [saving, setSaving] = React.useState(false);

  // Sync form when dialog opens
  React.useEffect(() => {
    if (open) {
      setUserMsg(initial?.user_message ?? "");
      setAiResp(initial?.ai_response ?? "");
      setRating(initial?.rating ?? null);
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (!userMsg.trim() || !aiResp.trim()) {
      toast.error("Pesan tamu dan respons AI wajib diisi");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && initial) {
        await fnUpdate({
          data: {
            id: initial.id,
            userMessage: userMsg.trim(),
            aiResponse: aiResp.trim(),
            rating,
          },
        });
        toast.success("Contoh percakapan diperbarui");
      } else {
        await fnCreate({
          data: {
            userMessage: userMsg.trim(),
            aiResponse: aiResp.trim(),
            accepted: rating === "good",
          },
        });
        toast.success("Contoh percakapan disimpan");
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[900px] lg:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Contoh Percakapan" : "Tambah Contoh Percakapan"}
          </DialogTitle>
          <DialogDescription>
            Tulis pasangan pesan tamu dan respons ideal AI. Tandai sebagai{" "}
            <strong>Baik</strong> agar AI menggunakannya sebagai dasar jawaban.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* User message */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Pesan Tamu</label>
            <Textarea
              rows={3}
              placeholder="Contoh: Halo kak, kamar deluxe ada yang kosong besok?"
              value={userMsg}
              onChange={(e) => setUserMsg(e.target.value)}
            />
          </div>

          {/* AI response */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Respons AI (ideal)</label>
            <Textarea
              rows={5}
              placeholder="Contoh: Halo Kak! Untuk kamar Deluxe, kami cek dulu ketersediaannya ya..."
              value={aiResp}
              onChange={(e) => setAiResp(e.target.value)}
            />
          </div>

          {/* Rating */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Penilaian</label>
            <div className="flex gap-3">
              {(
                [
                  { value: "good", label: "Baik", icon: ThumbsUp, cls: "text-emerald-700 border-emerald-300 bg-emerald-50" },
                  { value: "bad", label: "Buruk", icon: ThumbsDown, cls: "text-red-700 border-red-300 bg-red-50" },
                ] as const
              ).map(({ value, label, icon: Icon, cls }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRating(rating === value ? null : value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition",
                    rating === value ? cls : "border-border text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              {rating && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Menyimpan...
              </>
            ) : isEdit ? (
              "Simpan Perubahan"
            ) : (
              "Tambah"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Training view                                                        */
/* ------------------------------------------------------------------ */

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "good", label: "Baik" },
  { key: "bad", label: "Buruk" },
  { key: "unrated", label: "Belum Dinilai" },
];

export function TrainingView() {
  const fnList = useServerFn(listConversationLogs);
  const fnDelete = useServerFn(deleteConversationLog);
  const qc = useQueryClient();

  const [filter, setFilter] = React.useState<FilterTab>("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<LogRow | null>(null);
  const [deleteCtx, setDeleteCtx] = React.useState<LogRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["training-logs", filter],
    queryFn: () => fnList({ data: { rating: filter } }),
  });
  const logs = (data?.logs ?? []) as LogRow[];

  const deleteMut = useMutation({
    mutationFn: (id: string) => fnDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Contoh percakapan dihapus");
      qc.invalidateQueries({ queryKey: ["training-logs"] });
      setDeleteCtx(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["training-logs"] });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Training Percakapan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kelola contoh pasangan pesan tamu dan respons ideal AI. Contoh yang dinilai{" "}
              <strong>Baik</strong> digunakan sebagai dasar jawaban chatbot.
            </p>
          </div>
          <Button size="sm" className="gap-2 shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Tambah Contoh
          </Button>
        </header>

        {/* Filter tabs */}
        <div className="mb-5 flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                filter === tab.key
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Memuat data...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              {filter === "all"
                ? "Belum ada contoh percakapan."
                : "Tidak ada contoh dengan filter ini."}
            </p>
            {filter === "all" && (
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Tambah Contoh Pertama
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-xl border border-border bg-white p-4 transition hover:border-stone-300"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <RatingBadge rating={log.rating} />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(log.created_at)}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* User message */}
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
                      Pesan Tamu
                    </p>
                    <p className="line-clamp-4 text-sm text-stone-700">
                      {log.user_message ?? "-"}
                    </p>
                  </div>

                  {/* AI response */}
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-400">
                      Respons AI
                    </p>
                    <p className="line-clamp-4 text-sm text-stone-700">
                      {log.ai_response ?? "-"}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs"
                    onClick={() => setEditCtx(log)}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2.5 text-xs text-destructive hover:text-destructive"
                    onClick={() => setDeleteCtx(log)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Hapus
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <ExampleDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          invalidate();
          setCreateOpen(false);
        }}
      />

      {/* Edit dialog */}
      <ExampleDialog
        open={!!editCtx}
        initial={editCtx}
        onClose={() => setEditCtx(null)}
        onSaved={() => {
          invalidate();
          setEditCtx(null);
        }}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteCtx} onOpenChange={(o) => !o && setDeleteCtx(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Hapus contoh percakapan?</DialogTitle>
            <DialogDescription>
              Tindakan ini permanen dan tidak bisa dibatalkan.
            </DialogDescription>
          </DialogHeader>
          {deleteCtx && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              <p className="line-clamp-2">{deleteCtx.user_message}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteCtx(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteCtx && deleteMut.mutate(deleteCtx.id)}
            >
              {deleteMut.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
