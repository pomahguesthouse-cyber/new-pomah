import React from "react";
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ExportRow } from "../lib/booking-export";
import {
  bookingRoomColumns,
  formatDateId,
  formatIdr,
  formatPrintedAt,
  labelBookingSource,
  labelBookingStatus,
  summarizeBookingRows,
} from "../lib/booking-list-pdf-model";

const FONT_FAMILY = "PomahSans";

const COLUMNS: Array<{ label: string; width: string; align: "left" | "right" }> = [
  { label: "Kode", width: "10%", align: "left" },
  { label: "Tamu", width: "13%", align: "left" },
  { label: "Tipe kamar", width: "12%", align: "left" },
  { label: "No. kamar", width: "8%", align: "left" },
  { label: "Check-in", width: "8%", align: "left" },
  { label: "Check-out", width: "8%", align: "left" },
  { label: "Malam", width: "5%", align: "right" },
  { label: "Total", width: "10%", align: "right" },
  { label: "Dibayar", width: "10%", align: "right" },
  { label: "Status", width: "8%", align: "left" },
  { label: "Sumber", width: "8%", align: "left" },
];

let fontReady = false;

function fontSource(fileName: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/fonts/${fileName}`;
  }
  const url = new URL(`../../../public/fonts/${fileName}`, import.meta.url);
  return decodeURIComponent(url.pathname);
}

/** Noto Sans covers Indonesian names. Standard PDF fonts (Helvetica) are WinAnsi and can throw on those letters. */
export function ensureBookingListFont(): void {
  if (fontReady) return;
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: fontSource("NotoSans-Regular.ttf"), fontWeight: 400 },
      { src: fontSource("NotoSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => {
    if (word.length <= 24) return [word];
    const parts: string[] = [];
    for (let index = 0; index < word.length; index += 18) parts.push(word.slice(index, index + 18));
    return parts;
  });
  fontReady = true;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 108,
    paddingBottom: 28,
    paddingHorizontal: 16,
    fontFamily: FONT_FAMILY,
    fontSize: 8,
    color: "#0f172a",
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#0e7490",
  },
  header: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 8,
    color: "#475569",
  },
  printedAt: {
    fontSize: 8,
    color: "#475569",
    textAlign: "right",
  },
  filter: {
    marginTop: 3,
    fontSize: 7.5,
    color: "#334155",
  },
  summary: {
    marginTop: 6,
    flexDirection: "row",
    gap: 6,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#99f6e4",
    backgroundColor: "#f0fdfa",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  summaryLabel: {
    fontSize: 6.5,
    color: "#0f766e",
    textTransform: "uppercase",
  },
  summaryValue: {
    marginTop: 1,
    fontSize: 9,
    fontWeight: 700,
  },
  colHead: {
    marginTop: 6,
    flexDirection: "row",
    backgroundColor: "#0f172a",
    color: "#f8fafc",
    borderRadius: 2,
  },
  colHeadText: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 7,
    fontWeight: 700,
    color: "#f8fafc",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: "#e2e8f0",
    alignItems: "stretch",
  },
  rowAlt: {
    backgroundColor: "#f8fafc",
  },
  cell: {
    paddingVertical: 3,
    paddingHorizontal: 3,
    fontSize: 7.5,
  },
  code: {
    fontWeight: 700,
  },
  totalRow: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: "#ecfeff",
    borderTopWidth: 1,
    borderTopColor: "#0e7490",
  },
  totalText: {
    fontSize: 8,
    fontWeight: 700,
  },
  footer: {
    position: "absolute",
    bottom: 10,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.4,
    borderTopColor: "#cbd5e1",
    paddingTop: 3,
    fontSize: 7.5,
    color: "#64748b",
  },
});

export type BookingListPdfProps = {
  rows: ExportRow[];
  propertyName?: string;
  filterSummary?: string;
  generatedAt?: Date;
  capped?: boolean;
};

function rowCells(row: ExportRow): string[] {
  const rooms = bookingRoomColumns(row);
  return [
    row.reference_code?.trim() || "—",
    row.guest_name?.trim() || "Tanpa nama",
    rooms.types,
    rooms.numbers,
    formatDateId(row.check_in),
    formatDateId(row.check_out),
    String(Number.isFinite(row.nights) ? row.nights : 0),
    formatIdr(row.total_amount),
    formatIdr(row.paid_amount),
    labelBookingStatus(row.status),
    labelBookingSource(row.source),
  ];
}

export function BookingListDocument({
  rows,
  propertyName = "Pomah Guesthouse",
  filterSummary = "Status: semua · Sumber: semua",
  generatedAt = new Date(),
  capped = false,
}: BookingListPdfProps) {
  ensureBookingListFont();
  const summary = summarizeBookingRows(rows);
  const filterLine = capped ? `${filterSummary} · Menampilkan 5.000 baris pertama` : filterSummary;
  const summaryItems = [
    ["Jumlah booking", String(summary.count)],
    ["Total malam", String(summary.nights)],
    ["Total nilai", formatIdr(summary.total)],
    ["Total dibayar", formatIdr(summary.paid)],
  ] as const;

  return (
    <Document title={`Daftar Booking — ${propertyName}`} author={propertyName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.accent} fixed />
        <View style={styles.header} fixed>
          <View style={styles.titleRow}>
            <View>
              <Text style={styles.title}>{propertyName}</Text>
              <Text style={styles.subtitle}>Daftar Booking</Text>
            </View>
            <Text style={styles.printedAt}>{`Dicetak ${formatPrintedAt(generatedAt)}`}</Text>
          </View>
          <Text style={styles.filter}>{filterLine}</Text>
          <View style={styles.summary}>
            {summaryItems.map(([label, value]) => (
              <View key={label} style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{label}</Text>
                <Text style={styles.summaryValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={styles.colHead}>
            {COLUMNS.map((column) => (
              <Text
                key={column.label}
                style={[styles.colHeadText, { width: column.width, textAlign: column.align }]}
              >
                {column.label}
              </Text>
            ))}
          </View>
        </View>

        {rows.map((row, index) => {
          const cells = rowCells(row);
          return (
            <View key={`${row.reference_code}-${index}`} style={index % 2 === 1 ? [styles.row, styles.rowAlt] : styles.row} wrap={false}>
              {cells.map((value, cellIndex) => (
                <Text
                  key={COLUMNS[cellIndex].label}
                  style={[
                    styles.cell,
                    cellIndex === 0 ? styles.code : {},
                    { width: COLUMNS[cellIndex].width, textAlign: COLUMNS[cellIndex].align },
                  ]}
                >
                  {value}
                </Text>
              ))}
            </View>
          );
        })}

        <View style={styles.totalRow} wrap={false}>
          <Text style={styles.totalText}>
            {`Jumlah booking ${summary.count}    ·    Total malam ${summary.nights}    ·    Total nilai ${formatIdr(summary.total)}    ·    Total dibayar ${formatIdr(summary.paid)}`}
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>{`${propertyName} · Daftar Booking`}</Text>
          <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
