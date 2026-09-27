import { createServerFn } from "@tanstack/react-start";
import { loadPublicPropertyRow } from "@/public/lib/public-property.server";
import { toPublicSettings } from "@/public/lib/public-settings";

export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const data = await loadPublicPropertyRow();
  const prop = (toPublicSettings(data) ?? {}) as Record<string, unknown>;
  return {
    faviconUrl: (prop.favicon_url as string | null) ?? null,
    logoUrl: (prop.logo_url as string | null) ?? null,
    invoiceLogoUrl: (prop.invoice_logo_url as string | null) ?? null,
  };
});
