import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDateID } from "@/lib/utils";
import {
  listThreadInvoiceBookings,
  sendThreadInvoice,
  type ThreadInvoiceBooking,
} from "@/admin/functions/wa-invoice-send.functions";
import { getBrandingSettings } from "@/admin/modules/settings/settings.functions";
import {
  createInvoicePdfBlob,
  invoicePdfFileName,
} from "@/admin/lib/invoice-pdf-client";
import { uploadOutboundObject } from "@/admin/modules/whatsapp/wa-outbound-upload";
import { buildOutboundObjectPath } from "@/services/wa-outbound-attachment";
import { formatRp } from "@/admin/modules/whatsapp/wa-invoice-message";

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "Menunggu",
    confirmed: "Dikonfirmasi",
    cancelled: "Dibatalkan",
    canceled: "Dibatalkan",
    checked_in: "Check-in",
    checked_out: "Check-out",
    expired: "Kadaluarsa",
    unpaid: "Belum bayar",
    partial: "DP",
    paid: "Lunas",
  };
  return map[status] || status || "—";
}

export function SendInvoiceDialog({
  threadId,
  open,
  onOpenChange,
  onSent,
}: {
  threadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const listFn = useServerFn(listThreadInvoiceBookings);
  const sendFn = useServerFn(sendThreadInvoice);
  const brandingFn = useServerFn(getBrandingSettings);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [attachPdf, setAttachPdf] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setSelectedId(null);
      setDraft("");
      setAttachPdf(true);
      setSending(false);
    }
  }, [open]);

  const listQuery = useQuery({
    queryKey: ["wa-thread-invoice-bookings", threadId, debounced],
    queryFn: () => listFn({ data: { threadId, q: debounced || undefined } }),
    enabled: open && !!threadId,
  });

  const { data: branding } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => brandingFn(),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const bookings = listQuery.data?.ok ? listQuery.data.bookings : [];
  const property = listQuery.data?.ok ? listQuery.data.property : null;
  const selected = useMemo(
    () => bookings.find((row) => row.id === selectedId) ?? null,
    [bookings, selectedId],
  );
  const appliedPreviewId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      appliedPreviewId.current = null;
      return;
    }
    if (selected && appliedPreviewId.current !== selected.id) {
      appliedPreviewId.current = selected.id;
      setDraft(selected.preview);
      return;
    }
    if (!selected && bookings.length === 1) {
      setSelectedId(bookings[0].id);
    }
  }, [open, bookings, selected]);

  const selectBooking = (row: ThreadInvoiceBooking) => {
    setSelectedId(row.id);
    setDraft(row.preview);
  };

  const send = async () => {
    if (!selected || sending) return;
    const body = draft.trim();
    if (!body) {
      toast.error("Pesan invoice tidak boleh kosong.");
      return;
    }
    setSending(true);
    try {
      let attachment:
        | { path: string; name: string; mime: string; size: number }
        | undefined;
      if (attachPdf) {
        try {
          const fileName = invoicePdfFileName(selected.invoice_booking);
          const blob = await createInvoicePdfBlob({
            booking: selected.invoice_booking,
            logoUrl: branding?.invoice_logo_url || branding?.logo_url,
            propertyName: property?.name,
            propertyAddress: property?.address,
            propertyPhone: property?.phone,
            propertyWebsite: property?.website,
            fileName,
          });
          const path = buildOutboundObjectPath(threadId, fileName);
          const upload = uploadOutboundObject(path, blob, "application/pdf", () => {});
          await upload.promise;
          attachment = { path, name: fileName, mime: "application/pdf", size: blob.size };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gagal membuat PDF invoice";
          toast.error(`${message}. Invoice tetap bisa dikirim tanpa lampiran PDF.`);
          setAttachPdf(false);
          setSending(false);
          return;
        }
      }

      const res = await sendFn({
        data: {
          threadId,
          bookingId: selected.id,
          body,
          attachment,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.delivery === "document" ? "Invoice terkirim (dengan PDF)" : "Invoice terkirim");
      onSent();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invoice gagal dikirim. Coba lagi.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[95vh] w-[min(560px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-4 sm:max-w-[560px] sm:p-6">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Kirim Invoice</DialogTitle>
          <DialogDescription>
            Pilih booking terkait percakapan ini, atau cari berdasarkan kode booking. Pesan bisa
            diedit sebelum dikirim. Status booking dan pembayaran tidak diubah.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari kode booking, misalnya PG-ZTBVY"
            className="pl-9"
            autoComplete="off"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
          {listQuery.isPending ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat booking…
            </p>
          ) : listQuery.data && !listQuery.data.ok ? (
            <p className="py-4 text-sm text-destructive">{listQuery.data.error}</p>
          ) : bookings.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Tidak ada booking terkait nomor ini. Cari dengan kode booking.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {bookings.map((row) => {
                const active = row.id === selectedId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => selectBooking(row)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "border-[#0e7490] bg-[#0e7490]/10"
                          : "border-border hover:bg-muted/60",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{row.reference_code}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {statusLabel(row.status)} · {statusLabel(row.payment_status)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {row.room_label} · {formatDateID(row.check_in)}–{formatDateID(row.check_out)} ·{" "}
                        {formatRp(row.total_amount)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selected && (
            <div className="space-y-2">
              <label htmlFor="wa-invoice-preview" className="text-sm font-medium">
                Pratinjau pesan
              </label>
              <Textarea
                id="wa-invoice-preview"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={11}
                className="min-h-40 text-sm"
              />
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={attachPdf}
                  disabled={sending}
                  onChange={(e) => setAttachPdf(e.target.checked)}
                />
                <span>Lampirkan PDF invoice (dibuat di browser, sama seperti tombol invoice admin).</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-end">
          <Button type="button" variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button type="button" disabled={!selected || sending || !draft.trim()} onClick={() => void send()}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Mengirim…
              </>
            ) : (
              "Kirim Invoice"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
