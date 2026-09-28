import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Mail, Phone, RefreshCw, Printer } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBrandingSettings, getPropertySettings } from "@/admin/modules/settings/settings.functions";
import { resendInvoice } from "@/admin/functions/bookings.functions";
import type { InvoiceBookingData } from "./invoice-pdf";
import {
  canSharePdfNatively,
  createInvoicePdfBlob,
  downloadInvoicePdfBlob,
  invoicePdfFileName,
  prefersExternalPdfPreview,
  printInvoicePdfBlob,
  type PdfDeliveryResult,
} from "@/admin/lib/invoice-pdf-client";

function formatDateID(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

const solidBtn =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#0e7490] px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-[#0e7490]/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-[400px]:w-full max-[360px]:w-full";
const outlineBtn =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#0e7490] bg-transparent px-4 py-2 text-sm font-medium text-[#0e7490] shadow-sm transition-colors hover:bg-[#0e7490]/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-[400px]:w-full max-[360px]:w-full";

function getWhatsAppLink(phone: string) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  }
  return `https://wa.me/${cleaned}`;
}

function deliveryToast(result: PdfDeliveryResult, fileName: string) {
  if (result.cancelled) return;
  if (result.method === "native-share" || result.method === "web-share") {
    toast.success("Pilih aplikasi untuk menyimpan atau membuka PDF");
    return;
  }
  if (result.method === "print") {
    toast.success("Dialog cetak terbuka");
    return;
  }
  if (result.method === "open") {
    toast.success("Invoice PDF dibuka di tab baru");
    return;
  }
  toast.success(`Invoice diunduh: ${fileName}`);
}

export function InvoiceDialog({
  booking,
  onClose,
}: {
  booking: InvoiceBookingData | null;
  onClose: () => void;
}) {
  const fetchBranding = useServerFn(getBrandingSettings);
  const fetchProperty = useServerFn(getPropertySettings);
  const resendFn = useServerFn(resendInvoice);

  const { data: branding } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => fetchBranding(),
  });

  const { data: property } = useQuery({
    queryKey: ["property-settings"],
    queryFn: () => fetchProperty(),
  });

  const logoUrl = branding?.invoice_logo_url || branding?.logo_url;
  const propertyName = property?.name || "Pomah Guesthouse";

  const addressParts = [property?.address, property?.city, property?.country].filter(Boolean);
  const propertyAddress = addressParts.length > 0 ? addressParts.join(", ") : undefined;
  const propertyPhone = (property as { whatsapp_number?: string | null } | undefined)?.whatsapp_number || property?.phone || undefined;
  const rawDomain = (property as { public_domain?: string | null } | undefined)?.public_domain ?? null;
  const propertyWebsite = rawDomain
    ? rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`
    : undefined;

  const resendMut = useMutation({
    mutationFn: () => resendFn({ data: { bookingId: booking!.id } }),
    onSuccess: (res) => {
      if (res.wa_sent) {
        toast.success("Invoice berhasil dikirim ulang via WhatsApp");
        return;
      }
      toast.warning(
        res.error?.trim() ||
          "Invoice tidak terkirim via WhatsApp. Kirim manual via tombol Kirim Whatsapp.",
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const fileName = booking ? invoicePdfFileName(booking) : "invoice.pdf";
  const [pdfBlob, setPdfBlob] = React.useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [pdfError, setPdfError] = React.useState<string | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const [busy, setBusy] = React.useState<"download" | "print" | null>(null);
  const [nativeShare, setNativeShare] = React.useState(false);

  React.useEffect(() => {
    if (!booking) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreparing(true);
    setPdfError(null);
    setPdfBlob(null);
    setPreviewUrl(null);

    void (async () => {
      try {
        const native = await canSharePdfNatively();
        if (cancelled) return;
        setNativeShare(native);
        const blob = await createInvoicePdfBlob({
          booking,
          logoUrl,
          propertyName,
          propertyAddress,
          propertyPhone,
          propertyWebsite,
          fileName,
        });
        if (cancelled) return;
        setPdfBlob(blob);
        if (!native && !prefersExternalPdfPreview()) {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Gagal membuat PDF invoice";
          setPdfError(message);
          console.error("[invoice-pdf]", error);
        }
      } finally {
        if (!cancelled) setPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [booking, fileName, logoUrl, propertyAddress, propertyName, propertyPhone, propertyWebsite]);

  if (!booking) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webInvoiceUrl = `${origin}/book/confirmation/${booking.reference_code ?? booking.id}`;

  const emailBody = `Halo ${booking.guests?.full_name || ""},

Terima kasih telah memesan kamar di ${propertyName}.
Berikut adalah detail pemesanan Anda:
Booking ID: ${booking.reference_code || booking.id.slice(0, 8)}
Check-in: ${formatDateID(booking.check_in)}
Check-out: ${formatDateID(booking.check_out)}

Lihat & Unduh Invoice: ${webInvoiceUrl}

Salam,
${propertyName}`;

  const waBody = `Halo ${booking.guests?.full_name || ""},
Terima kasih telah memesan kamar di ${propertyName}.

Booking ID: ${booking.reference_code || booking.id.slice(0, 8)}
Check-in: ${formatDateID(booking.check_in)}
Check-out: ${formatDateID(booking.check_out)}

Lihat & Unduh Invoice: ${webInvoiceUrl}

Silakan simpan pesan ini sebagai referensi.`;

  const mailtoLink = `mailto:${booking.guests?.email || ""}?subject=Invoice Pemesanan ${propertyName} - ${booking.reference_code || booking.id.slice(0, 8)}&body=${encodeURIComponent(emailBody)}`;
  const waLink = booking.guests?.phone
    ? `${getWhatsAppLink(booking.guests.phone)}?text=${encodeURIComponent(waBody)}`
    : "#";

  async function runDelivery(kind: "download" | "print") {
    if (!pdfBlob || busy) return;
    setBusy(kind);
    try {
      const result =
        kind === "download"
          ? await downloadInvoicePdfBlob(pdfBlob, fileName)
          : await printInvoicePdfBlob(pdfBlob, fileName);
      deliveryToast(result, fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal membuka PDF invoice";
      toast.error(message);
      console.error("[invoice-pdf]", error);
    } finally {
      setBusy(null);
    }
  }

  const pdfReady = !!pdfBlob && !preparing;

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[95vh] w-[min(850px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col overflow-x-hidden overflow-y-auto p-4 sm:max-w-[850px] sm:p-6">
        <DialogHeader className="mb-2 shrink-0 pr-8">
          <DialogTitle className="break-words text-xl sm:text-2xl">
            Invoice : {booking.reference_code ?? booking.id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription className="text-base text-foreground font-medium">
            Tamu : {booking.guests?.full_name ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="mb-4 flex shrink-0 flex-wrap gap-2 max-[400px]:flex-col max-[360px]:flex-col">
          <button
            type="button"
            className={solidBtn}
            disabled={!pdfReady || busy !== null}
            onClick={() => void runDelivery("download")}
          >
            <Download className="h-4 w-4" />
            {preparing || busy === "download" ? "Menyiapkan PDF..." : nativeShare ? "Simpan / Bagikan PDF" : "Download PDF"}
          </button>

          <a
            href={mailtoLink}
            target="_blank"
            rel="noreferrer"
            className={solidBtn}
          >
            <Mail className="h-4 w-4" />
            Kirim Email
          </a>

          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className={solidBtn}
            onClick={(e) => {
              if (!booking.guests?.phone) {
                e.preventDefault();
                toast.error("Tamu belum memiliki nomor HP");
              }
            }}
          >
            <Phone className="h-4 w-4" />
            Kirim Whatsapp
          </a>

          <button
            type="button"
            className={solidBtn}
            disabled={!pdfReady || busy !== null}
            onClick={() => void runDelivery("print")}
          >
            <Printer className="h-4 w-4" />
            {busy === "print" ? "Menyiapkan cetak..." : nativeShare ? "Buka PDF" : "Cetak Invoice"}
          </button>

          <button
            type="button"
            disabled={resendMut.isPending}
            onClick={() => resendMut.mutate()}
            className={outlineBtn}
          >
            <RefreshCw className={`h-4 w-4 ${resendMut.isPending ? "animate-spin" : ""}`} />
            {resendMut.isPending ? "Memperbarui…" : "Kirim Ulang Invoice"}
          </button>
        </div>

        <div className="min-h-[140px] w-full min-w-0 max-w-full flex-1 overflow-hidden rounded-md border border-border bg-muted/20 min-[401px]:min-h-[500px]">
          {pdfError ? (
            <div className="flex h-full min-h-[140px] items-center justify-center p-6 text-center text-sm text-destructive">
              {pdfError}
            </div>
          ) : previewUrl ? (
            <iframe
              title={`Pratinjau ${fileName}`}
              src={previewUrl}
              className="block h-full min-h-[320px] w-full max-w-full border-0 min-[401px]:min-h-[500px]"
            />
          ) : (
            <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              {preparing ? (
                "Menyiapkan PDF..."
              ) : (
                <>
                  <p className="font-medium text-foreground">{fileName}</p>
                  <p>
                    {nativeShare
                      ? "Di aplikasi Android, PDF dibuka lewat menu simpan atau bagikan. Pratinjau di dalam halaman tidak didukung WebView."
                      : "Gunakan Download PDF atau Cetak Invoice. Pratinjau di dalam halaman tidak tersedia di layar ini."}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
