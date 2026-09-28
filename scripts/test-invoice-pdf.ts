/**
 * Invoice PDF generation and the admin dialog's delivery path.
 * Does not send WhatsApp or touch booking rows.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument } from "../src/admin/components/invoice-pdf";

const booking = {
  id: "11111111-2222-3333-4444-555555555555",
  reference_code: "PMH-TEST",
  check_in: "2026-10-02",
  check_out: "2026-10-05",
  total_amount: 1500000,
  payment_status: "partial" as const,
  paid_amount: 500000,
  source: "direct",
  guests: { full_name: "Siti Rahma", email: "siti@example.com", phone: "081234567890" },
  booking_rooms: [
    {
      id: "r1",
      room_id: "room-1",
      nightly_rate: 400000,
      extra_bed_count: 1,
      extra_bed_rate: 100000,
      room_types: { name: "Family Suite" },
      rooms: { number: "12" },
    },
  ],
};

async function render(logoUrl?: string | null) {
  return renderToBuffer(
    React.createElement(InvoiceDocument, {
      booking,
      logoUrl,
      propertyName: "Pomah Guesthouse",
      propertyAddress: "Jl. Dewi Sartika IV no 71, Semarang",
      propertyPhone: "6285190986169",
      propertyWebsite: "https://pomahguesthouse.com",
    }),
  );
}

const withTextLogo = await render(null);
assert.ok(withTextLogo.subarray(0, 5).toString() === "%PDF-", "text-logo invoice is a PDF");
assert.ok(withTextLogo.length > 1000);

const unsupportedLogo = await render("https://example.com/logo.webp");
assert.equal(unsupportedLogo.subarray(0, 5).toString(), "%PDF-");

const dialogSrc = fs.readFileSync(new URL("../src/admin/components/invoice-dialog.tsx", import.meta.url), "utf8");
assert.match(dialogSrc, /max-\[360px\]:w-full/);
assert.match(dialogSrc, /overflow-x-hidden/);
assert.match(dialogSrc, /Kirim Whatsapp/);
assert.match(dialogSrc, /toast\.warning/);
assert.doesNotMatch(dialogSrc, /PDFViewer|PDFDownloadLink/);
assert.doesNotMatch(dialogSrc, /from "@react-pdf\/renderer"/);
assert.match(dialogSrc, /downloadInvoicePdfBlob/);
assert.match(dialogSrc, /printInvoicePdfBlob/);
assert.doesNotMatch(dialogSrc, /window\.print\(/);
assert.doesNotMatch(dialogSrc, /\?print=true/);

const guestSrc = fs.readFileSync(new URL("../src/public/components/guest-pdf-download-link.tsx", import.meta.url), "utf8");
assert.doesNotMatch(guestSrc, /from "@react-pdf\/renderer"/);
assert.match(guestSrc, /downloadInvoicePdf/);
assert.match(guestSrc, /Simpan \/ Cetak PDF/);
assert.match(guestSrc, /window\.print\(\)/);

const pdfSrc = fs.readFileSync(new URL("../src/admin/components/invoice-pdf.tsx", import.meta.url), "utf8");
assert.doesNotMatch(pdfSrc, /Font\.register|import \{[^}]*\bFont\b/);
assert.match(pdfSrc, /pdfSafeLogo/);

const bookingsSrc = fs.readFileSync(new URL("../src/routes/admin/bookings.tsx", import.meta.url), "utf8");
assert.match(bookingsSrc, /InvoiceDialog/);
assert.doesNotMatch(bookingsSrc, /book\/confirmation\/\$\{encodeURIComponent\(invoiceRef\)\}/);

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};
assert.ok(pkg.dependencies["@capacitor/filesystem"]);
assert.ok(pkg.dependencies["@capacitor/share"]);

console.log("invoice pdf tests passed", withTextLogo.length, "bytes");
