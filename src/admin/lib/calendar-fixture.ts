import { addDays, format, startOfDay } from "date-fns";

/**
 * Dev-only calendar preview. Production builds constant-fold DEV to false,
 * and a deployed dev build still requires localhost. Used so the Fold layout
 * can be screenshotted without a staff session.
 */
export function isCalendarFixtureRequest(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
  const query = new URLSearchParams(window.location.search);
  if (query.get("calFixture") === "1") return true;
  return window.location.hash.includes("calFixture=1");
}

export type CalendarFixtureDialog = "detail" | "create" | "block" | "new";

export function calendarFixtureDialog(): CalendarFixtureDialog | null {
  if (!isCalendarFixtureRequest() || typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const fromQuery = query.get("dialog");
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("dialog");
  const dialog = fromQuery || fromHash;
  if (dialog === "detail" || dialog === "create" || dialog === "block" || dialog === "new") {
    return dialog;
  }
  return null;
}

const DELUXE = "11111111-1111-4111-8111-111111111101";
const SUPERIOR = "11111111-1111-4111-8111-111111111102";
const FAMILY = "11111111-1111-4111-8111-111111111103";

const TYPES = [
  { id: DELUXE, name: "Deluxe", base_rate: 450_000, numbers: ["101", "102", "103"] },
  { id: SUPERIOR, name: "Superior", base_rate: 350_000, numbers: ["201", "202", "203", "204"] },
  { id: FAMILY, name: "Family", base_rate: 650_000, numbers: ["301", "302", "303"] },
] as const;

function roomId(n: number) {
  return `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
}

function bookingId(n: number) {
  return `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
}

function bookingRoomId(n: number) {
  return `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
}

function iso(base: Date, offset: number) {
  return format(addDays(base, offset), "yyyy-MM-dd");
}

export type CalendarFixtureRoomRow = {
  id: string;
  number: string;
  status: "clean";
  room_types: {
    id: string;
    name: string;
    base_rate: number;
    capacity: number;
    extrabed_capacity: number;
    extrabed_rate: number;
  };
};

/** ~10 rooms and overlapping stays around today, for the dev calendar preview. */
export function buildCalendarFixture() {
  const today = startOfDay(new Date());
  const rooms: Array<{ id: string; number: string; room_type_id: string }> = [];
  const byNumber = new Map<string, { id: string; room_type_id: string; rate: number }>();
  let n = 1;
  for (const type of TYPES) {
    for (const number of type.numbers) {
      const id = roomId(n);
      rooms.push({ id, number, room_type_id: type.id });
      byNumber.set(number, { id, room_type_id: type.id, rate: type.base_rate });
      n += 1;
    }
  }

  const stay = (opts: {
    n: number;
    room: string | null;
    name: string;
    code: string;
    from: number;
    to: number;
    status: string;
  }) => {
    const room = opts.room ? byNumber.get(opts.room) : undefined;
    const typeId = room?.room_type_id ?? DELUXE;
    return {
      id: bookingId(opts.n),
      booking_room_id: room ? bookingRoomId(opts.n) : null,
      room_id: room?.id ?? null,
      room_type_id: typeId,
      reference_code: opts.code,
      check_in: iso(today, opts.from),
      check_out: iso(today, opts.to),
      status: opts.status,
      nightly_rate: room?.rate ?? 450_000,
      guests: { full_name: opts.name, email: null, phone: null },
    };
  };

  const bookings = [
    stay({ n: 1, room: "101", name: "Budi Santoso", code: "PMH-2041", from: -1, to: 4, status: "confirmed" }),
    stay({ n: 2, room: "102", name: "Siti Rahmawati Kusumawardani", code: "PMH-2042", from: 0, to: 5, status: "checked_in" }),
    // Overlaps the stay above on the same room.
    stay({ n: 3, room: "102", name: "Agus Wijaya", code: "PMH-2088", from: 2, to: 7, status: "pending" }),
    stay({ n: 4, room: "103", name: "Dewi Lestari", code: "PMH-2104", from: 1, to: 3, status: "confirmed" }),
    stay({ n: 5, room: "201", name: "Rina Marlina", code: "PMH-2210", from: -2, to: 2, status: "checked_in" }),
    stay({ n: 6, room: "202", name: "Hendra Gunawan", code: "PMH-2218", from: 3, to: 8, status: "confirmed" }),
    stay({ n: 7, room: "203", name: "Maya Putri", code: "PMH-2301", from: 0, to: 2, status: "pending" }),
    stay({ n: 8, room: "204", name: "Joko Prasetyo", code: "PMH-2309", from: 6, to: 11, status: "confirmed" }),
    stay({ n: 9, room: "301", name: "Keluarga Hartono", code: "PMH-2402", from: 1, to: 6, status: "confirmed" }),
    stay({ n: 10, room: "302", name: "Lia Anggraini", code: "PMH-2411", from: 4, to: 6, status: "checked_out" }),
    stay({ n: 11, room: "303", name: "Bambang Sutrisno", code: "PMH-2419", from: 8, to: 12, status: "confirmed" }),
    stay({ n: 12, room: null, name: "Tamu Website", code: "PMH-2501", from: 2, to: 4, status: "pending" }),
  ];

  const blocks = [0, 1].map((offset) => ({
    room_type_id: FAMILY,
    date: iso(today, 9 + offset),
    note: "Renovasi AC",
  }));

  return {
    roomTypes: TYPES.map((type) => ({
      id: type.id,
      name: type.name,
      base_rate: type.base_rate,
    })),
    rooms,
    bookings,
    blocks,
  };
}

export function calendarFixtureRooms(): CalendarFixtureRoomRow[] {
  const data = buildCalendarFixture();
  const typeById = new Map<string, { id: string; name: string; base_rate: number }>(
    data.roomTypes.map((type) => [type.id, type]),
  );
  return data.rooms.map((room) => {
    const type = typeById.get(room.room_type_id)!;
    return {
      id: room.id,
      number: room.number,
      status: "clean",
      room_types: {
        id: type.id,
        name: type.name,
        base_rate: type.base_rate,
        capacity: 2,
        extrabed_capacity: 1,
        extrabed_rate: 75_000,
      },
    };
  });
}
