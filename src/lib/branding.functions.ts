import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await supabase
    .from("properties")
    .select("favicon_url, logo_url")
    .limit(1)
    .maybeSingle();
  return {
    faviconUrl: (data?.favicon_url as string | null) ?? null,
    logoUrl: (data?.logo_url as string | null) ?? null,
  };
});
