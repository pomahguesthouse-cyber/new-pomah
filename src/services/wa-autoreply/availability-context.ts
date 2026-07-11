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

  const available = (data.kamar ?? [])
    .filter((room) => !room.tidak_tersedia && (room.kamar_tersedia ?? 0) > 0)
    .sort(
      (first, second) =>
        Number(first.harga_per_malam ?? 0) - Number(second.harga_per_malam ?? 0),
    );

  if (available.length === 0) {
    return {
      intent: "deterministic_tonight_availability",
      reply:
        `Untuk malam ini (${fmtDateID(checkIn)} - ${fmtDateID(checkOut)}), ` +
        "sementara kamar yang tersedia belum ada di sistem. Saya bantu teruskan ke admin ya Kak.",
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
