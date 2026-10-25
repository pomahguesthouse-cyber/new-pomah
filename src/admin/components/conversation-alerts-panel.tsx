import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bell, CheckCircle2, MessageCircle, ShieldAlert, XCircle } from "lucide-react";
import {
  dismissConversationAlert,
  getConversationAlerts,
} from "@/admin/functions/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeDateID } from "@/lib/utils";

type Alert = {
  id: string;
  thread_id?: string | null;
  title?: string | null;
  message?: string | null;
  severity?: string | null;
  status?: string | null;
  created_at?: string | null;
};

/** Alert percakapan WhatsApp (dulu tab Monitor di halaman WhatsApp). */
export function ConversationAlertsPanel() {
  const alertsFn = useServerFn(getConversationAlerts);
  const dismissFn = useServerFn(dismissConversationAlert);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({ queryKey: ["conv-alerts"], queryFn: () => alertsFn() });
  const all = ((data?.alerts ?? []) as Alert[]);
  const open = all.filter((a) => a.status === "open");
  const history = all.filter((a) => a.status !== "open");

  const dismissMut = useMutation({
    mutationFn: (p: { alertId: string; status: "handled" | "dismissed" }) => dismissFn({ data: p }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conv-alerts"] });
      toast.success("Alert diselesaikan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const openThread = (id: string) => void navigate({ to: "/admin/whatsapp", search: { thread: id } });

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Bell className="h-4 w-4 text-rose-600 dark:text-rose-400" />
        Alert percakapan WhatsApp
        {open.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-100 px-1.5 text-[11px] font-bold text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
            {open.length}
          </span>
        )}
      </h2>
      <div className="mt-3 space-y-2">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Memuat…</p>
        ) : open.length === 0 ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Semua percakapan aman, tidak ada alert aktif.
          </p>
        ) : (
          open.map((a) => (
            <AlertItem
              key={a.id}
              alert={a}
              onOpenThread={openThread}
              onHandled={(id) => dismissMut.mutate({ alertId: id, status: "handled" })}
              onDismissed={(id) => dismissMut.mutate({ alertId: id, status: "dismissed" })}
              pending={dismissMut.isPending}
            />
          ))
        )}
        {history.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Riwayat ({history.length})
            </summary>
            <div className="mt-2 space-y-2">
              {history.slice(0, 20).map((a) => (
                <AlertItem key={a.id} alert={a} onOpenThread={openThread} readonly />
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

function AlertItem({
  alert,
  onOpenThread,
  onHandled,
  onDismissed,
  pending,
  readonly,
}: {
  alert: Alert;
  onOpenThread: (threadId: string) => void;
  onHandled?: (id: string) => void;
  onDismissed?: (id: string) => void;
  pending?: boolean;
  readonly?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="break-words font-medium">{alert.title ?? "Alert"}</div>
          {alert.message && <p className="mt-0.5 line-clamp-3 break-words text-muted-foreground">{alert.message}</p>}
          {alert.created_at && (
            <div className="mt-1 text-[10px] text-muted-foreground">{formatRelativeDateID(alert.created_at)}</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {alert.thread_id && (
          <Button size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => onOpenThread(alert.thread_id!)}>
            <MessageCircle className="mr-1 h-3 w-3" /> Buka chat
          </Button>
        )}
        {!readonly && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-[11px]" disabled={pending} onClick={() => onHandled?.(alert.id)}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> Ditangani
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-[11px]" disabled={pending} onClick={() => onDismissed?.(alert.id)}>
              <XCircle className="mr-1 h-3 w-3" /> Abaikan
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
