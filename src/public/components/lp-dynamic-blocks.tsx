/**
 * Server-friendly blocks. Pass loader data in; nothing here fetches.
 * Layout stays one column so a 344px cover screen does not overflow.
 */
import { POMAH_GEO } from "@/public/lib/site-identity";
import {
  filterReviews,
  filterRooms,
  formatIdr,
  mapsDirectionsUrl,
  mapsEmbedUrl,
  roomRate,
  selectExplore,
  selectLandmarks,
  startingRate,
  type DynamicExplore,
  type DynamicLandmark,
  type DynamicReview,
  type DynamicRoom,
} from "@/public/lib/lp-dynamic";

const sectionTitle = "font-serif text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl";

export function LocationBlock({
  title,
  landmarkIds,
  landmarks,
  showUnverified = false,
}: {
  title?: string;
  landmarkIds: readonly string[];
  landmarks: readonly DynamicLandmark[];
  showUnverified?: boolean;
}) {
  const rows = selectLandmarks(landmarks, landmarkIds).filter((row) => row.verified || showUnverified);
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      {title ? <h2 className={sectionTitle}>{title}</h2> : null}
      <ul className="mt-6 space-y-4">
        {rows.map((row) => {
          const verified = row.verified && row.road_distance_km != null && row.travel_minutes != null;
          const lat = row.lat;
          const lng = row.lng;
          const hasPoint = lat != null && lng != null;
          return (
            <li key={row.id} className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{row.category || "Lokasi"}</p>
              <p className="mt-1 break-words text-base font-semibold text-stone-900">{row.name}</p>
              {verified ? (
                <p className="mt-1 text-sm text-stone-600">
                  {row.road_distance_km} km · {row.travel_minutes} menit berkendara dari Pomah
                </p>
              ) : (
                <p className="mt-1 text-sm text-amber-800">Jarak belum diverifikasi, jadi tidak ditampilkan.</p>
              )}
              {hasPoint ? (
                <div className="mt-3 space-y-2">
                  <a
                    href={mapsDirectionsUrl(lat, lng, POMAH_GEO.latitude, POMAH_GEO.longitude)}
                    className="inline-flex text-sm font-semibold text-amber-800 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Buka rute di Google Maps
                  </a>
                  <iframe
                    title={`Peta ${row.name}`}
                    src={mapsEmbedUrl(lat, lng)}
                    loading="lazy"
                    className="h-40 w-full rounded-xl border border-stone-200"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FilteredRoomsBlock({
  title,
  rooms,
  roomTypeIds,
  minCapacity,
}: {
  title?: string;
  rooms: readonly DynamicRoom[];
  roomTypeIds?: readonly string[] | null;
  minCapacity?: number | null;
}) {
  const rows = filterRooms(rooms, { roomTypeIds, minCapacity });
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      {title ? <h2 className={sectionTitle}>{title}</h2> : null}
      <ul className="mt-6 grid grid-cols-1 gap-4">
        {rows.map((room) => {
          const rate = roomRate(room);
          return (
            <li key={room.id} className="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {room.hero_image_url ? (
                <img src={room.hero_image_url} alt={room.name} className="h-40 w-full object-cover" />
              ) : null}
              <div className="p-4">
                <a href={`/rooms/${room.slug}`} className="break-words text-lg font-semibold text-stone-900 underline">
                  {room.name}
                </a>
                <p className="mt-1 text-sm text-stone-600">
                  {room.capacity ? `Muat ${room.capacity} tamu` : "Kapasitas menyusul"}
                  {rate != null ? ` · ${formatIdr(rate)} / malam` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function StartingPriceBlock({
  title,
  rooms,
}: {
  title?: string;
  rooms: readonly DynamicRoom[];
}) {
  const rate = startingRate(rooms);
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">{title || "Mulai dari"}</p>
      <p className="mt-1 font-serif text-3xl font-semibold text-stone-900">
        {rate != null ? formatIdr(rate) : "Harga menyusul"}
      </p>
      <p className="mt-1 text-sm text-stone-600">per malam, dari tipe kamar yang sedang ditampilkan.</p>
    </section>
  );
}

export function RelatedExploreBlock({
  title,
  places,
  slugs,
  tag,
}: {
  title?: string;
  places: readonly DynamicExplore[];
  slugs?: readonly string[] | null;
  tag?: string | null;
}) {
  const rows = selectExplore(places, { slugs, tag });
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      {title ? <h2 className={sectionTitle}>{title}</h2> : null}
      <ul className="mt-4 space-y-2">
        {rows.map((place) => (
          <li key={place.slug}>
            <a href={`/explore/${place.slug}`} className="break-words text-base font-semibold text-amber-800 underline">
              {place.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FilteredReviewsBlock({
  title,
  reviews,
  keywords,
  limit,
}: {
  title?: string;
  reviews: readonly DynamicReview[];
  keywords?: readonly string[] | null;
  limit?: number | null;
}) {
  const rows = filterReviews(reviews, keywords ?? [], limit ?? 3);
  if (rows.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      {title ? <h2 className={sectionTitle}>{title}</h2> : null}
      <ul className="mt-4 space-y-3">
        {rows.map((review, index) => (
          <li key={`${review.author}-${index}`} className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm font-semibold text-stone-900">{review.author}</p>
            <p className="mt-2 break-words text-sm leading-relaxed text-stone-700">{review.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
