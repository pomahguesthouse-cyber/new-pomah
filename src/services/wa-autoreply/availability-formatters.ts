import {
  messageOpensWithGreeting,
  type ParsedGuestCount,
} from "@/services/wa-autoreply/message-parsers";

type FastFaqResult = {
  reply: string;
  intent: string;
  dates?: { checkIn: string; checkOut: string };
};

type RoomCombinationOption = {
  name: string;
  available: number;
  capacity: number;
  price: number;
};

type RoomCombinationPick = RoomCombinationOption & {
  quantity: number;
};

function formatRp(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

function topLevelReply(data: Record<string, unknown>, fallbackIntent: string): FastFaqResult | null {
  const reply = typeof data.reply_to_guest === "string" ? data.reply_to_guest.trim() : "";
  if (!reply) return null;
  if (data.relay_verbatim === true) {
    return {
      intent:
        data.availability_status === "sold_out"
          ? "deterministic_availability_full"
          : fallbackIntent,
      reply,
    };
  }
  return null;
}

function buildCombinationOptions(
  data: Record<string, unknown>,
  availableRooms: Array<Record<string, unknown>>,
): RoomCombinationOption[] {
  const inventory = Array.isArray(data.inventori_tersedia)
    ? (data.inventori_tersedia as Array<Record<string, unknown>>)
    : [];
  const source = inventory.length > 0 ? inventory : availableRooms;

  return source
    .map((room) => {
      const name = String(room.nama ?? "Kamar");
      const available = Math.max(
        0,
        Math.floor(Number(room.jumlah_kamar ?? room.kamar_tersedia ?? 0)),
      );
      const capacity = Math.max(
        0,
        Math.floor(
          Number(
            room.kapasitas_per_kamar ??
              room.kapasitas_maksimal_dengan_extra_bed ??
              room.kapasitas_tamu ??
              0,
          ),
        ),
      );
      const price = Math.max(0, Number(room.harga_per_malam ?? room.nightly_rate ?? 0));
      return { name, available, capacity, price };
    })
    .filter((room) => room.available > 0 && room.capacity > 0);
}

function findBestCombination(
  options: RoomCombinationOption[],
  guestCount: number,
): { picks: RoomCombinationPick[]; capacity: number; rooms: number; price: number } | null {
  let best: { picks: RoomCombinationPick[]; capacity: number; rooms: number; price: number } | null = null;
  const counts = new Array(options.length).fill(0);

  const visit = (index: number, capacity: number, rooms: number, price: number) => {
    if (index === options.length) {
      if (capacity < guestCount || rooms <= 0) return;
      const picks = options
        .map((option, i) => ({ ...option, quantity: counts[i] }))
        .filter((pick) => pick.quantity > 0);
      const candidate = { picks, capacity, rooms, price };
      if (
        !best ||
        candidate.rooms < best.rooms ||
        (candidate.rooms === best.rooms && candidate.price < best.price) ||
        (candidate.rooms === best.rooms && candidate.price === best.price && candidate.capacity < best.capacity)
      ) {
        best = candidate;
      }
      return;
    }

    const option = options[index];
    const maxNeeded = Math.min(option.available, Math.ceil(guestCount / option.capacity));
    for (let quantity = 0; quantity <= maxNeeded; quantity += 1) {
      counts[index] = quantity;
      visit(
        index + 1,
        capacity + quantity * option.capacity,
        rooms + quantity,
        price + quantity * option.price,
      );
    }
    counts[index] = 0;
  };

  visit(0, 0, 0, 0);
  return best;
}

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
  const terminalReply = topLevelReply(data, "deterministic_availability_over_capacity");
  if (terminalReply) return terminalReply;

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
  const terminalReply = topLevelReply(data, "deterministic_availability_over_capacity");
  if (terminalReply) return terminalReply;

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

  const options = buildCombinationOptions(data, available);
  const combination = findBestCombination(options, guests.total);
  if (combination) {
    const lines = combination.picks.map((pick) => {
      const totalPrice = pick.price * pick.quantity;
      const priceText = totalPrice > 0 ? `, total ${formatRp(totalPrice)}/malam` : "";
      return `- ${pick.quantity} kamar ${pick.name}: kapasitas sampai ${pick.quantity * pick.capacity} tamu${priceText}`;
    });

    return {
      intent: "deterministic_availability_multi_room_combination",
      reply:
        `Untuk ${period} dengan ${guestLabel}, tidak ada satu kamar yang cukup sendiri, tapi masih bisa pakai kombinasi beberapa kamar:\n` +
        `${lines.join("\n")}\n\n` +
        `Total kapasitas kombinasi ini sampai ${combination.capacity} tamu. Kakak mau saya bantu proses opsi ${combination.rooms} kamar ini?`,
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
      `Maaf Kak, untuk ${period} stok kamar yang tersedia belum cukup untuk ${guestLabel}.\n\n` +
      `Yang masih tersedia:\n${lines.join("\n")}\n\n` +
      "Kalau tanggalnya tidak bisa diubah, saat ini belum ada opsi kamar lain yang cukup di sistem.",
  };
}
