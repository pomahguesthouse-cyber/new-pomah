/**
 * /book/confirmation/$id — booking invoice.
 *
 * Shown right after a successful web booking: a printable invoice with
 * the reservation details, price breakdown and payment instructions.
 */
import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Printer, Loader2 } from "lucide-react";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { getBookingInvoice, getPublicSiteData } from "@/public/functions/public.functions";

const GuestPDFDownloadLink = React.lazy(() => import("@/public/components/guest-pdf-download-link"));

export const Route = createFileRoute("/book/confirmation/$id")({
  // Override the site-wide og:image (homepage hero) with a dedicated invoice
  // banner so the WhatsApp link preview shows appropriate branding instead of
  // the generic homepage screenshot.
  head: () => {
    const ogImage =
      "https://gofvxeiulaljwyfyhnww.supabase.co/storage/v1/object/public/room-images/banner/banner-1200x600-d45c57c0.webp";
    const title = "Invoice Pemesanan — Pomah Guesthouse";
    const desc = "Invoice reservasi Anda.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        ...(ogImage
          ? [
              { property: "og:image", content: ogImage },
              { name: "twitter:image", content: ogImage },
            ]
          : []),
      ],
    };
  },
  component: ConfirmationPage,
});

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
function fmtDateID(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso || "—";
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}
const idr = (n: number) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

const STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu Konfirmasi",
  confirmed: "Terkonfirmasi",
  checked_in: "Check-in",
  checked_out: "Check-out",
  cancelled: "Dibatalkan",
};

function ConfirmationPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getBookingInvoice);
  const siteFn = useServerFn(getPublicSiteData);
  const { data, isLoading } = useQuery({
    queryKey: ["booking-invoice", id],
    queryFn: () => fn({ data: { id } }),
  });
  const { data: siteData } = useQuery({ queryKey: ["public-site"], queryFn: () => siteFn() });
  const inv = data?.invoice ?? null;

  const [isMounted, setIsMounted] = React.useState(false);
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  const logoUrl = siteData?.property?.invoice_logo_url || siteData?.property?.logo_url;
  const propertyName = siteData?.property?.name || inv?.property.name;
  const propertyAddress = [
    siteData?.property?.address,
    siteData?.property?.city,
    siteData?.property?.country,
  ]
    .filter(Boolean)
    .join(", ") || inv?.property.address;
  const propertyPhone = siteData?.property?.whatsapp_number || siteData?.property?.phone;
  const propertyWebsite = siteData?.property?.public_domain
    ? siteData.property.public_domain.startsWith("http")
      ? siteData.property.public_domain
      : `https://${siteData.property.public_domain}`
    : undefined;

  return (
    <div className="min-h-screen bg-stone-50">
      <PublicNav
        property={
          siteData?.property
            ? {
                ...siteData.property,
                logo_url: siteData.property.invoice_logo_url || siteData.property.logo_url,
              }
            : null
        }
        showBackHome
      />
      <main className="mx-auto max-w-2xl px-6 py-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-sm text-stone-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Memuat invoice…
          </div>
        ) : !inv ? (
          <div className="py-24 text-center">
            <h1 className="text-2xl font-semibold">Invoice tidak ditemukan</h1>
            <Link to="/" className="mt-4 inline-block text-sm text-amber-700 underline">
              Kembali ke beranda
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-3 text-2xl font-bold tracking-tight">Pemesanan Berhasil</h1>
              <p className="mt-1 text-sm text-stone-500">
                Terima kasih, {inv.guest.full_name}. Berikut invoice reservasi Anda.
              </p>
            </div>

            <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {/* Invoice header */}
              <div className="flex items-start justify-between gap-4 border-b border-stone-200 bg-stone-50 px-6 py-5">
                <div>
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt={propertyName || "Logo"}
                      className="h-10 object-contain mb-2 max-w-[200px]"
                    />
                  ) : (
                    <p className="text-lg font-bold">{inv.property.name}</p>
                  )}
                  {inv.property.address && (
                    <p className="text-xs text-stone-500">{inv.property.address}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-stone-400">
                    Kode Booking
                  </p>
                  <p className="font-mono text-base font-bold text-amber-700">
                    {inv.reference_code}
                  </p>
                  <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {STATUS_LABEL[inv.status] ?? inv.status}
                  </span>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-3 px-6 py-5 text-sm">
                <Row label="Tipe Kamar" value={`${inv.room_type} × ${inv.rooms} kamar`} />
                <Row
                  label="Check-in"
                  value={`${fmtDateID(inv.check_in)}${
                    inv.check_in_time ? ` · ${inv.check_in_time}` : ""
                  }`}
                />
                <Row
                  label="Check-out"
                  value={`${fmtDateID(inv.check_out)}${
                    inv.check_out_time ? ` · ${inv.check_out_time}` : ""
                  }`}
                />
                <Row label="Durasi" value={`${inv.nights} malam`} />
                <Row
                  label="Tamu"
                  value={`${inv.adults} dewasa${inv.children ? `, ${inv.children} anak` : ""}`}
                />
                <Row label="Atas Nama" value={inv.guest.full_name} />
                {inv.guest.phone && <Row label="Kontak" value={inv.guest.phone} />}
                {inv.special_requests && (
                  <Row label="Permintaan Khusus" value={inv.special_requests} />
                )}
              </div>

              {/* Price */}
              <div className="border-t border-stone-200 px-6 py-5 text-sm">
                <div className="flex justify-between text-stone-600">
                  <span>
                    {idr(inv.nightly_rate)} × {inv.nights} malam × {inv.rooms} kamar
                  </span>
                  <span>{idr(inv.total_amount)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2">
                  <span className="text-base font-bold">Total</span>
                  <span className="text-xl font-bold text-amber-700">{idr(inv.total_amount)}</span>
                </div>
              </div>

              {/* Payment */}
              <div className="border-t border-stone-200 bg-stone-50 px-6 py-5 text-sm">
                <p className="font-semibold">Pembayaran</p>
                {inv.payment_method === "onsite" ? (
                  <p className="mt-1 text-stone-600">
                    Bayar di tempat saat check-in. Reservasi dikonfirmasi admin via WhatsApp.
                  </p>
                ) : inv.property.bank ? (
                  <div className="mt-1 space-y-0.5 text-stone-600">
                    <p>Silakan transfer ke:</p>
                    <p>🏦 {inv.property.bank}</p>
                    <p>💳 No. Rek: {inv.property.account_number}</p>
                    <p>👤 a.n. {inv.property.account_holder}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      Setelah transfer, kirim bukti pembayaran ke kami ya.
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-stone-600">
                    Detail pembayaran akan dikirim oleh staf kami.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 print:hidden">
              {isMounted && inv ? (
                <React.Suspense
                  fallback={
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-200 px-4 py-2 text-sm text-stone-500 cursor-not-allowed">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Menyiapkan PDF…
                    </span>
                  }
                >
                  <GuestPDFDownloadLink
                    booking={{
                      id: id,
                      reference_code: inv.reference_code,
                      check_in: inv.check_in,
                      check_out: inv.check_out,
                      total_amount: inv.total_amount,
                      payment_status:
                        inv.status === "confirmed" ||
                        inv.status === "checked_in" ||
                        inv.status === "checked_out"
                          ? "paid"
                          : "unpaid",
                      paid_amount:
                        inv.status === "confirmed" ||
                        inv.status === "checked_in" ||
                        inv.status === "checked_out"
                          ? inv.total_amount
                          : 0,
                      source: "direct",
                      guests: {
                        full_name: inv.guest.full_name,
                        email: inv.guest.email,
                        phone: inv.guest.phone,
                      },
                      booking_rooms: Array.from({ length: inv.rooms }, (_, i) => ({
                        id: `${id}-room-${i}`,
                        room_id: null,
                        nightly_rate: inv.nightly_rate,
                        room_types: { name: inv.room_type },
                        rooms: null,
                      })),
                    }}
                    logoUrl={logoUrl}
                    propertyName={propertyName}
                    propertyAddress={propertyAddress}
                    propertyPhone={propertyPhone}
                    propertyWebsite={propertyWebsite}
                    fileName={`Invoice-${inv.reference_code || id.slice(0, 8)}.pdf`}
                  />
                </React.Suspense>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-stone-200 px-4 py-2 text-sm text-stone-500 cursor-not-allowed">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  PDF sedang disiapkan…
                </span>
              )}
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
              >
                <Printer className="h-4 w-4" />
                Cetak Invoice
              </button>
              <Link
                to="/"
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
              >
                Kembali ke Beranda
              </Link>
            </div>
          </>
        )}
      </main>
      <PublicFooter property={siteData?.property} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-stone-400">{label}</span>
      <span className="text-right font-medium text-stone-800">{value}</span>
    </div>
  );
}
