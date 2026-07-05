import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizePhone(raw: string) {
  let value = String(raw ?? "").trim();
  value = value
    .replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (value.startsWith("620")) value = "62" + value.slice(3);
  else if (value.startsWith("0")) value = "62" + value.slice(1);
  else if (/^8\d{7,14}$/.test(value)) value = "62" + value;
  return value;
}

export const mapWhatsappLidToPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    lid: z.string().trim().min(5).max(120),
    phone: z.string().trim().min(8).max(40),
    displayName: z.string().trim().max(120).nullable().optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const canonicalPhone = normalizePhone(data.phone);
    const lidDigits = normalizePhone(data.lid);
    if (!/^62\d{8,14}$/.test(canonicalPhone)) {
      throw new Error("Nomor WA harus format Indonesia, contoh 6281234567890.");
    }
    if (!/^\d{8,20}$/.test(lidDigits)) {
      throw new Error("LID tidak valid.");
    }

    const displayName = data.displayName?.trim() || null;
    for (const alias of [lidDigits, `${lidDigits}@lid`, canonicalPhone, `${canonicalPhone}@c.us`]) {
      const aliasType = alias.includes("@lid") || alias === lidDigits ? "lid" : "phone";
      const { error } = await (supabaseAdmin as any).rpc("upsert_wa_identity_alias", {
        p_canonical_phone: canonicalPhone,
        p_alias_value: alias,
        p_alias_type: aliasType,
        p_role: "guest",
        p_display_name: displayName,
        p_source: "whatsapp_correction_manual_map",
        p_metadata: { note: "Manual mapping dari WhatsApp Correction", lid: lidDigits },
      });
      if (error) throw error;
    }

    try {
      await (supabaseAdmin as any).rpc("merge_wa_threads_to_canonical_phone", { p_canonical_phone: canonicalPhone });
    } catch (e) {
      console.warn("[wa-identity-map] merge skipped:", e);
    }

    return { ok: true, canonicalPhone, lid: lidDigits };
  });
