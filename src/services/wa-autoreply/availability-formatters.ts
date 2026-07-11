import {
  messageOpensWithGreeting,
  type ParsedGuestCount,
} from "@/services/wa-autoreply/message-parsers";

type FastFaqResult = {
  reply: string;
  intent: string;
  dates?: { checkIn: string; checkOut: string };
};

export function buildAvailabilityNeedDatesReply(
  askMessage: string,
  recentInboundMessages: string[] = [],
): FastFaqResult {
  const mentionsSource = [askMessage, ...recentInboundMessages].some((message) =>
    /\b(tiktok|tik tok|instagram|ig|facebook|fb|google|maps?)\b/i.test(message),
  );
  const prefix = messageOpensWithGreeting(askMessage)
    ? "Halo Kak, "
    : mentionsSource
      ? "Terima kasih infonya Kak. "
      : "";

  return {
    intent: "deterministic_availability_need_dates",
    reply:
      `${prefix}Untuk cek ketersediaan kamar, boleh tahu rencana menginap tanggal berapa sampai tanggal berapa?`,
  };
}

export function formatAvailabilityReply(raw: string, greet = false): FastFaqResult | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(data.kamar)) return null;
  const period = typeof data.periode === "string" ? data.periode : data.tanggal ?? "tanggal tersebut";
  const rooms = data.kamar as Array<Record<string, unknown>>;
  const available = rooms.filter(
    (room) => Number(room.kamar_tersedia ?? 0) > 0 && room.tidak_tersedia !== true,
  );

  if (available.length === 0) {
    return {
      intent: "deterministic_availability_full",
      reply:
        `${greet ? "Halo Kak, mohon" : "Mohon"} maaf Kak, untuk tanggal ${period} kamar kami sudah penuh.\n\n` +
        "Kalau Kakak berkenan, kirim tanggal alternatif ya, nanti saya cek lagi.",
    };
  }

  const lines = available.slice(0, 5).map((room) => {
    const count = Number(room.kamar_tersedia ?? 0);
    const price = Number(room.harga_per_malam ?? room.nightly_rate ?? 0);
    const priceText = price > 0 ? `, Rp${price.toLocaleString("id-ID")}/malam` : "";
    return `- ${String(room.nama ?? "Kamar")}: ${count} kamar tersedia${priceText}`;
  });

  return {
    intent: "deterministic_availability",
    reply:
      `${greet ? "Halo Kak, untuk" : "Untuk"} tanggal ${period}, masih tersedia:\n${lines.join("\n")}\n\n` +
      "Kakak rencana untuk berapa orang?",
  };
}

export function lastBotAskedGuestCount(
  messages: Array<{ direction: string; body?: string }>,
): boolean {
  const lastOutbound = [...messages]
    .reverse()
    .find((message) => message.direction === "out" && (message.body ?? "").trim());
  const body = (lastOutbound?.body ?? "").toLowerCase();
  return /\brencana untuk berapa orang\b|\bberapa orang\b/.test(body) && /\btersedia\b/.test(body);
}

export function formatAvailabilityForGuestCount(
  raw: string,
  guests: ParsedGuestCount,
): FastFaqResult | null {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(data.kamar)) return null;
  const period = typeof data.periode === "string" ? data.periode : data.tanggal ?? "tanggal tersebut";
  const rooms = data.kamar as Array<Record<string, unknown>>;
  const available = rooms.filter(
    (room) => Number(room.kamar_tersedia ?? 0) > 0 && room.tidak_tersedia !== true,
  );
  const suitable = available.filter((room) => room.cocok_untuk_jumlah_tamu === true);
  const guestLabel =
    guests.children > 0
      ? `${guests.adults} dewasa dan ${guests.children} anak`
      : `${guests.total} tamu`;

  if (suitable.length > 0) {
    const lines = suitable.slice(0, 5).map((room) => {
      const count = Number(room.kamar_tersedia ?? 0);
      const price = Number(room.harga_per_malam ?? room.nightly_rate ?? 0);
      const maxGuests = Number(
        room.kapasitas_maksimal_dengan_extra_bed ?? room.kapasitas_tamu ?? 0,
      );
      const extraBeds = Number(room.extra_bed_dibutuhkan ?? 0);
      const extraBedRate = Number(room.tarif_extra_bed_per_malam ?? 0);
      const priceText = price > 0 ? `, Rp${price.toLocaleString("id-ID")}/malam` : "";
      const capacityText = maxGuests > 0 ? `, maks ${maxGuests} tamu/kamar` : "";
      const extraBedText =
        extraBeds > 0
          ? extraBedRate > 0
            ? `, butuh ${extraBeds} extra bed @ Rp${extraBedRate.toLocaleString("id-ID")}/malam`
            : `, butuh ${extraBeds} extra bed`
          : "";
      return `- ${String(room.nama ?? "Kamar")}: ${count} kamar tersedia${priceText}${capacityText}${extraBedText}`;
    });

    return {
      intent: "deterministic_availability_guest_count",
      reply:
        `Untuk ${period} dengan ${guestLabel}, pilihan yang tersedia dan cukup kapasitas:\n` +
        `${lines.join("\n")}\n\n` +
        "Kakak mau pilih tipe kamar yang mana?",
    };
  }

  if (available.length === 0) {
    return {
      intent: "deterministic_availability_full",
      reply:
        `Mohon maaf Kak, untuk ${period} kamar kami sudah penuh.\n\n` +
        "Kalau Kakak berkenan, kirim tanggal alternatif ya, nanti saya cek lagi.",
    };
  }

  const lines = available.slice(0, 5).map((room) => {
    const count = Number(room.kamar_tersedia ?? 0);
    const maxGuests = Number(
      room.kapasitas_maksimal_dengan_extra_bed ?? room.kapasitas_tamu ?? 0,
    );
    const capacityText = maxGuests > 0 ? `maks ${maxGuests} tamu/kamar` : "kapasitas belum terdata";
    return `- ${String(room.nama ?? "Kamar")}: ${count} kamar tersedia, ${capacityText}`;
  });

  return {
    intent: "deterministic_availability_over_capacity",
    reply:
      `Maaf Kak, untuk ${period} belum ada tipe kamar tersedia yang cukup untuk ${guestLabel}.\n\n` +
      `Yang masih tersedia:\n${lines.join("\n")}\n\n` +
      "Kakak mau coba tanggal lain, atau saya bantu cek opsi kamar lain kalau ada?",
  };
}
