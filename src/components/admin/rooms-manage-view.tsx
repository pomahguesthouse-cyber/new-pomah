
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listRooms, updateRoomStatus } from "@/lib/bookings.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = ["clean", "dirty", "maintenance", "out_of_order"] as const;
const COLORS: Record<string, string> = {
  clean: "bg-accent/15 text-accent",
  dirty: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  out_of_order: "bg-destructive/15 text-destructive",
};

export function RoomsManageView() {
  const fn = useServerFn(listRooms);
  const update = useServerFn(updateRoomStatus);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["rooms"], queryFn: () => fn() });
  useRealtimeInvalidate("admin-rooms-stream", ["rooms", "room_types"], [["rooms"]]);
  const mut = useMutation({
    mutationFn: (v: { id: string; status: typeof STATUSES[number] }) => update({ data: v }),
    onSuccess: () => {
      toast.success("Room updated");
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Housekeeping</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Rooms</h1>
      </header>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.rooms.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-2xl font-semibold">#{r.number}</p>
              <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${COLORS[r.status]}`}>
                {r.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{r.room_types?.name}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              ${Number(r.room_types?.base_rate ?? 0).toFixed(0)}/n · sleeps {r.room_types?.capacity}
            </p>
            <div className="mt-4">
              <Select
                value={r.status}
                onValueChange={(v) => mut.mutate({ id: r.id, status: v as typeof STATUSES[number] })}
              >
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
