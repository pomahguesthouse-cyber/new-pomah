import * as React from "react";
import { Download } from "lucide-react";

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
 * Public invoice pages must stay lightweight and resilient in production.
 *
 * The previous implementation imported @react-pdf/renderer and the admin
 * InvoiceDocument into the public route. In the deployed browser bundle this
 * can throw `Cannot read properties of undefined (reading 'call')` from the
 * generated invoice-pdf chunk before the page renders.
 *
 * Use the browser print dialog instead. Users can still choose "Save as PDF",
 * while the confirmation page no longer depends on the heavy PDF renderer.
 */
export default function GuestPDFDownloadLink(_props: GuestPDFDownloadLinkProps) {
  const handleClick = React.useCallback(() => {
    if (typeof window !== "undefined") {
      window.print();
    }
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
      title="Gunakan dialog cetak browser dan pilih 'Save as PDF' untuk menyimpan sebagai PDF"
    >
      <Download className="h-4 w-4" />
      Simpan / Cetak PDF
    </button>
  );
}
