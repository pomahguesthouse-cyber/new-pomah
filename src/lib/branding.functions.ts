import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await supabaseAdmin
    .from("properties")
    .select("favicon_url, logo_url")
    .limit(1)
    .maybeSingle();
  return {
    faviconUrl: (data?.favicon_url as string | null) ?? null,
    logoUrl: (data?.logo_url as string | null) ?? null,
  };
});
