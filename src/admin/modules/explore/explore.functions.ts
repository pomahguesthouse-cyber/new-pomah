import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateExploreConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        explore_config: z.any(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("properties")
      .update({ explore_config: data.explore_config })
      .eq("id", data.id);
    
    if (error) throw error;
    return { ok: true };
  });

export const getAdminExploreData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("properties")
      .select("id, explore_config, google_place_id, updated_at")
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  });

export const getDistanceBetweenPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        destPlaceId: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // 1. Get the property's google_place_id and google_places_api_key
    const { data: prop } = await context.supabase
      .from("properties")
      .select("google_place_id, google_places_api_key")
      .limit(1)
      .maybeSingle();

    const row = (prop as Record<string, unknown> | null) ?? {};
    const originPlaceId = (row.google_place_id as string | undefined)?.trim();
    const apiKey = (
      (row.google_places_api_key as string | undefined) || process.env.GOOGLE_PLACES_API_KEY
    )?.trim();

    if (!apiKey) {
      throw new Error("API Key Google Places belum dikonfigurasi di Settings -> Integrasi.");
    }
    if (!originPlaceId) {
      throw new Error("Google Place ID penginapan belum dikonfigurasi di Settings -> Integrasi.");
    }

    try {
      const url =
        "https://maps.googleapis.com/maps/api/distancematrix/json" +
        `?origins=place_id:${encodeURIComponent(originPlaceId)}` +
        `&destinations=place_id:${encodeURIComponent(data.destPlaceId)}` +
        `&key=${encodeURIComponent(apiKey)}`;

      const res = await fetch(url);
      const json = (await res.json()) as {
        status?: string;
        error_message?: string;
        rows?: {
          elements?: {
            distance?: { text: string };
            duration?: { text: string };
            status?: string;
          }[];
        }[];
      };

      if (json.status !== "OK") {
        throw new Error(`Google API Error: ${json.status} - ${json.error_message ?? ""}`);
      }

      const element = json.rows?.[0]?.elements?.[0];
      if (!element || element.status !== "OK") {
        throw new Error(`Gagal menghitung jarak: status rute ${element?.status ?? "unknown"}`);
      }

      const distanceText = element.distance?.text ?? "";
      const durationText = element.duration?.text ?? "";

      // Translate duration to Indonesian
      const indonesianDuration = durationText
        .replace(/\bmins?\b/g, "menit")
        .replace(/\bhours?\b/g, "jam")
        .replace(/\bmins\b/g, "menit")
        .replace(/\bhour\b/g, "jam");

      return {
        distance: distanceText,
        duration: indonesianDuration,
        text: `${distanceText} (${indonesianDuration})`,
      };
    } catch (e) {
      throw new Error((e as Error).message || "Gagal menghubungi Google Maps API");
    }
  });
