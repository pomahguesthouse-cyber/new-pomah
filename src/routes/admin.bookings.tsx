import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listBookings, updateBookingStatus } from "@/lib/bookings.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/bookings")({
  component: BookingsPage,
});

const STATUSES = ["pending", "confirmed", "checked_in", "checked_out", "cancelled"] as const;

function BookingsPage() {
  const fn = useServerFn(listBookings);
  const update = useServerFn(updateBookingStatus);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["bookings"], queryFn: () => fn() });

  const mut = useMutation({
    mutationFn: (vars: { id: string; status: typeof STATUSES[number] }) =>
      update({ data: vars }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Reservations</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Bookings</h1>
      </header>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>}
            {data?.bookings.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{b.guests?.full_name}</p>
                  <p className="text-xs text-muted-foreground">{b.guests?.email}</p>
                </td>
                <td className="px-4 py-3">{b.room_types?.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{b.check_in} → {b.check_out}</td>
                <td className="px-4 py-3"><Badge variant="outline">{b.source}</Badge></td>
                <td className="px-4 py-3 font-mono">${Number(b.total_amount).toFixed(0)}</td>
                <td className="px-4 py-3">
                  <Select
                    value={b.status}
                    onValueChange={(v) => mut.mutate({ id: b.id, status: v as typeof STATUSES[number] })}
                  >
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
