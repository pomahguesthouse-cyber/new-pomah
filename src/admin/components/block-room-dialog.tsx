/**
 * Dialog "Blokir Kamar" untuk kalender admin.
 *
 * Sumber kebenaran ketersediaan adalah `room_daily_rates.stop_sell` — sama
 * seperti tool `block_room` di kanal WhatsApp/Telegram — jadi dialog ini
 * menulis lewat server fn `upsertDailyRates` agar semua kanal konsisten.
 */

import * as React from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { toast } from "sonner";

import { upsertDailyRates } from "@/admin/modules/pricing-calendar/pricing-calendar.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RoomTypeOption {
  id: string;
  name: string;
}

interface BlockRoomDialogProps {
  open: boolean;
  roomTypes: RoomTypeOption[];
  /** Tanggal awal default (YYYY-MM-DD). */
  defaultDate?: string;
  onClose: () => void;
  onSaved?: () => void;
}

const MAX_DAYS = 366;

function isoToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Bangun daftar tanggal inklusif dari start s/d end. */
function buildDates(start: string, end: string): string[] {
  const a = parseISO(start);
  const b = parseISO(end);
  const span = differenceInCalendarDays(b, a);
  if (Number.isNaN(span) || span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => format(addDays(a, i), "yyyy-MM-dd"));
}

export function BlockRoomDialog({
  open,
  roomTypes,
  defaultDate,
  onClose,
  onSaved,
}: BlockRoomDialogProps) {
  const [roomTypeId, setRoomTypeId] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(defaultDate ?? isoToday());
  const [endDate, setEndDate] = React.useState<string>(defaultDate ?? isoToday());
  const [reason, setReason] = React.useState<string>("");
  const [mode, setMode] = React.useState<"block" | "unblock">("block");

  // Reset form setiap kali dialog dibuka agar tidak membawa state lama.
  React.useEffect(() => {
    if (!open) return;
    setRoomTypeId(roomTypes[0]?.id ?? "");
    setStartDate(defaultDate ?? isoToday());
    setEndDate(defaultDate ?? isoToday());
    setReason("");
    setMode("block");
  }, [open, defaultDate, roomTypes]);

  const upsert = useServerFn(upsertDailyRates);
  const mutation = useMutation({
    mutationFn: async () => {
      const dates = buildDates(startDate, endDate);
      if (dates.length === 0) throw new Error("Tanggal akhir tidak boleh sebelum tanggal mulai.");
      if (dates.length > MAX_DAYS) throw new Error(`Rentang maksimal ${MAX_DAYS} hari.`);
      if (!roomTypeId) throw new Error("Pilih tipe kamar dulu.");
      return upsert({
        data: {
          room_type_id: roomTypeId,
          dates,
          stop_sell: mode === "block",
          note: reason.trim()
            ? reason.trim()
            : mode === "block"
              ? "Diblokir dari kalender admin"
              : null,
        },
      });
    },
    onSuccess: () => {
      const dates = buildDates(startDate, endDate);
      toast.success(
        mode === "block"
          ? `Kamar diblokir untuk ${dates.length} hari.`
          : `Blokir dilepas untuk ${dates.length} hari.`,
      );
      onSaved?.();
      onClose();
    },
    onError: (e: unknown) => {
      toast.error((e as Error).message ?? "Gagal menyimpan blokir kamar.");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Blokir kamar</DialogTitle>
          <DialogDescription>
            Tipe kamar yang diblokir tidak akan ditawarkan chatbot WhatsApp, Telegram,
            maupun form booking pada rentang tanggal ini.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tindakan</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "block" | "unblock")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">Blokir (stop sell)</SelectItem>
                <SelectItem value="unblock">Lepas blokir</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tipe kamar</Label>
            <Select value={roomTypeId} onValueChange={setRoomTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih tipe kamar" />
              </SelectTrigger>
              <SelectContent>
                {roomTypes.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>
                    {rt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="block-start">Mulai</Label>
              <Input
                id="block-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="block-end">Sampai</Label>
              <Input
                id="block-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="block-reason">Alasan</Label>
            <Textarea
              id="block-reason"
              rows={2}
              placeholder="Misalnya: AC rusak, renovasi, dipakai keluarga"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Batal
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Menyimpan…" : mode === "block" ? "Blokir kamar" : "Lepas blokir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
