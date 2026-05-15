import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Pencil, Trash2, Plus } from "lucide-react";

import {
  listRooms,
  updateRoomStatus,
  listRoomTypes,
  createRoom,
  updateRoom,
  deleteRoom,
} from "@/lib/bookings.functions";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
type RoomRow = {
  id: string;
  number: string;
  status: RoomStatus;
  notes: string | null;
  room_type_id?: string;
  room_types?: { id: string; name: string; base_rate: number; capacity: number } | null;
};

const formatIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", "Rp");

export function RoomsManageView() {
  const fnList = useServerFn(listRooms);
  const fnTypes = useServerFn(listRoomTypes);
  const fnUpdateStatus = useServerFn(updateRoomStatus);
  const fnDelete = useServerFn(deleteRoom);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["rooms"], queryFn: () => fnList() });
  const { data: typesData } = useQuery({
    queryKey: ["room-types"],
    queryFn: () => fnTypes(),
  });
  const roomTypes = typesData?.roomTypes ?? [];

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

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editCtx, setEditCtx] = React.useState<RoomRow | null>(null);
  const [deleteCtx, setDeleteCtx] = React.useState<RoomRow | null>(null);

  const rooms = (data?.rooms ?? []) as RoomRow[];

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Housekeeping
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Kamar</h1>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={roomTypes.length === 0}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Tambah Kamar
        </Button>
      </header>

      {roomTypes.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          Belum ada tipe kamar. Tambah tipe kamar dulu di halaman Pricing sebelum membuat kamar.
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Belum ada kamar. Klik <strong>Tambah Kamar</strong> untuk membuat yang pertama.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-2xl font-semibold">#{r.number}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.room_types?.name ?? "—"}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {formatIDR(Number(r.room_types?.base_rate ?? 0))}/malam · {r.room_types?.capacity ?? 0} tamu
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${COLORS[r.status]}`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </div>

              {r.notes && (
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{r.notes}</p>
              )}

              <div className="mt-4">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Status
                </Label>
                <Select
                  value={r.status}
                  onValueChange={(v) => statusMut.mutate({ id: r.id, status: v as RoomStatus })}
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

      <RoomFormDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roomTypes={roomTypes}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["rooms"] });
          setCreateOpen(false);
        }}
      />

      <RoomFormDialog
        mode="edit"
        open={!!editCtx}
        room={editCtx}
        onClose={() => setEditCtx(null)}
        roomTypes={roomTypes}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["rooms"] });
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

function RoomFormDialog({
  mode,
  open,
  room,
  roomTypes,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  room?: RoomRow | null;
  roomTypes: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const fnCreate = useServerFn(createRoom);
  const fnUpdate = useServerFn(updateRoom);

  const [form, setForm] = React.useState({
    room_type_id: "",
    number: "",
    status: "clean" as RoomStatus,
    notes: "",
  });

  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && room) {
      setForm({
        room_type_id: room.room_type_id ?? room.room_types?.id ?? "",
        number: room.number,
        status: room.status,
        notes: room.notes ?? "",
      });
    } else {
      setForm({
        room_type_id: roomTypes[0]?.id ?? "",
        number: "",
        status: "clean",
        notes: "",
      });
    }
  }, [open, mode, room, roomTypes]);

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        room_type_id: form.room_type_id,
        number: form.number.trim(),
        status: form.status,
        notes: form.notes.trim() || null,
      };
      if (mode === "edit" && room) {
        return fnUpdate({ data: { ...payload, id: room.id } });
      }
      return fnCreate({ data: payload });
    },
    onSuccess: () => {
      toast.success(mode === "edit" ? "Kamar diperbarui" : "Kamar ditambahkan");
      onSaved();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const canSubmit = form.room_type_id && form.number.trim().length > 0 && !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? `Edit Kamar #${room?.number}` : "Tambah Kamar Baru"}</DialogTitle>
          <DialogDescription>
            Kombinasi tipe kamar + nomor kamar harus unik.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Tipe Kamar</Label>
            <Select
              value={form.room_type_id}
              onValueChange={(v) => setForm((f) => ({ ...f, room_type_id: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih tipe kamar" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Nomor Kamar</Label>
            <Input
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              placeholder="mis. 101, A-02"
              maxLength={20}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v as RoomStatus }))}
            >
              <SelectTrigger>
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

          <div className="space-y-1.5">
            <Label>Catatan (opsional)</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Catatan internal untuk staff…"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={!canSubmit} onClick={() => mut.mutate()}>
            {mut.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
