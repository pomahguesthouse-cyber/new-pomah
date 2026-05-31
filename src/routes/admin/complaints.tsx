import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import { listComplaints, updateComplaintStatus } from "@/admin/modules/complaints/complaints.functions";
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

export const Route = createFileRoute("/admin/complaints")({
  component: ComplaintsPage,
});

const STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
type Status = (typeof STATUS)[number];

const statusColor: Record<Status, string> = {
  OPEN: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  IN_PROGRESS: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  RESOLVED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
};

function ComplaintsPage() {
  const listFn = useServerFn(listComplaints);
  const updateFn = useServerFn(updateComplaintStatus);
  const qc = useQueryClient();
  const { data: complaints = [] } = useQuery({
    queryKey: ["guest-complaints"],
    queryFn: () => listFn(),
  });

  const [filter, setFilter] = useState<"ALL" | Status>("ALL");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const mut = useMutation({
    mutationFn: (p: { id: string; status: Status; notes?: string }) =>
      updateFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guest-complaints"] });
      toast.success("Komplain diperbarui");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const filtered = complaints.filter((c: any) => filter === "ALL" || c.status === filter);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            Komplain tamu
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daftar keluhan tamu yang terdeteksi otomatis oleh AI. Perbarui status begitu sudah ditindaklanjuti.
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Semua status</SelectItem>
            {STATUS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Belum ada komplain pada filter ini.
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((c: any) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">
                    {c.guest_name ?? c.phone}
                  </p>
                  <span className="font-mono text-xs text-muted-foreground">{c.phone}</span>
                  <Badge variant="outline" className={statusColor[c.status as Status]}>
                    {c.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {c.category}
                  </Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatDateID(c.created_at)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                  "{c.message}"
                </p>
                <Textarea
                  placeholder="Catatan tindak lanjut (opsional)"
                  defaultValue={c.notes ?? ""}
                  onChange={(e) =>
                    setNotesMap((m) => ({ ...m, [c.id]: e.target.value }))
                  }
                  className="mt-3 text-sm"
                  rows={2}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {STATUS.filter((s) => s !== c.status).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mut.mutate({
                          id: c.id,
                          status: s,
                          notes: notesMap[c.id] ?? c.notes ?? undefined,
                        })
                      }
                    >
                      Tandai {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
