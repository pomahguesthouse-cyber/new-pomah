import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, CheckCircle2, XCircle, Clock, Layers, ExternalLink, Send, Loader2 } from "lucide-react";

import {
  listBookingFormSendLogs,
  resendBookingFormLink,
  type BookingFormSendLog,
  type BookingFormSendStatus,
} from "@/admin/functions/booking-form-logs.functions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateID } from "@/lib/utils";

export const Route = createFileRoute("/admin/booking-form-logs")({
  component: BookingFormLogsPage,
});

const STATUS_OPTIONS: ReadonlyArray<BookingFormSendStatus> = [
  "pending",
  "sent",
  "failed",
  "superseded",
];

const statusBadge: Record<BookingFormSendStatus, { cls: string; label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pending: { cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", label: "Pending", Icon: Clock },
  sent: { cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", label: "Terkirim", Icon: CheckCircle2 },
  failed: { cls: "bg-rose-500/15 text-rose-700 border-rose-500/30", label: "Gagal", Icon: XCircle },
  superseded: { cls: "bg-muted text-muted-foreground border-border", label: "Superseded", Icon: Layers },
};

function BookingFormLogsPage() {
  const listFn = useServerFn(listBookingFormSendLogs);
  const resendFn = useServerFn(resendBookingFormLink);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"all" | BookingFormSendStatus>("all");
  const [phone, setPhone] = useState("");
  const [phoneFilter, setPhoneFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["booking-form-send-logs", status, phoneFilter],
    queryFn: () =>
      listFn({
        data: {
          status,
          phone: phoneFilter || undefined,
          limit: 200,
        },
      }),
  });
  const logs = data?.logs ?? [];

  const resendMutation = useMutation({
    mutationFn: (logId: string) => resendFn({ data: { logId } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Tautan baru terkirim via WhatsApp.");
      } else {
        toast.error(`Gagal kirim ulang: ${res.error ?? "unknown"}`);
      }
      queryClient.invalidateQueries({ queryKey: ["booking-form-send-logs"] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Gagal kirim ulang.");
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Link2 className="h-5 w-5 text-sky-600" />
            Log pengiriman form booking
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Audit setiap upaya chatbot mengirim tautan form booking via WhatsApp:
            berhasil, gagal, waktu kirim, dan alasan kegagalan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={phone}
            placeholder="Cari nomor…"
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setPhoneFilter(phone.trim());
            }}
            className="w-44"
          />
          <Button size="sm" variant="outline" onClick={() => setPhoneFilter(phone.trim())}>
            Cari
          </Button>
          <Select value={status} onValueChange={(v) => setStatus(v as "all" | BookingFormSendStatus)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusBadge[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Memuat…</Card>
      )}

      {!isLoading && logs.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Belum ada log untuk filter ini.
        </Card>
      )}

      <div className="space-y-2">
        {logs.map((log: BookingFormSendLog) => {
          const meta = statusBadge[log.status];
          return (
            <Card key={log.id} className="p-3 md:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{log.phone}</span>
                <Badge variant="outline" className={meta.cls}>
                  <meta.Icon className="mr-1 h-3 w-3" />
                  {meta.label}
                </Badge>
                {log.attempts > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {log.attempts}× attempt
                  </Badge>
                )}
                {log.room_type_name && (
                  <Badge variant="outline" className="text-[10px]">
                    {log.room_type_name}
                  </Badge>
                )}
                {log.check_in && log.check_out && (
                  <Badge variant="outline" className="text-[10px]">
                    {log.check_in} → {log.check_out}
                  </Badge>
                )}
                {log.booking_id && (
                  <Badge variant="outline" className="text-[10px]">
                    Booking #{log.booking_id.slice(0, 8)}
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatDateID(log.created_at)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <a
                  href={log.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 break-all text-sky-700 hover:underline"
                >
                  {log.url}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <span className="font-mono text-[10px]">token {log.token.slice(0, 10)}…</span>
                {log.sent_at && <span>Dikirim {formatDateID(log.sent_at)}</span>}
              </div>

              {log.failure_reason && (
                <p className="mt-2 rounded-md bg-rose-500/10 p-2 text-xs text-rose-700">
                  Alasan gagal: {log.failure_reason}
                </p>
              )}

              {(log.status === "failed" || log.status === "superseded") && (
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      resendMutation.isPending && resendMutation.variables === log.id
                    }
                    onClick={() => resendMutation.mutate(log.id)}
                  >
                    {resendMutation.isPending && resendMutation.variables === log.id ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-3 w-3" />
                    )}
                    Resend WA
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
