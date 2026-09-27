/**
 * One in-flight read of the public property RPC, reused for 60 seconds.
 * The homepage loader, root branding, and City Guide all need this row.
 * Sharing it avoids three serial round-trips to the same function.
 */
import { supabasePublic } from "@/integrations/supabase/client.server";

const TTL_MS = 60_000;

let cache: { at: number; row: unknown } | null = null;
let pending: Promise<unknown> | null = null;

export function loadPublicPropertyRow(): Promise<unknown> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache.row);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabasePublic.rpc("get_public_property" as never);
      if (error) {
        console.warn("[public-property] rpc failed:", error.message);
        return null;
      }
      cache = { at: Date.now(), row: data ?? null };
      return cache.row;
    })().finally(() => {
      pending = null;
    });
  }
  return pending;
}
