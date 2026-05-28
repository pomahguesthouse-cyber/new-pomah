import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/place-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const photoReference = url.searchParams.get("photo_reference");
          const maxWidth = url.searchParams.get("maxwidth") || "800";

          if (!photoReference) {
            return new Response("Missing photo_reference parameter", { status: 400 });
          }

          // 1. Fetch Google Places API Key from properties table
          const { data: prop } = await (supabaseAdmin as any)
            .from("properties")
            .select("google_places_api_key")
            .limit(1)
            .maybeSingle();

          const apiKey = (prop?.google_places_api_key || process.env.GOOGLE_PLACES_API_KEY)?.trim();

          if (!apiKey) {
            return new Response("Google Places API Key not configured on the server", { status: 400 });
          }

          // 2. Fetch the photo from Google Places API
          const googlePhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${encodeURIComponent(photoReference)}&key=${encodeURIComponent(apiKey)}`;
          
          // We make a request to Google API. We want to get the redirect URL (Google CDN).
          // Using redirect: "manual" lets us intercept the 302/307 redirect from Google.
          const res = await fetch(googlePhotoUrl, {
            redirect: "manual",
          });

          // Google Place Photo API returns a 302 redirect to the actual image CDN URL
          const redirectUrl = res.headers.get("location");

          if (redirectUrl) {
            // Return a redirect to the client to the safe public CDN URL (no API key exposed)
            return new Response(null, {
              status: 307,
              headers: {
                Location: redirectUrl,
                "Cache-Control": "public, max-age=86400", // Cache redirect for 1 day
              },
            });
          }

          // If for some reason it didn't redirect but returned the body directly (or an error)
          if (res.status === 200) {
            const contentType = res.headers.get("content-type") || "image/jpeg";
            const buffer = await res.arrayBuffer();
            return new Response(buffer, {
              status: 200,
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=86400",
              },
            });
          }

          // If there is an error response from Google
          const text = await res.text();
          console.error("Google Place Photo error response:", text);
          return new Response(`Failed to fetch photo from Google: HTTP ${res.status}`, { status: res.status });
        } catch (error: any) {
          console.error("api/place-photo error:", error);
          return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
        }
      },
    },
  },
});
