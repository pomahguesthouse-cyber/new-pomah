import { createServerFn } from "@tanstack/react-start";
import { supabasePublic } from "@/integrations/supabase/client.server";

export interface GoogleReview {
  author: string;
  text: string;
  rating: number;
}

export interface GoogleReviewsResult {
  rating: number | null;
  total: number | null;
  reviews: GoogleReview[];
  status: string;
}

const empty = (status: string): GoogleReviewsResult => ({
  rating: null,
  total: null,
  reviews: [],
  status,
});

export const getGoogleReviews = createServerFn({ method: "GET" }).handler(async () => {
  const { data: prop } = await supabasePublic.rpc("get_google_reviews_config" as never);
  const row = ((Array.isArray(prop) ? prop[0] : prop) as Record<string, unknown> | null) ?? {};

  const customRating = row.custom_google_rating !== null && row.custom_google_rating !== undefined ? Number(row.custom_google_rating) : null;
  const customTotal = row.custom_google_reviews_total !== null && row.custom_google_reviews_total !== undefined ? Number(row.custom_google_reviews_total) : null;
  let customReviews: GoogleReview[] = [];
  if (row.custom_google_reviews_json) {
    try {
      const parsed = typeof row.custom_google_reviews_json === "string"
        ? JSON.parse(row.custom_google_reviews_json)
        : row.custom_google_reviews_json;
      if (Array.isArray(parsed)) {
        customReviews = parsed.map((item: any) => ({
          author: String(item.author || item.author_name || "Tamu"),
          text: String(item.text || ""),
          rating: Number(item.rating ?? 5),
        }));
      }
    } catch (e) {
      console.error("Error parsing custom google reviews JSON:", e);
    }
  }

  if (customRating !== null) {
    return {
      rating: customRating,
      total: customTotal,
      reviews: customReviews,
      status: "OK",
    } satisfies GoogleReviewsResult;
  }

  const placeId = (row.google_place_id as string | undefined)?.trim();
  const key = (
    (row.google_places_api_key as string | undefined) || process.env.GOOGLE_PLACES_API_KEY
  )?.trim();

  if (!key) return empty("NO_API_KEY");
  if (!placeId) return empty("NO_PLACE_ID");

  try {
    const url =
      "https://maps.googleapis.com/maps/api/place/details/json" +
      `?place_id=${encodeURIComponent(placeId)}` +
      "&fields=rating,user_ratings_total,reviews&language=id" +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      result?: {
        rating?: number;
        user_ratings_total?: number;
        reviews?: { author_name?: string; text?: string; rating?: number }[];
      };
    };

    if (json.status !== "OK") {
      return empty(
        json.status ? `${json.status}: ${json.error_message ?? ""}`.trim() : "API_ERROR",
      );
    }

    const result = json.result ?? {};
    const reviews: GoogleReview[] = Array.isArray(result.reviews)
      ? result.reviews
          .slice(0, 6)
          .map((review) => ({
            author: String(review.author_name ?? "Tamu"),
            text: String(review.text ?? ""),
            rating: Number(review.rating ?? 0),
          }))
          .filter((review) => review.text.length > 0)
      : [];

    return {
      rating: typeof result.rating === "number" ? result.rating : null,
      total: typeof result.user_ratings_total === "number" ? result.user_ratings_total : null,
      reviews,
      status: "OK",
    } satisfies GoogleReviewsResult;
  } catch (error) {
    return empty(`FETCH_ERROR: ${error instanceof Error ? error.message : "unknown"}`);
  }
});