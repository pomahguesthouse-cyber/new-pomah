import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizePhone(raw: unknown) {
  if (raw == null) return null;
  let value = String(raw).trim();
  if (!value) return null;
  value = value
    .replace(/@(?:c|s|g)\.(?:us|whatsapp\.net)$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@lid(?:\b.*)?$/i, "")
    .replace(/@.*$/i, "")
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (!value) return null;
  if (value.startsWith("620")) value = "62" + value.slice(3);
  else if (value.startsWith("0")) value = "62" + value.slice(1);
  else if (/^8\d{7,14}$/.test(value)) value = "62" + value;
  return /^62\d{8,14}$/.test(value) ? value : null;
}

const transcriptMessageSchema = z.object({
  id: z.string().min(1),
  direction: z.string(),
  body: z.string().max(12000),
  originalBody: z.string().max(12000).nullable().optional(),
  edited: z.boolean().optional(),
  sent_at: z.string().nullable().optional(),
  metadata: z.unknown().optional(),
});

export const createWhatsappCorrectionLiveSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    canonicalPhone: z.string().trim().max(80).nullable().optional(),
    externalChatId: z.string().trim().max(160).nullable().optional(),
    title: z.string().trim().max(180).nullable().optional(),
    summary: z.string().trim().max(3000).nullable().optional(),
    correctedTranscript: z.array(transcriptMessageSchema).min(1).max(300),
    status: z.enum(["draft", "approved", "archived"]).default("approved"),
  }).parse(d))
  .handler(async ({ data }) => {
    const canonicalPhone = normalizePhone(data.canonicalPhone) || normalizePhone(data.externalChatId);
    const title = data.title?.trim() || canonicalPhone || data.externalChatId || "Percakapan WhatsApp Live";
    const transcript = data.correctedTranscript;
    const fullTranscript = transcript.map((m) => ({
      ...m,
      metadata: {
        ...((typeof m.metadata === "object" && m.metadata) ? m.metadata as Record<string, unknown> : {}),
        source: "wppconnect_live",
        external_chat_id: data.externalChatId ?? null,
      },
    }));

    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("wa_correction_sessions")
      .insert({
        thread_id: null,
        canonical_phone: canonicalPhone,
        title,
        conversation_summary: data.summary?.trim() || null,
        full_transcript: fullTranscript,
        corrected_transcript: transcript,
        guest_memory_snapshot: { external_chat_id: data.externalChatId ?? null, source: "wppconnect_live" },
        status: data.status,
        source: "whatsapp-corrections-live",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: inserted?.id as string };
  });
