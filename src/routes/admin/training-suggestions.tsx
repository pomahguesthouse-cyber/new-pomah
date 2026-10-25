import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { GraduationCap, RefreshCw } from "lucide-react";

import {
  approveTrainingSuggestion,
  listTrainingSuggestions,
  rejectTrainingSuggestion,
  scanStaffReplies,
} from "@/admin/modules/training-suggestions/training-suggestions.functions";
import { approvalBlockers } from "@/services/training-suggestions/capture";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/training-suggestions")({
  component: TrainingSuggestionsPage,
});

type Status = "pending" | "approved" | "rejected";
const STATUS_LABEL: Record<Status, string> = { pending: "Menunggu", approved: "Disetujui", rejected: "Ditolak" };
const FLAG_LABEL: Record<string, string> = {
  price: "Ada harga — hapus",
  phone: "Nomor disamarkan",
  booking_code: "Kode booking disamarkan",
  guest_name: "Nama tamu disamarkan",
};

type Row = {
  id: string;
  guest_question: string;
  staff_answer: string;
  flags: string[];
  status: string;
  created_at: string;
};

function TrainingSuggestionsPage() {
  const listFn = useServerFn(listTrainingSuggestions);
  const scanFn = useServerFn(scanStaffReplies);
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("pending");
  const { data, isLoading } = useQuery({
    queryKey: ["training-suggestions", status],
    queryFn: () => listFn({ data: { status } }),
  });

  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["training-suggestions"] });
      if (r.created) toast.success(`${r.created} usulan baru dari balasan staf`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Pindai otomatis sekali saat halaman dibuka.
  useEffect(() => {
    scan.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data?.rows ?? []) as Row[];

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <GraduationCap className="h-5 w-5 shrink-0 text-emerald-600" />
          Belajar dari staf
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Usulan jawaban bot dari balasan staf di WhatsApp. Tidak ada yang dipakai bot sebelum disetujui. Harga tidak
          boleh ditulis di sini — bot selalu mengambil harga dari kalender harga.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <Button key={s} size="sm" variant={s === status ? "default" : "outline"} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={scan.isPending}
          onClick={() => scan.mutate()}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
          Pindai
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : rows.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">Belum ada usulan.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {rows.map((r) => (
            <SuggestionCard key={r.id} row={r} editable={status === "pending"} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ row, editable }: { row: Row; editable: boolean }) {
  const approveFn = useServerFn(approveTrainingSuggestion);
  const rejectFn = useServerFn(rejectTrainingSuggestion);
  const qc = useQueryClient();
  const [q, setQ] = useState(row.guest_question);
  const [a, setA] = useState(row.staff_answer);
  const blockers = approvalBlockers(q, a);
  const done = () => qc.invalidateQueries({ queryKey: ["training-suggestions"] });

  const approve = useMutation({
    mutationFn: () => approveFn({ data: { id: row.id, guestQuestion: q, staffAnswer: a } }),
    onSuccess: () => {
      done();
      toast.success("Disetujui — bot memakai jawaban ini dalam ±5 menit");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const reject = useMutation({
    mutationFn: () => rejectFn({ data: { id: row.id } }),
    onSuccess: () => {
      done();
      toast.success("Ditolak");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const busy = approve.isPending || reject.isPending;

  return (
    <Card className="min-w-0 space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString("id-ID")}</span>
        {row.flags.map((f) => (
          <Badge key={f} variant={f === "price" ? "destructive" : "outline"} className="text-[11px]">
            {FLAG_LABEL[f] ?? f}
          </Badge>
        ))}
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`q-${row.id}`}>Pertanyaan tamu</Label>
        <Textarea id={`q-${row.id}`} rows={2} value={q} disabled={!editable} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`a-${row.id}`}>Jawaban staf (akan jadi jawaban bot)</Label>
        <Textarea id={`a-${row.id}`} rows={4} value={a} disabled={!editable} onChange={(e) => setA(e.target.value)} />
      </div>
      {editable && blockers.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-destructive">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {editable ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => reject.mutate()}>
            Tolak
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={busy || blockers.length > 0}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? "Menyimpan…" : "Setujui"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
