/**
 * Nilai enum `public.message_direction`.
 * Bukan kata "inbound" / "outbound" — itu membuat PostgREST menolak query riwayat.
 */
export const MESSAGE_DIRECTION_IN = "in" as const;
export const MESSAGE_DIRECTION_OUT = "out" as const;

export function intentHistoryDirections(): { outbound: "out"; inbound: "in" } {
  return { outbound: MESSAGE_DIRECTION_OUT, inbound: MESSAGE_DIRECTION_IN };
}
