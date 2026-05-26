import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Mail, Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PDFViewer, PDFDownloadLink } from "@react-pdf/renderer";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBrandingSettings, getPropertySettings } from "@/admin/modules/settings/settings.functions";
import { resendInvoice } from "@/admin/functions/bookings.functions";
import { InvoiceDocument, type InvoiceBookingData } from "./invoice-pdf";

type PDFDownloadLinkRenderProps = {
  loading: boolean;
};

function formatDateID(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function getWhatsAppLink(phone: string) {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "62" + cleaned.slice(1);
  }
  return `https://wa.me/${cleaned}`;
}

export function InvoiceDialog({
  booking,
  onClose,
}: {
  booking: InvoiceBookingData | null;
  onClose: () => void;
}) {
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
  }, []);

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

  // Build address and contact from property settings (Fix 1: no more hardcodes)
  const addressParts = [property?.address, property?.city, property?.country].filter(Boolean);
  const propertyAddress = addressParts.length > 0 ? addressParts.join(", ") : undefined;
  const propertyPhone = (property as any)?.whatsapp_number || property?.phone || undefined;
  const rawDomain = (property as any)?.public_domain ?? null;
  const propertyWebsite = rawDomain
    ? rawDomain.startsWith("http") ? rawDomain : `https://${rawDomain}`
    : undefined;

  const resendMut = useMutation({
    mutationFn: () => resendFn({ data: { bookingId: booking!.id } }),
    onSuccess: (res) => {
      if (res.wa_sent) {
        toast.success("Invoice berhasil dikirim ulang via WhatsApp");
      } else {
        toast.success("PDF invoice diperbarui (WhatsApp tidak dikonfigurasi)");
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!booking) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : "";
  const webInvoiceUrl = `${origin}/book/confirmation/${booking.id}`;

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

  return (
    <Dialog open={!!booking} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[850px] max-h-[95vh] flex flex-col p-6">
        <DialogHeader className="shrink-0 mb-2">
          <DialogTitle className="text-2xl">
            Invoice : {booking.reference_code ?? booking.id.slice(0, 8)}
          </DialogTitle>
          <DialogDescription className="text-base text-foreground font-medium">
            Tamu : {booking.guests?.full_name ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-4 shrink-0">
          {isMounted && (
            <PDFDownloadLink
              document={<InvoiceDocument
                booking={booking}
                logoUrl={logoUrl}
                propertyName={propertyName}
                propertyAddress={propertyAddress}
                propertyPhone={propertyPhone}
                propertyWebsite={propertyWebsite}
              />}
              fileName={`Invoice-${booking.reference_code || booking.id.slice(0, 8)}.pdf`}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-[#0e7490] text-primary-foreground shadow hover:bg-[#0e7490]/90 h-9 px-4 py-2"
            >
              {({ loading }: PDFDownloadLinkRenderProps) => (
                <>
                  <Download className="h-4 w-4" />
                  {loading ? "Menyiapkan PDF..." : "Download PDF"}
                </>
              )}
            </PDFDownloadLink>
          )}

          <a
            href={mailtoLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-[#0e7490] text-primary-foreground shadow hover:bg-[#0e7490]/90 h-9 px-4 py-2"
          >
            <Mail className="h-4 w-4" />
            Kirim Email
          </a>

          <a
            href={waLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-[#0e7490] text-primary-foreground shadow hover:bg-[#0e7490]/90 h-9 px-4 py-2"
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

          {/* Fix 2: Kirim ulang invoice (regenerate PDF + send WA) */}
          <button
            type="button"
            disabled={resendMut.isPending}
            onClick={() => resendMut.mutate()}
            className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-[#0e7490] text-[#0e7490] bg-transparent shadow-sm hover:bg-[#0e7490]/10 h-9 px-4 py-2"
          >
            <RefreshCw className={`h-4 w-4 ${resendMut.isPending ? "animate-spin" : ""}`} />
            {resendMut.isPending ? "Memperbarui…" : "Kirim Ulang Invoice"}
          </button>
        </div>

        <div className="flex-1 min-h-[500px] border border-border rounded-md overflow-hidden bg-muted/20">
          {isMounted ? (
            <PDFViewer className="w-full h-full min-h-[500px]" showToolbar={true}>
              <InvoiceDocument
                booking={booking}
                logoUrl={logoUrl}
                propertyName={propertyName}
                propertyAddress={propertyAddress}
                propertyPhone={propertyPhone}
                propertyWebsite={propertyWebsite}
              />
            </PDFViewer>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              Memuat penampil PDF...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
