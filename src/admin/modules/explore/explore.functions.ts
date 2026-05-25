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

export const autoFillFromGoogleMaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        urlOrQuery: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // 1. Get API Key & Origin Place ID
    const { data: prop } = await context.supabase
      .from("properties")
      .select("google_place_id, google_places_api_key")
      .limit(1)
      .maybeSingle();

    const row = (prop as Record<string, unknown> | null) ?? {};
    const originPlaceId = (row.google_place_id as string | undefined)?.trim();
    const apiKey = ((row.google_places_api_key as string | undefined) || process.env.GOOGLE_PLACES_API_KEY)?.trim();

    if (!apiKey) throw new Error("API Key Google Places belum dikonfigurasi.");

    try {
      let query = data.urlOrQuery;

      // 2. Resolve short links or map URLs
      if (query.includes("http")) {
        const res = await fetch(query, {
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        });
        
        const finalUrl = res.url;
        const parsed = new URL(finalUrl);
        let extractedQuery = parsed.searchParams.get("q");

        if (!extractedQuery) {
          const pathMatch = finalUrl.match(/\/maps\/place\/([^/]+)/i);
          if (pathMatch) extractedQuery = decodeURIComponent(pathMatch[1].replace(/\+/g, " "));
        }
        
        if (extractedQuery) {
          // Cegah penggunaan token enkripsi (seperti EgSinh...) sebagai query ke textsearch
          if (extractedQuery.length > 40 && !extractedQuery.includes(" ")) {
            // Tautan ini pakai token, coba ekstrak nama tempat dari meta tag/HTML
            try {
              const html = await res.text();
              const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) 
                                || html.match(/<title>([^<]+)<\/title>/i);
              if (ogTitleMatch && ogTitleMatch[1]) {
                const parsedTitle = ogTitleMatch[1]
                  .replace(/\s*-\s*Google Maps/i, "")
                  .replace(/\s*-\s*Google Search/i, "")
                  .trim();
                if (parsedTitle && parsedTitle !== "Google Maps") {
                  extractedQuery = parsedTitle;
                }
              }
            } catch (e) {
              // Abaikan jika gagal parsing HTML, biarkan error dilempar di bawah
            }

            // Jika masih berupa token setelah mencoba parse HTML
            if (extractedQuery.length > 40 && !extractedQuery.includes(" ")) {
              throw new Error("Tautan Google Maps ini menggunakan token terenkripsi. Harap ketik nama tempat secara langsung (misal: 'Lawang Sewu') untuk hasil yang akurat.");
            }
          }
          query = extractedQuery;
        }
      }

      // 3. Search Place ID via Text Search API
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchJson = await searchRes.json() as any;

      if (searchJson.status !== "OK" || !searchJson.results?.length) {
        throw new Error(`Tempat tidak ditemukan di Google Maps. (Query: ${query})`);
      }

      const placeId = searchJson.results[0].place_id;

      // 4. Get Place Details
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,formatted_address,photos,editorial_summary&key=${apiKey}&language=id`;
      const detailsRes = await fetch(detailsUrl);
      const detailsJson = await detailsRes.json() as any;

      if (detailsJson.status !== "OK") {
        throw new Error("Gagal mengambil detail tempat dari Google Maps API.");
      }

      const result = detailsJson.result;
      
      let imageUrl = "";
      if (result.photos && result.photos.length > 0) {
        imageUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${result.photos[0].photo_reference}&key=${apiKey}`;
      }

      let nearby_distance = "";
      // 5. Get distance if originPlaceId is available
      if (originPlaceId) {
         try {
           const distUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=place_id:${encodeURIComponent(originPlaceId)}&destinations=place_id:${placeId}&key=${apiKey}`;
           const distRes = await fetch(distUrl);
           const distJson = await distRes.json() as any;
           if (distJson.status === "OK" && distJson.rows?.[0]?.elements?.[0]?.status === "OK") {
             const element = distJson.rows[0].elements[0];
             const distanceText = element.distance.text;
             const durationText = element.duration.text
                .replace(/\bmins?\b/g, "menit")
                .replace(/\bhours?\b/g, "jam")
                .replace(/\bmins\b/g, "menit")
                .replace(/\bhour\b/g, "jam");
             nearby_distance = `${distanceText} (${durationText})`;
           }
         } catch(e) {
           // Ignore distance error if it fails
         }
      }

      return {
        name: result.name || "",
        address: result.formatted_address || "",
        rating: result.rating ? result.rating.toString() : "0",
        reviewCount: result.user_ratings_total ? result.user_ratings_total.toString() : "0",
        desc: result.editorial_summary?.overview || "",
        google_place_id: placeId,
        image: imageUrl,
        nearby_distance
      };
    } catch (e) {
      throw new Error((e as Error).message || "Terjadi kesalahan saat Auto-Fill dari Google.");
    }
  });
