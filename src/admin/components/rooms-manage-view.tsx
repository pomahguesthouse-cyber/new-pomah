import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, BedDouble } from "lucide-react";

import { listRoomTypes, deleteRoomType } from "@/admin/functions/bookings.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoomTypeDialog, type ManagedRoomType } from "@/admin/components/room-type-dialog";

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", "Rp");

/**
 * Room management — room types only.
 *
 * Each room type owns its room numbers, edited inside the room type
 * dialog; there is no separate per-room list.
 */
export function RoomsManageView() {
  const fnTypes = useServerFn(listRoomTypes);
  const fnDeleteType = useServerFn(deleteRoomType);
  const qc = useQueryClient();

  const { data: typesData } = useQuery({
    queryKey: ["room-types"],
    queryFn: () => fnTypes(),
  });
  const roomTypes = React.useMemo(() => typesData?.roomTypes ?? [], [typesData]);

  useRealtimeInvalidate("admin-rooms-stream", ["rooms", "room_types"], [["room-types"]]);

  const deleteTypeMut = useMutation({
    mutationFn: (id: string) => fnDeleteType({ data: { id } }),
    onSuccess: () => {
      toast.success("Tipe kamar dihapus");
      qc.invalidateQueries({ queryKey: ["room-types"] });
      setTypeDeleteCtx(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [typeCreateOpen, setTypeCreateOpen] = React.useState(false);
  const [typeEditCtx, setTypeEditCtx] = React.useState<ManagedRoomType | null>(null);
  const [typeDeleteCtx, setTypeDeleteCtx] = React.useState<ManagedRoomType | null>(null);

  const invalidateTypes = () => qc.invalidateQueries({ queryKey: ["room-types"] });

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Housekeeping
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Kamar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola tipe kamar beserta nomor kamarnya.
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setTypeCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Tambah Tipe Kamar
        </Button>
      </header>

      {roomTypes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Belum ada tipe kamar. Klik <strong>Tambah Tipe Kamar</strong> untuk membuat yang pertama.
        </div>
      ) : (
        <Card className="divide-y divide-border p-0">
          {roomTypes.map((rt) => (
            <div key={rt.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <BedDouble className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{rt.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {formatIDR(Number(rt.base_rate ?? 0))}/malam · {rt.capacity ?? 0} tamu
                    {rt.bed_type ? ` · ${rt.bed_type}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTypeEditCtx(rt)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setTypeDeleteCtx(rt)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Hapus
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <RoomTypeDialog
        mode="create"
        open={typeCreateOpen}
        onClose={() => setTypeCreateOpen(false)}
        onSaved={() => {
          invalidateTypes();
          setTypeCreateOpen(false);
        }}
      />
      <RoomTypeDialog
        mode="edit"
        open={!!typeEditCtx}
        roomType={typeEditCtx}
        onClose={() => setTypeEditCtx(null)}
        onSaved={() => {
          invalidateTypes();
          setTypeEditCtx(null);
        }}
      />
      <Dialog open={!!typeDeleteCtx} onOpenChange={(o) => !o && setTypeDeleteCtx(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Hapus tipe kamar &ldquo;{typeDeleteCtx?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Tindakan ini permanen. Tipe kamar yang masih punya kamar atau booking tidak bisa
              dihapus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeDeleteCtx(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTypeMut.isPending}
              onClick={() => typeDeleteCtx && deleteTypeMut.mutate(typeDeleteCtx.id)}
            >
              {deleteTypeMut.isPending ? "Menghapus..." : "Hapus"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
