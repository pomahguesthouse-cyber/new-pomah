import { createServerFn } from "@tanstack/react-start";
import { supabasePublic } from "@/integrations/supabase/client.server";

export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await supabasePublic.rpc("get_public_property" as never);
  const prop = (data ?? {}) as Record<string, unknown>;
  return {
    faviconUrl: (prop.favicon_url as string | null) ?? null,
    logoUrl: (prop.logo_url as string | null) ?? null,
    invoiceLogoUrl: (prop.invoice_logo_url as string | null) ?? null,
  };
});
