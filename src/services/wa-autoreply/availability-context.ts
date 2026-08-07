import { fmtDateID, todayWIB } from "@/lib/date";
import {
  isAvailabilityNeedDatesQuestion,
  isAvailabilitySourceContext,
} from "@/services/wa-autoreply/message-parsers";
import { buildAvailabilityNeedDatesReply } from "@/services/wa-autoreply/availability-formatters";

type FastFaqResult = {
  reply: string;
  intent: string;
  dates?: { checkIn: string; checkOut: string };
};

export function buildRecentAvailabilityNeedDatesReply(
  messages: Array<{ direction: string; body?: string }>,
): FastFaqResult | null {
  const today = todayWIB();
  const recent = messages.slice(-8);
  let askBody = "";
  let askIndex = -1;

  for (let i = recent.length - 1; i >= 0; i--) {
    const row = recent[i];
    if (row.direction === "out") break;
    if (row.direction !== "in") continue;

    const body = (row.body ?? "").trim();
    if (isAvailabilityNeedDatesQuestion(body, today)) {
      askBody = body;
      askIndex = i;
      break;
    }
  }

  if (!askBody || askIndex < 0) return null;

  const inboundAfterAsk = recent
    .slice(askIndex)
    .filter((message) => message.direction === "in")
    .map((message) => (message.body ?? "").trim())
    .filter(Boolean);
  const latestInbound = inboundAfterAsk[inboundAfterAsk.length - 1] ?? askBody;
  if (latestInbound !== askBody && !isAvailabilitySourceContext(latestInbound)) {
    return null;
  }

  return buildAvailabilityNeedDatesReply(askBody, inboundAfterAsk);
}

export function formatTonightAvailabilityReply(
  raw: string,
  checkIn: string,
  checkOut: string,
): FastFaqResult | null {
  let data: {
    kamar?: Array<{
      nama?: string;
      harga_per_malam?: number;
      kamar_tersedia?: number | null;
      tidak_tersedia?: boolean;
    }>;
  };

  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const rooms = data.kamar ?? [];
  const available = rooms
    .filter((room) => !room.tidak_tersedia && (room.kamar_tersedia ?? 0) > 0)
    .sort(
      (first, second) =>
        Number(first.harga_per_malam ?? 0) - Number(second.harga_per_malam ?? 0),
    );

  if (available.length === 0) {
    // Insiden 7 Agu 2026 (WA +62 877-0504-9842): tamu tanya "ada kamar kosong
    // buat malam ini?" saat kamar memang PENUH, dan bot menjawab "kamar yang
    // tersedia belum ada di sistem, saya bantu teruskan ke admin". Itu bocoran
    // istilah internal, membuat properti terkesan tidak terurus, dan menutup
    // peluang menawarkan tanggal alternatif.
    //
    // Bedakan dua kondisi:
    //   a. RPC gagal / semua tipe kamar tanpa angka  → status TIDAK diketahui,
    //      jangan mengklaim penuh (lihat B1 di docs/audit-chatbot-2026-08-07.md).
    //   b. Angka ada dan semuanya 0                  → memang penuh, katakan penuh.
    const availabilityUnknown =
      (data as { availability_unknown?: boolean }).availability_unknown === true ||
      (rooms.length > 0 &&
        rooms.every((room) => room.kamar_tersedia === null || room.kamar_tersedia === undefined));

    if (availabilityUnknown) {
      return {
        intent: "deterministic_tonight_availability_unknown",
        reply:
          "Mohon maaf Kak, sistem ketersediaan kami sedang tersendat sebentar. " +
          "Boleh saya cek ulang dalam beberapa saat ya? 🙏",
      };
    }

    return {
      intent: "deterministic_tonight_availability_full",
      reply:
        `Mohon maaf Kak, untuk malam ini (${fmtDateID(checkIn)} - ${fmtDateID(checkOut)}) ` +
        "seluruh kamar kami sudah penuh.\n\n" +
        "Kalau Kakak berkenan menginap di tanggal lain, kirim tanggalnya ya — nanti saya cek ketersediaannya.",
    };
  }

  const lines = available.slice(0, 6).map((room) => {
    const price = Number(room.harga_per_malam ?? 0).toLocaleString("id-ID");
    const stock = room.kamar_tersedia == null ? "" : ` (${room.kamar_tersedia} kamar tersedia)`;
    return `- ${room.nama}: Rp${price}/malam${stock}`;
  });

  return {
    intent: "deterministic_tonight_price",
    reply:
      `Untuk malam ini (${fmtDateID(checkIn)} - ${fmtDateID(checkOut)}), pilihan yang tersedia:\n` +
      `${lines.join("\n")}\n\n` +
      "Mau saya bantu pilihkan kamar yang paling sesuai, Kak?",
  };
}
