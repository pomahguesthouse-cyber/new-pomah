import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribe to Postgres changes on the given tables and invalidate the
 * provided React Query keys whenever any of them changes.
 */
export function useRealtimeInvalidate(
  channelName: string,
  tables: string[],
  queryKeys: (string | (string | number)[])[],
) {
  const qc = useQueryClient();
  useEffect(() => {
    let ch = supabase.channel(channelName);
    for (const table of tables) {
      ch = ch.on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table },
        () => {
          for (const key of queryKeys) {
            qc.invalidateQueries({
              queryKey: Array.isArray(key) ? key : [key],
            });
          }
        },
      );
    }
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tables.join(","), JSON.stringify(queryKeys)]);
}
