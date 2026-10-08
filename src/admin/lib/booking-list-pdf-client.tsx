import React from "react";
import type { ExportRow } from "@/admin/lib/booking-export";
import { deliverPdfBlob, type PdfDeliveryResult } from "@/admin/lib/invoice-pdf-client";
import { bookingListPdfFileName } from "@/admin/lib/booking-list-pdf-model";

export type BookingListPdfRequest = {
  rows: ExportRow[];
  propertyName?: string;
  filterSummary?: string;
  generatedAt?: Date;
  capped?: boolean;
  fileName?: string;
};

export async function createBookingListPdfBlob(request: BookingListPdfRequest): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("PDF daftar booking hanya bisa dibuat di browser.");
  }
  const [{ pdf }, documentModule] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/admin/components/booking-list-pdf"),
  ]);
  const blob = await pdf(
    <documentModule.BookingListDocument
      rows={request.rows}
      propertyName={request.propertyName}
      filterSummary={request.filterSummary}
      generatedAt={request.generatedAt}
      capped={request.capped}
    />,
  ).toBlob();
  if (!blob || blob.size < 800) {
    throw new Error("PDF daftar booking kosong.");
  }
  return blob;
}

/** Download or share a real PDF. Does not call window.print(), which no-ops in the Android admin WebView. */
export async function downloadBookingListPdf(request: BookingListPdfRequest): Promise<PdfDeliveryResult> {
  const blob = await createBookingListPdfBlob(request);
  const fileName = request.fileName ?? bookingListPdfFileName(request.generatedAt ?? new Date());
  return deliverPdfBlob(blob, fileName, {
    folder: "booking-lists",
    dialogTitle: "Simpan atau bagikan daftar booking",
    intent: "download",
  });
}
