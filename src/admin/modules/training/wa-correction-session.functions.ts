import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const deleteWhatsappCorrectionSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    // Only deletes the saved training session. Original WhatsApp thread/messages remain untouched.
    const { error } = await supabaseAdmin
      .from("wa_correction_sessions")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
