import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, RefreshCw, ExternalLink } from "lucide-react";
import { getNotificationLogs } from "@/admin/modules/settings/settings.functions";

export const Route = createFileRoute("/admin/notifications")({
  component: NotificationsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-red-600">Gagal memuat log: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Halaman tidak ditemukan.</div>,
});

const EVENT_LABEL: Record<string, { label: string; color: string }> = {
  new_booking: { label: "Booking Baru", color: "bg-green-100 text-green-700" },
  payment_proof: { label: "Bukti Pembayaran", color: "bg-blue-100 text-blue-700" },
  complaint: { label: "Komplain", color: "bg-red-100 text-red-700" },
  booking_modified: { label: "Booking Diubah", color: "bg-amber-100 text-amber-700" },
  booking_cancelled: { label: "Booking Dibatalkan", color: "bg-gray-200 text-gray-700" },
  new_session: { label: "Sesi Baru", color: "bg-indigo-100 text-indigo-700" },
  bot_loop: { label: "Bot Loop", color: "bg-orange-100 text-orange-700" },
  zombie_timeout: { label: "Zombie Worker", color: "bg-rose-100 text-rose-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-green-100 text-green-700"
      : status === "failed"
      ? "bg-red-100 text-red-700"
      : "bg-yellow-100 text-yellow-700";
  return <Badge className={`${cls} border-0`}>{status}</Badge>;
}

function NotificationsPage() {
  const fn = useServerFn(getNotificationLogs);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["notification-logs"],
    queryFn: () => fn(),
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          <h1 className="text-2xl font-semibold">Log Notifikasi</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Semua notifikasi WhatsApp yang dikirim ke manager (booking baru, bukti pembayaran, komplain).
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : !data || data.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Belum ada notifikasi yang terkirim.
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((log) => {
            const meta = EVENT_LABEL[log.event_type] ?? {
              label: log.event_type,
              color: "bg-gray-100 text-gray-700",
            };
            return (
              <Card key={log.id} className="p-4">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={`${meta.color} border-0`}>{meta.label}</Badge>
                    <StatusBadge status={log.status} />
                    {log.recipient_role && (
                      <span className="text-xs text-muted-foreground">
                        {log.recipient_role}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      → {log.recipient_phone}
                    </span>
                    {log.attempts > 1 && (
                      <span className="text-xs text-amber-600">
                        {log.attempts}× attempts
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(log.created_at).toLocaleString("id-ID")}
                  </span>
                </div>
                <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/80 bg-muted/40 p-3 rounded">
                  {log.message}
                </pre>
                {log.attachment_url && (
                  <a
                    href={log.attachment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Lihat lampiran
                  </a>
                )}
                {log.error && (
                  <p className="text-xs text-red-600 mt-2">Error: {log.error}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
