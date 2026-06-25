import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LifeBuoy, CheckCircle2, Pencil, XCircle, Archive } from "lucide-react";

import {
  listHandoffTickets,
  updateHandoffTicket,
  type HandoffStatus,
  type HandoffTicket,
} from "@/admin/functions/handoff.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { formatDateID } from "@/lib/utils";

export const Route = createFileRoute("/admin/handoff")({
  component: HandoffPage,
});

const STATUS_OPTIONS: ReadonlyArray<HandoffStatus> = [
  "open",
  "approved",
  "adjusted",
  "cancelled",
  "resolved",
];

const statusColor: Record<HandoffStatus, string> = {
  open: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  approved: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  adjusted: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  resolved: "bg-sky-500/15 text-sky-700 border-sky-500/30",
};

function scoreBadgeClass(score: number): string {
  if (score >= 60) return "bg-rose-500/15 text-rose-700 border-rose-500/30";
  if (score >= 30) return "bg-amber-500/15 text-amber-700 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

const QUICK_ACTIONS: Array<{
  status: HandoffStatus;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { status: "approved", label: "Approve booking", icon: CheckCircle2 },
  { status: "adjusted", label: "Adjust", icon: Pencil },
  { status: "cancelled", label: "Cancel", icon: XCircle },
  { status: "resolved", label: "Tutup tiket", icon: Archive },
];

function HandoffPage() {
  const listFn = useServerFn(listHandoffTickets);
  const updateFn = useServerFn(updateHandoffTicket);
  const qc = useQueryClient();

  const [filter, setFilter] = useState<"all" | HandoffStatus>("open");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["handoff-tickets", filter],
    queryFn: () => listFn({ data: { status: filter, limit: 100 } }),
  });
  const tickets = data?.tickets ?? [];

  const mut = useMutation({
    mutationFn: (p: { id: string; status: HandoffStatus; resolutionNote?: string }) =>
      updateFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoff-tickets"] });
      toast.success("Tiket diperbarui");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <LifeBuoy className="h-5 w-5 text-rose-600" />
            Human handoff
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tiket dibuat otomatis saat bot mendeteksi tamu frustrasi atau ragu. Tinjau
            ringkasan booking dan jalankan aksi cepat.
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as "all" | HandoffStatus)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Memuat…</Card>
      )}

      {!isLoading && tickets.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Tidak ada tiket pada filter ini.
        </Card>
      )}

      <div className="space-y-3">
        {tickets.map((t: HandoffTicket) => (
          <Card key={t.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{t.phone}</span>
              <Badge variant="outline" className={statusColor[t.status]}>
                {t.status}
              </Badge>
              <Badge variant="outline" className={scoreBadgeClass(t.frustration_score)}>
                Skor {t.frustration_score}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {t.frustration_kind}
              </Badge>
              {t.booking_code && (
                <Badge variant="outline" className="text-[10px]">
                  {t.booking_code}
                </Badge>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {formatDateID(t.created_at)}
              </span>
            </div>

            {t.booking_summary && (
              <p className="mt-2 text-sm text-foreground">{t.booking_summary}</p>
            )}

            <p className="mt-2 rounded-md bg-muted/40 p-2 text-xs italic text-muted-foreground">
              Pemicu: &ldquo;{t.trigger_message}&rdquo;
            </p>

            <Textarea
              placeholder="Catatan tindak lanjut (opsional)"
              defaultValue={t.resolution_note ?? ""}
              onChange={(e) =>
                setNotesMap((m) => ({ ...m, [t.id]: e.target.value }))
              }
              className="mt-3 text-sm"
              rows={2}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_ACTIONS.filter((a) => a.status !== t.status).map((a) => (
                <Button
                  key={a.status}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    mut.mutate({
                      id: t.id,
                      status: a.status,
                      resolutionNote: notesMap[t.id] ?? t.resolution_note ?? undefined,
                    })
                  }
                  disabled={mut.isPending}
                >
                  <a.icon className="mr-1.5 h-3.5 w-3.5" />
                  {a.label}
                </Button>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
