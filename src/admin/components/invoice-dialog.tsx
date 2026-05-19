import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { PDFViewer, PDFDownloadLink } from "@react-pdf/renderer";
import { InvoiceDocument, type InvoiceBookingData } from "./invoice-pdf";

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

  if (!booking) return null;

  const emailBody = `Halo ${booking.guests?.full_name || ""},
  
Terima kasih telah memesan kamar di Pomah Guesthouse.
Berikut adalah detail pemesanan Anda:
Booking ID: ${booking.reference_code || booking.id.slice(0, 8)}
Check-in: ${formatDateID(booking.check_in)}
Check-out: ${formatDateID(booking.check_out)}

Silakan periksa attachment untuk invoice lengkap Anda.

Salam,
Pomah Guesthouse`;

  const waBody = `Halo ${booking.guests?.full_name || ""},
Terima kasih telah memesan kamar di Pomah Guesthouse.

Booking ID: ${booking.reference_code || booking.id.slice(0, 8)}
Check-in: ${formatDateID(booking.check_in)}
Check-out: ${formatDateID(booking.check_out)}

Silakan simpan pesan ini sebagai referensi.`;

  const mailtoLink = `mailto:${booking.guests?.email || ""}?subject=Invoice Pemesanan Pomah Guesthouse - ${booking.reference_code || booking.id.slice(0, 8)}&body=${encodeURIComponent(emailBody)}`;
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
              document={<InvoiceDocument booking={booking} />}
              fileName={`Invoice-${booking.reference_code || booking.id.slice(0, 8)}.pdf`}
              className="inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-[#0e7490] text-primary-foreground shadow hover:bg-[#0e7490]/90 h-9 px-4 py-2"
            >
              {({ loading }) => (
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
        </div>

        <div className="flex-1 min-h-[500px] border border-border rounded-md overflow-hidden bg-muted/20">
          {isMounted ? (
            <PDFViewer width="100%" height="100%" showToolbar={true}>
              <InvoiceDocument booking={booking} />
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
