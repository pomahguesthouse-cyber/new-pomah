import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clearIntentRulesCache } from "@/ai/router/intent-classifier";

// Validate inputs
const SaveRuleInput = z.object({
  id: z.string().uuid().optional(),
  category: z.string().min(1),
  patterns: z.array(z.string()),
  weight: z.number().int().min(1).max(100),
  delete: z.boolean().optional(),
});

export const getIntentRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await supabaseAdmin
      .from("ai_intent_rules")
      .select("id, category, patterns, weight, created_at")
      .order("weight", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch intent rules: ${error.message}`);
    }

    return { rules: data ?? [] };
  });

export const saveIntentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SaveRuleInput.parse(d))
  .handler(async ({ data }) => {
    if (data.delete && data.id) {
      const { error } = await supabaseAdmin
        .from("ai_intent_rules")
        .delete()
        .eq("id", data.id);

      if (error) {
        throw new Error(`Failed to delete intent rule: ${error.message}`);
      }
    } else if (data.id) {
      // Update existing
      const { error } = await supabaseAdmin
        .from("ai_intent_rules")
        .update({
          category: data.category,
          patterns: data.patterns,
          weight: data.weight,
        })
        .eq("id", data.id);

      if (error) {
        throw new Error(`Failed to update intent rule: ${error.message}`);
      }
    } else {
      // Insert new
      const { error } = await supabaseAdmin
        .from("ai_intent_rules")
        .insert({
          category: data.category,
          patterns: data.patterns,
          weight: data.weight,
        });

      if (error) {
        throw new Error(`Failed to create intent rule: ${error.message}`);
      }
    }

    // Proactively clear cache on the server
    clearIntentRulesCache();

    return { ok: true };
  });
