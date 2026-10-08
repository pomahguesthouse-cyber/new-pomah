import React from "react";
import type { InvoiceBookingData } from "@/admin/components/invoice-pdf";

export type InvoicePdfRequest = {
  booking: InvoiceBookingData;
  logoUrl?: string | null;
  propertyName?: string;
  propertyAddress?: string | null;
  propertyPhone?: string | null;
  propertyWebsite?: string | null;
  fileName: string;
};

export type PdfDeliveryMethod = "native-share" | "web-share" | "download" | "print" | "open";

export type PdfDeliveryResult = {
  method: PdfDeliveryMethod;
  cancelled?: boolean;
};

const PDF_MIME = "application/pdf";

function safeFileName(fileName: string): string {
  const base = fileName.trim().replace(/[/\\?%*:|"<>]+/g, "-") || "invoice.pdf";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export function invoicePdfFileName(booking: { id: string; reference_code?: string | null }): string {
  const raw = booking.reference_code || booking.id.slice(0, 8);
  return safeFileName(`Invoice-${raw}.pdf`);
}

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroidWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent) && /;\s*wv\)/i.test(navigator.userAgent);
}

/** Cover-screen and phone browsers cannot paint a PDF inside an iframe. */
export function prefersExternalPdfPreview(): boolean {
  if (typeof window === "undefined") return true;
  if (isMobileBrowser()) return true;
  return window.matchMedia("(max-width: 420px)").matches;
}

export function isShareCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cancel|abort|dismiss/i.test(message);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Gagal membaca gambar logo"));
    reader.readAsDataURL(blob);
  });
}

/**
 * react-pdf only embeds PNG and JPEG. WebP, SVG, and ICO logos otherwise
 * leave a blank header. Convert them here, or drop the logo so the text mark shows.
 */
async function resolveLogoForPdf(url?: string | null): Promise<string | null> {
  if (!url || typeof window === "undefined") return null;
  const value = url.trim();
  if (!value) return null;
  if (/^data:image\/(?:png|jpe?g)(?:;|,)/i.test(value)) return value;
  try {
    const absolute = new URL(value, window.location.href).href;
    const response = await fetch(absolute, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const blob = await response.blob();
    const type = (blob.type || "").toLowerCase();
    if (type === "image/png" || type === "image/jpeg") return blobToDataUrl(blob);
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export async function canSharePdfNatively(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable("Filesystem") &&
      Capacitor.isPluginAvailable("Share")
    );
  } catch {
    return false;
  }
}

async function loadPdfRenderer() {
  const [renderer, documentModule] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/admin/components/invoice-pdf"),
  ]);
  return { pdf: renderer.pdf, InvoiceDocument: documentModule.InvoiceDocument };
}

export async function createInvoicePdfBlob(request: InvoicePdfRequest): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("Invoice PDF hanya bisa dibuat di browser.");
  }
  const { pdf, InvoiceDocument } = await loadPdfRenderer();
  const logoUrl = await resolveLogoForPdf(request.logoUrl);
  const blob = await pdf(
    <InvoiceDocument
      booking={request.booking}
      logoUrl={logoUrl}
      propertyName={request.propertyName}
      propertyAddress={request.propertyAddress}
      propertyPhone={request.propertyPhone}
      propertyWebsite={request.propertyWebsite}
    />,
  ).toBlob();
  if (!blob || blob.size < 5) {
    throw new Error("PDF invoice kosong.");
  }
  return blob;
}

export type PdfSaveOptions = {
  /** Cache subdirectory. Invoice files stay in `invoices`. */
  folder?: string;
  dialogTitle?: string;
  /** `download` saves or shares a file. `print` may open the desktop print dialog first. */
  intent?: "download" | "print";
};

const ANDROID_PDF_ERROR =
  "Aplikasi Android ini belum memuat penyimpan PDF. Pasang APK Pomah Admin yang baru, lalu coba lagi.";

async function sharePdfNatively(blob: Blob, fileName: string, options?: PdfSaveOptions): Promise<PdfDeliveryResult> {
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const name = safeFileName(fileName);
  const folder = options?.folder?.replace(/^\/+|\/+$/g, "") || "invoices";
  const written = await Filesystem.writeFile({
    path: `${folder}/${name}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({
      title: name,
      files: [written.uri],
      dialogTitle: options?.dialogTitle ?? "Simpan atau buka invoice PDF",
    });
    return { method: "native-share" };
  } catch (error) {
    if (isShareCancel(error)) return { method: "native-share", cancelled: true };
    throw error;
  }
}

async function sharePdfOnWeb(blob: Blob, fileName: string): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const file = new File([blob], safeFileName(fileName), { type: PDF_MIME });
  if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: file.name });
    return true;
  } catch (error) {
    if (isShareCancel(error)) return true;
    return false;
  }
}

function triggerAnchorDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFileName(fileName);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

function openPdfInNewTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return opened != null;
}

function printPdfInHiddenFrame(blob: Blob): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.title = "Cetak invoice";
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      window.setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    iframe.onload = () => {
      window.setTimeout(() => {
        try {
          const frameWindow = iframe.contentWindow;
          if (!frameWindow || typeof frameWindow.print !== "function") {
            finish(false);
            return;
          }
          frameWindow.focus();
          frameWindow.print();
          finish(true);
        } catch {
          finish(false);
        }
      }, 400);
    };
    document.body.appendChild(iframe);
    iframe.src = url;
    window.setTimeout(() => finish(false), 5000);
  });
}

/**
 * Hand a generated PDF to the user.
 * Native Android (Capacitor) opens the share sheet. Mobile browsers use
 * Web Share or a download. Desktop downloads the file, unless `intent` is
 * `print`, which tries the browser print dialog first.
 */
export async function deliverPdfBlob(blob: Blob, fileName: string, options?: PdfSaveOptions): Promise<PdfDeliveryResult> {
  const intent = options?.intent ?? "download";
  if (await canSharePdfNatively()) {
    return sharePdfNatively(blob, fileName, options);
  }
  if (isAndroidWebView()) {
    throw new Error(ANDROID_PDF_ERROR);
  }
  if (intent === "print" && !isMobileBrowser()) {
    const printed = await printPdfInHiddenFrame(blob);
    if (printed) return { method: "print" };
  }
  const tryWebShare = intent === "print" || isMobileBrowser();
  if (tryWebShare && (await sharePdfOnWeb(blob, fileName))) {
    return { method: "web-share" };
  }
  if (intent === "print") {
    if (openPdfInNewTab(blob)) return { method: "open" };
    triggerAnchorDownload(blob, fileName);
    return { method: "download" };
  }
  triggerAnchorDownload(blob, fileName);
  if (isMobileBrowser()) {
    openPdfInNewTab(blob);
    return { method: "open" };
  }
  return { method: "download" };
}

export async function downloadInvoicePdfBlob(blob: Blob, fileName: string): Promise<PdfDeliveryResult> {
  return deliverPdfBlob(blob, fileName, {
    folder: "invoices",
    dialogTitle: "Simpan atau buka invoice PDF",
    intent: "download",
  });
}

export async function printInvoicePdfBlob(blob: Blob, fileName: string): Promise<PdfDeliveryResult> {
  return deliverPdfBlob(blob, fileName, {
    folder: "invoices",
    dialogTitle: "Simpan atau buka invoice PDF",
    intent: "print",
  });
}

export async function downloadInvoicePdf(request: InvoicePdfRequest): Promise<PdfDeliveryResult> {
  const blob = await createInvoicePdfBlob(request);
  return downloadInvoicePdfBlob(blob, request.fileName);
}

export async function printInvoicePdf(request: InvoicePdfRequest): Promise<PdfDeliveryResult> {
  const blob = await createInvoicePdfBlob(request);
  return printInvoicePdfBlob(blob, request.fileName);
}
