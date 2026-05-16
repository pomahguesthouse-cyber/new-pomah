import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, BedDouble } from "lucide-react";

import {
  listRooms,
  updateRoomStatus,
  listRoomTypes,
  deleteRoom,
  deleteRoomType,
} from "@/admin/functions/bookings.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoomDetailDialog, type RoomDetailRow } from "@/admin/components/room-detail-dialog";
import { RoomTypeDialog, type ManagedRoomType } from "@/admin/components/room-type-dialog";

const STATUSES = ["clean", "dirty", "maintenance", "out_of_order"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  clean: "Bersih",
  dirty: "Kotor",
  maintenance: "Perawatan",
  out_of_order: "Tidak Aktif",
};
const COLORS: Record<string, string> = {
  clean: "bg-accent/15 text-accent",
  dirty: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  out_of_order: "bg-destructive/15 text-destructive",
};

type RoomStatus = (typeof STATUSES)[number];
type RoomRow = RoomDetailRow;

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", "Rp");

/** Short uppercase prefix from a room type name (initials of each word). */
function roomTypePrefix(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Trailing run of digits in a room number ("FS-100" -> 100), or null. */
function trailingNumber(value: string): number | null {
  const m = value.match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}

export function RoomsManageView() {
  const fnList = useServerFn(listRooms);
  const fnTypes = useServerFn(listRoomTypes);
  const fnUpdateStatus = useServerFn(updateRoomStatus);
  const fnDelete = useServerFn(deleteRoom);
  const fnDeleteType = useServerFn(deleteRoomType);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["rooms"], queryFn: () => fnList() });
  const { data: typesData } = useQuery({
    queryKey: ["room-types"],
    queryFn: () => fnTypes(),
  });
  const roomTypes = React.useMemo(() => typesData?.roomTypes ?? [], [typesData]);

  useRealtimeInvalidate("admin-rooms-stream", ["rooms", "room_types"], [["rooms"], ["room-types"]]);

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: RoomStatus }) => fnUpdateStatus({ data: v }),
    onSuccess: () => {
      toast.success("Status kamar diperbarui");
      qc.invalidateQueries({ queryKey: ["rooms"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fnDelete({ data: { id } }),
    onSuccess: () => {
      toast.success("Kamar dihapus");
      qc.invalidateQueries({ queryKey: ["rooms"] });
      setDeleteCtx(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteTypeMut = useMutation({
    mutationFn: (id: string) => fnDeleteType({ data: { id } }),
    onSuccess: () => {
      toast.success("Tipe kamar dihapus");
      qc.invalidateQueries({ queryKey: ["room-types"] });
      qc.invalidateQueries({ queryKey: ["rooms"] });
      setTypeDeleteCtx(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<RoomRow | null>(null);
  const [deleteCtx, setDeleteCtx] = React.useState<RoomRow | null>(null);

  const [typeCreateOpen, setTypeCreateOpen] = React.useState(false);
  const [typeEditCtx, setTypeEditCtx] = React.useState<ManagedRoomType | null>(null);
  const [typeDeleteCtx, setTypeDeleteCtx] = React.useState<ManagedRoomType | null>(null);

  const rooms = React.useMemo(() => (data?.rooms ?? []) as RoomRow[], [data]);

  /**
   * Suggest the next room number for a type: "<PREFIX>-<n>", where the
   * prefix comes from the type name and n is one past the highest
   * existing number of that type. Falls back to 101 when the type is
   * still empty. The suggestion is editable in the form.
   */
  const suggestRoomNumber = React.useCallback(
    (typeId: string): string => {
      const type = roomTypes.find((t) => t.id === typeId);
      if (!type) return "";
      const prefix = roomTypePrefix(type.name);
      const used = rooms
        .filter((r) => (r.room_types?.id ?? r.room_type_id) === typeId)
        .map((r) => trailingNumber(r.number))
        .filter((n): n is number => n != null);
      const next = used.length ? Math.max(...used) + 1 : 101;
      return prefix ? `${prefix}-${next}` : String(next);
    },
    [roomTypes, rooms],
  );

  const invalidateTypes = () => {
    qc.invalidateQueries({ queryKey: ["room-types"] });
    qc.invalidateQueries({ queryKey: ["rooms"] });
  };

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Housekeeping
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Kamar</h1>
      </header>

      {/* ---------------- Room types ---------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Tipe Kamar</h2>
            <p className="text-xs text-muted-foreground">
              Detail bersama (tarif, kasur, kapasitas) untuk setiap kategori kamar.
            </p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setTypeCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Tambah Tipe Kamar
          </Button>
        </div>

        {roomTypes.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Belum ada tipe kamar. Klik <strong>Tambah Tipe Kamar</strong> untuk membuat yang
            pertama.
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
      </section>

      {/* ---------------- Rooms ---------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Daftar Kamar</h2>
            <p className="text-xs text-muted-foreground">
              Setiap kamar fisik dan status kebersihannya.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={roomTypes.length === 0}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Tambah Kamar
          </Button>
        </div>

        {rooms.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {roomTypes.length === 0 ? (
              <>Tambah tipe kamar dulu, lalu buat kamar.</>
            ) : (
              <>
                Belum ada kamar. Klik <strong>Tambah Kamar</strong> untuk membuat yang pertama.
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {roomTypes.map((rt) => {
              const typeRooms = rooms
                .filter((r) => (r.room_types?.id ?? r.room_type_id) === rt.id)
                .sort((a, b) => {
                  const na = trailingNumber(a.number) ?? 0;
                  const nb = trailingNumber(b.number) ?? 0;
                  return na - nb || a.number.localeCompare(b.number);
                });
              return (
                <div key={rt.id} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-base font-semibold">{rt.name}</h3>
                      <span className="font-mono text-xs text-muted-foreground">
                        {typeRooms.length} kamar
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {roomTypePrefix(rt.name) || "—"}
                    </span>
                  </div>

                  {typeRooms.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                      Belum ada kamar untuk tipe ini.
                    </p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {typeRooms.map((r) => (
                        <Card key={r.id} className="p-5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-mono text-2xl font-semibold">#{r.number}</p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground">
                                {formatIDR(Number(r.room_types?.base_rate ?? 0))}/malam ·{" "}
                                {r.room_types?.capacity ?? 0} tamu
                              </p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${COLORS[r.status]}`}
                            >
                              {STATUS_LABEL[r.status]}
                            </span>
                          </div>

                          {r.notes && (
                            <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                              {r.notes}
                            </p>
                          )}

                          <div className="mt-4">
                            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              Status
                            </Label>
                            <Select
                              value={r.status}
                              onValueChange={(v) =>
                                statusMut.mutate({ id: r.id, status: v as RoomStatus })
                              }
                            >
                              <SelectTrigger className="mt-1 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUSES.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {STATUS_LABEL[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="mt-4 flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 gap-1.5"
                              onClick={() => setEditCtx(r)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              onClick={() => setDeleteCtx(r)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Hapus
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------------- Room type dialogs ---------------- */}
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

      {/* ---------------- Room dialogs ---------------- */}
      <RoomDetailDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roomTypes={roomTypes}
        suggestNumber={suggestRoomNumber}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["rooms"] });
          qc.invalidateQueries({ queryKey: ["room-types"] });
          setCreateOpen(false);
        }}
      />

      <RoomDetailDialog
        mode="edit"
        open={!!editCtx}
        room={editCtx}
        onClose={() => setEditCtx(null)}
        roomTypes={roomTypes}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["rooms"] });
          qc.invalidateQueries({ queryKey: ["room-types"] });
          setEditCtx(null);
        }}
      />

      <Dialog open={!!deleteCtx} onOpenChange={(o) => !o && setDeleteCtx(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Hapus kamar #{deleteCtx?.number}?</DialogTitle>
            <DialogDescription>
              Tindakan ini permanen. Kamar yang masih punya booking aktif tidak bisa dihapus.
            </DialogDescription>
          </DialogHeader>
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
