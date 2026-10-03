/**
 * Pilihan konkret saat jumlah tamu melebihi satu kamar.
 * Stok `available: null` artinya tidak diketahui — jangan diklaim tersedia.
 */

export type RoomStock = {
  roomTypeId: string;
  name: string;
  capacity: number;
  extrabedCapacity: number;
  extrabedRate: number;
  pricePerNight: number;
  available: number | null;
};

export type CapacityChoice = {
  kind: "same_type" | "fit_type";
  room: RoomStock;
  quantity: number;
  extraBeds: number;
  total: number;
};

const fmtRp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function maxGuestsPerRoom(room: Pick<RoomStock, "capacity" | "extrabedCapacity">): number {
  return Math.max(0, room.capacity) + Math.max(0, room.extrabedCapacity);
}

export function roomsNeeded(guests: number, perRoomMax: number): number {
  if (perRoomMax <= 0 || guests <= 0) return 1;
  return Math.ceil(guests / perRoomMax);
}

export function extraBedsFor(room: RoomStock, quantity: number, guests: number): number {
  const base = Math.max(0, room.capacity) * quantity;
  if (guests <= base) return 0;
  const cap = Math.max(0, room.extrabedCapacity) * quantity;
  return Math.min(guests - base, cap);
}

export function choiceTotal(
  room: RoomStock,
  quantity: number,
  extraBeds: number,
  nights: number,
): number {
  const stay = Math.max(0, nights);
  const roomTotal = Math.max(0, room.pricePerNight) * quantity * stay;
  const bedTotal =
    extraBeds > 0 && room.extrabedRate > 0 ? extraBeds * room.extrabedRate * stay : 0;
  return Math.round(roomTotal + bedTotal);
}

export function buildCapacityAlternatives(opts: {
  guests: number;
  nights: number;
  selected: RoomStock;
  catalog: RoomStock[];
}): CapacityChoice[] {
  const nights = opts.nights > 0 ? opts.nights : 1;
  const choices: CapacityChoice[] = [];
  const perRoom = maxGuestsPerRoom(opts.selected);
  const qty = roomsNeeded(opts.guests, perRoom);
  const selectedAvailable = opts.selected.available;
  if (
    qty >= 2 &&
    selectedAvailable != null &&
    selectedAvailable >= qty &&
    opts.selected.pricePerNight > 0
  ) {
    const extraBeds = extraBedsFor(opts.selected, qty, opts.guests);
    choices.push({
      kind: "same_type",
      room: opts.selected,
      quantity: qty,
      extraBeds,
      total: choiceTotal(opts.selected, qty, extraBeds, nights),
    });
  }

  for (const room of opts.catalog) {
    if (room.roomTypeId === opts.selected.roomTypeId) continue;
    if (room.available == null || room.available < 1) continue;
    if (maxGuestsPerRoom(room) < opts.guests) continue;
    if (!(room.pricePerNight > 0)) continue;
    const extraBeds = extraBedsFor(room, 1, opts.guests);
    choices.push({
      kind: "fit_type",
      room,
      quantity: 1,
      extraBeds,
      total: choiceTotal(room, 1, extraBeds, nights),
    });
  }
  return choices;
}

export function formatCapacityAlternativesReply(opts: {
  guests: number;
  selectedName: string;
  selectedMax: number;
  nights: number;
  choices: CapacityChoice[];
}): string {
  const head =
    `Mohon maaf Kak, ${opts.guests} tamu melebihi kapasitas 1 kamar ${opts.selectedName} ` +
    `(maksimal ${opts.selectedMax} tamu termasuk extra bed).`;
  if (opts.choices.length === 0) {
    return (
      `${head} Saya belum bisa memastikan kombinasi kamar yang tersedia dari data stok. ` +
      `Kalau berkenan, sebutkan tipe atau jumlah kamar yang diinginkan, nanti saya sesuaikan.`
    );
  }
  const lines = opts.choices.map((choice, index) => {
    const extra = choice.extraBeds > 0 ? `, termasuk ${choice.extraBeds} extra bed` : "";
    const label =
      choice.kind === "same_type"
        ? `${choice.quantity}x ${choice.room.name}`
        : `${choice.room.name} (muat ${maxGuestsPerRoom(choice.room)} tamu)`;
    return `${index + 1}. ${label} — total ${fmtRp(choice.total)} untuk ${opts.nights} malam${extra}`;
  });
  return (
    `${head}\n\nYang bisa saya tawarkan:\n${lines.join("\n")}\n\n` +
    `Balas "tambah kamar" untuk menambah kamar yang sama, atau "pesan 1 dulu" kalau ingin 1 kamar dulu ya Kak.`
  );
}

export function parseCapacityFollowup(message: string): "add_room" | "book_one" | null {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (
    /\b(pesan|booking|ambil)\s+1\s+dulu\b/.test(text) ||
    /\b(?:pesan|booking|ambil|satu|1)\s+(?:1\s+|satu\s+)?kamar\s+dulu\b/.test(text)
  ) {
    return "book_one";
  }
  if (/\b(tambah\s+kamar|tambah\s+1\s+kamar|tambah\s+satu\s+kamar)\b/.test(text)) return "add_room";
  return null;
}

/**
 * "Pesan 1 dulu" saat rombongan tidak muat: pertahankan anak, kurangi dewasa,
 * minimal 1 dewasa. Ini pilihan eksplisit tamu, bukan default diam-diam.
 */
export function fitPartyToOneRoom(
  adults: number,
  children: number,
  maxGuests: number,
): { adults: number; children: number; adjusted: boolean } {
  const safeAdults = Math.max(0, adults);
  const safeChildren = Math.max(0, children);
  const max = Math.max(1, maxGuests);
  if (safeAdults + safeChildren <= max) {
    const adultsOut = safeAdults > 0 ? safeAdults : safeChildren > 0 ? safeAdults : 1;
    return { adults: adultsOut, children: safeChildren, adjusted: false };
  }
  const childrenFinal = Math.min(safeChildren, max - 1);
  const adultsFinal = Math.max(1, max - childrenFinal);
  return { adults: adultsFinal, children: childrenFinal, adjusted: true };
}

export function capacityBlockerFingerprint(
  roomTypeId: string,
  guests: number,
  nights: number,
): string {
  return `${roomTypeId}|${guests}|${nights}`;
}
