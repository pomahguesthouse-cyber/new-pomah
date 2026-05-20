import * as React from "react";
import { Download } from "lucide-react";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { InvoiceDocument } from "@/admin/components/invoice-pdf";

export interface GuestPDFDownloadLinkProps {
  booking: any;
  logoUrl?: string | null;
  propertyName?: string;
  propertyAddress?: string | null;
  propertyPhone?: string | null;
  propertyWebsite?: string | null;
  fileName: string;
}

export default function GuestPDFDownloadLink({
  booking,
  logoUrl,
  propertyName,
  propertyAddress,
  propertyPhone,
  propertyWebsite,
  fileName,
}: GuestPDFDownloadLinkProps) {
  return (
    <PDFDownloadLink
      document={
        <InvoiceDocument
          booking={booking}
          logoUrl={logoUrl}
          propertyName={propertyName}
          propertyAddress={propertyAddress}
          propertyPhone={propertyPhone}
          propertyWebsite={propertyWebsite}
        />
      }
      fileName={fileName}
      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800"
    >
      {({ loading }: { loading: boolean }) => (
        <>
          <Download className="h-4 w-4" />
          {loading ? "Menyiapkan PDF..." : "Download Invoice PDF"}
        </>
      )}
    </PDFDownloadLink>
  );
}
