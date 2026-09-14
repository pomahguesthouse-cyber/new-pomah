type AvailabilityResult = {
  availableRooms: Record<string, number | string | null | undefined>;
  debug?: { error?: string | null };
};

/** Unknown/error is not stock. A missing room in a completed result has no availability. */
export function getAvailableRoomCount(
  result: AvailabilityResult | null | undefined,
  roomTypeId: string,
): number | null {
  if (!result || result.debug?.error) return null;
  const count = Number(result.availableRooms[roomTypeId] ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function roomAvailabilityLabel(count: number | null): string {
  if (count === null) return "Mengecek ketersediaan…";
  return count <= 0 ? "Tidak tersedia" : `${count} kamar tersedia`;
}

export function canReserveRooms(count: number | null, quantity = 1): boolean {
  return count !== null && Number.isInteger(quantity) && quantity > 0 && quantity <= count;
}
