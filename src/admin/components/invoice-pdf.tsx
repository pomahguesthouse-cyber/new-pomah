import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";
import { format } from "date-fns";
import { id } from "date-fns/locale";

// To make it look good, we define styles using StyleSheet.create
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#333",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    width: 120,
    alignItems: "flex-end",
  },
  title: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  textRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    width: 70,
    color: "#666",
  },
  value: {
    flex: 1,
    fontFamily: "Helvetica",
  },
  sectionTitle: {
    backgroundColor: "#e2e8f0",
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 15,
    marginBottom: 8,
  },
  gridRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  gridCol: {
    flex: 1,
    paddingHorizontal: 8,
  },
  gridColBorderRight: {
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
  },
  // Table Styles
  table: {
    width: "auto",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tableHeader: {
    backgroundColor: "#f8fafc",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  tableCell: {
    padding: 6,
    fontSize: 9,
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
  },
  colNo: { width: "10%", textAlign: "center" },
  colDesc: { width: "40%" },
  colQty: { width: "15%", textAlign: "center" },
  colPrice: { width: "15%", textAlign: "right" },
  colSub: { width: "20%", textAlign: "right", borderRightWidth: 0 },
  // Totals
  totalsContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 0, // attached to table
  },
  totalsBox: {
    width: "35%",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderTopWidth: 0,
  },
  totalsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  totalsLabel: {
    width: "50%",
    padding: 6,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#666",
    textAlign: "right",
    borderRightWidth: 1,
    borderRightColor: "#e2e8f0",
    textTransform: "uppercase",
  },
  totalsValue: {
    width: "50%",
    padding: 6,
    fontSize: 9,
    textAlign: "right",
  },
  // Stamps
  stampContainer: {
    marginTop: 40,
    alignItems: "center",
  },
  stampBox: {
    borderWidth: 4,
    borderRadius: 8,
    padding: 10,
    width: 140,
    alignItems: "center",
  },
  stampPaid: {
    borderColor: "#0284c7", // blue color like in the screenshot
    color: "#0284c7",
  },
  stampUnpaid: {
    borderColor: "#e11d48",
    color: "#e11d48",
  },
  stampText: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  stampSub: {
    fontSize: 8,
    marginTop: 2,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 8,
    color: "#666",
  },
  footerText: {
    marginBottom: 4,
  },
  footerBlueBar: {
    backgroundColor: "#0ea5e9",
    color: "white",
    padding: 6,
    textAlign: "center",
  },
});

function formatIDR(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  })
    .format(n)
    .replace("IDR", ""); // Just the number, we'll put Rp in header if needed, or leave it. The screenshot shows just the number.
}

function formatDate(iso: string) {
  if (!iso) return "—";
  try {
    return format(new Date(`${iso}T00:00:00Z`), "dd-MM-yyyy");
  } catch {
    return iso;
  }
}

function formatDateFull(iso: string) {
  if (!iso) return "—";
  try {
    return format(new Date(`${iso}T00:00:00Z`), "dd MMM yyyy", { locale: id });
  } catch {
    return iso;
  }
}

function nightsBetween(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type InvoiceBookingData = {
  id: string;
  reference_code?: string | null;
  check_in: string;
  check_out: string;
  total_amount: number;
  payment_status?: "unpaid" | "partial" | "paid" | null;
  paid_amount?: number | null;
  source?: string;
  guests?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
  booking_rooms?:
    | {
        id: string;
        room_id: string | null;
        nightly_rate: number;
        room_types?: { name?: string | null } | null;
        rooms?: { number?: string | null } | null;
      }[]
    | null;
};

export function InvoiceDocument({ booking }: { booking: InvoiceBookingData }) {
  const nights = Math.max(1, nightsBetween(booking.check_in, booking.check_out));
  const rooms = booking.booking_rooms ?? [];
  const total = Number(booking.total_amount);
  const paid = Number(booking.paid_amount ?? 0);
  const sisa = Math.max(0, total - paid);

  const isPaid = sisa <= 0 && paid > 0;
  
  // Aggregate rooms by room type to match screenshot "Family Suite -> 2"
  const roomGroups = new Map<string, { name: string; qty: number; price: number }>();
  for (const br of rooms) {
    const name = br.room_types?.name || "Kamar";
    if (roomGroups.has(name)) {
      const g = roomGroups.get(name)!;
      g.qty += 1;
    } else {
      roomGroups.set(name, { name, qty: 1, price: Number(br.nightly_rate) });
    }
  }
  const groupedRooms = Array.from(roomGroups.values());

  const paymentText =
    booking.payment_status === "paid"
      ? "Lunas"
      : booking.payment_status === "partial"
        ? "Pembayaran Sebagian"
        : "Belum Bayar";

  const today = format(new Date(), "dd MMM yyyy, HH:mm", { locale: id });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>BUKTI PEMESANAN KAMAR (Booking Order)</Text>
            <View style={styles.textRow}>
              <Text style={styles.label}>Booking ID</Text>
              <Text style={styles.value}>: {booking.reference_code || booking.id.slice(0, 8)}</Text>
            </View>
            <View style={styles.textRow}>
              <Text style={styles.label}>Tanggal</Text>
              <Text style={styles.value}>: {today}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            {/* Fallback to text if we don't have a logo image yet */}
            <View style={{ backgroundColor: "#0ea5e9", padding: 10, borderRadius: 4 }}>
              <Text style={{ color: "white", fontFamily: "Helvetica-Bold", fontSize: 16 }}>
                Pomah
              </Text>
              <Text style={{ color: "white", fontSize: 8 }}>Guesthouse</Text>
            </View>
          </View>
        </View>

        {/* DETAIL PEMBAYARAN */}
        <Text style={styles.sectionTitle}>DETAIL PEMBAYARAN</Text>
        <View style={styles.gridRow}>
          <View style={[styles.gridCol, styles.gridColBorderRight]}>
            <Text style={[styles.label, { width: 100, marginBottom: 4, fontFamily: "Helvetica-Bold" }]}>
              BOOKING ID
            </Text>
            <Text>{booking.reference_code || booking.id.slice(0, 8)}</Text>
          </View>
          <View style={[styles.gridCol, styles.gridColBorderRight]}>
            <Text style={[styles.label, { width: 100, marginBottom: 4, fontFamily: "Helvetica-Bold" }]}>
              SUMBER
            </Text>
            <Text style={{ textTransform: "capitalize" }}>{booking.source || "Direct"}</Text>
          </View>
          <View style={styles.gridCol}>
            <Text style={[styles.label, { width: 100, marginBottom: 4, fontFamily: "Helvetica-Bold" }]}>
              DETAIL TRANSAKSI
            </Text>
            <Text>{paymentText}</Text>
          </View>
        </View>

        {/* DATA PEMESAN & TAMU */}
        <View style={styles.gridRow}>
          <View style={[styles.gridCol, { paddingHorizontal: 0, paddingRight: 8 }]}>
            <Text style={styles.sectionTitle}>DATA PEMESAN</Text>
            <View style={styles.textRow}>
              <Text style={styles.label}>Nama</Text>
              <Text style={styles.value}>: {booking.guests?.full_name || "—"}</Text>
            </View>
            <View style={styles.textRow}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>: {booking.guests?.email || "—"}</Text>
            </View>
            <View style={styles.textRow}>
              <Text style={styles.label}>No. Kontak</Text>
              <Text style={styles.value}>: {booking.guests?.phone || "—"}</Text>
            </View>
          </View>
          <View style={[styles.gridCol, { paddingHorizontal: 0, paddingLeft: 8 }]}>
            <Text style={styles.sectionTitle}>TAMU</Text>
            <Text style={{ marginBottom: 4 }}>1. {booking.guests?.full_name || "—"}</Text>
          </View>
        </View>

        {/* DETAIL PENGINAPAN */}
        <Text style={styles.sectionTitle}>DETAIL PENGINAPAN</Text>
        <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 4 }}>POMAH GUESTHOUSE</Text>
        <Text style={{ color: "#666", marginBottom: 8 }}>
          Alamat: Jl. Dewi Sartika IV no 71 Semarang, 50221
        </Text>
        <View style={styles.textRow}>
          <Text style={{ width: 50, color: "#666" }}>Check-in</Text>
          <Text>: {formatDate(booking.check_in)}</Text>
        </View>
        <View style={styles.textRow}>
          <Text style={{ width: 50, color: "#666" }}>Check-out</Text>
          <Text>: {formatDate(booking.check_out)}</Text>
        </View>
        <View style={styles.textRow}>
          <Text style={{ width: 50, color: "#666" }}>Durasi</Text>
          <Text>: {nights} malam</Text>
        </View>

        {/* TABLE */}
        <Text style={styles.sectionTitle}>DETAIL PEMESANAN</Text>
        <View style={styles.table}>
          {/* Table Header */}
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.tableCell, styles.colNo]}>NO</Text>
            <Text style={[styles.tableCell, styles.colDesc]}>DESKRIPSI</Text>
            <Text style={[styles.tableCell, styles.colQty]}>JUMLAH</Text>
            <Text style={[styles.tableCell, styles.colPrice]}>HARGA (Rp)</Text>
            <Text style={[styles.tableCell, styles.colSub]}>SUBTOTAL (Rp)</Text>
          </View>
          {/* Table Body */}
          {groupedRooms.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colNo]}>{idx + 1}</Text>
              <Text style={[styles.tableCell, styles.colDesc]}>{r.name}</Text>
              <Text style={[styles.tableCell, styles.colQty]}>{r.qty}</Text>
              <Text style={[styles.tableCell, styles.colPrice]}>{formatIDR(r.price)}</Text>
              <Text style={[styles.tableCell, styles.colSub]}>
                {formatIDR(r.price * r.qty * nights)}
              </Text>
            </View>
          ))}
          {rooms.length === 0 && (
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { width: "100%", textAlign: "center", borderRightWidth: 0 }]}>
                Tidak ada kamar.
              </Text>
            </View>
          )}
        </View>

        {/* Totals */}
        <View style={styles.totalsContainer}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Total</Text>
              <Text style={styles.totalsValue}>{formatIDR(total)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Pembayaran</Text>
              <Text style={styles.totalsValue}>{formatIDR(paid)}</Text>
            </View>
            <View style={[styles.totalsRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.totalsLabel}>Sisa Pembayaran</Text>
              <Text style={styles.totalsValue}>{formatIDR(sisa)}</Text>
            </View>
          </View>
        </View>

        {/* Stamp */}
        <View style={styles.stampContainer}>
          <View style={[styles.stampBox, isPaid ? styles.stampPaid : styles.stampUnpaid]}>
            <Text style={styles.stampText}>{isPaid ? "PAID" : "UNPAID"}</Text>
            <Text style={styles.stampSub}>RECEIPT</Text>
            <Text style={{ fontSize: 6, marginTop: 2 }}>* * * *</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Untuk pertanyaan apa pun, kunjungi Pomah Guesthouse Help Center: +6281227271799
          </Text>
          <Text style={styles.footerBlueBar}>
            Syarat dan Ketentuan berlaku. Silakan lihat http://www.pomahguesthouse.com
          </Text>
        </View>
      </Page>
    </Document>
  );
}
