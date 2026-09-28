import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadInvoicePdf } from "@/admin/lib/invoice-pdf-client";

export interface GuestPDFDownloadLinkProps {
  booking: any;
  logoUrl?: string | null;
  propertyName?: string;
  propertyAddress?: string | null;
  propertyPhone?: string | null;
  propertyWebsite?: string | null;
  fileName: string;
}

/**
 * Generates the invoice PDF on click. The renderer is loaded only then, so a
 * broken PDF chunk cannot take down the confirmation page. If generation
 * fails, fall back to the browser print dialog.
 */
export default function GuestPDFDownloadLink({
  booking,
  logoUrl,
  propertyName,
  propertyAddress,
  propertyPhone,
  propertyWebsite,
  fileName,
}: GuestPDFDownloadLinkProps) {
  const [pending, setPending] = React.useState(false);

  const handleClick = React.useCallback(async () => {
    setPending(true);
    try {
      await downloadInvoicePdf({
        booking,
        logoUrl,
        propertyName,
        propertyAddress,
        propertyPhone,
        propertyWebsite,
        fileName,
      });
    } catch (error) {
      console.error("[invoice-pdf]", error);
      if (typeof window !== "undefined") window.print();
    } finally {
      setPending(false);
    }
  }, [booking, fileName, logoUrl, propertyAddress, propertyName, propertyPhone, propertyWebsite]);

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={pending}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-teal-700/70 max-[360px]:w-full"
      title="Unduh invoice sebagai file PDF"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {pending ? "Menyiapkan PDF..." : "Simpan / Cetak PDF"}
    </button>
  );
}
