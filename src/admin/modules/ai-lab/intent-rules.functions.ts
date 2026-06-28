import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clearIntentRulesCache,
  classifyIntent,
  getDefaultIntentRulesSeed,
} from "@/ai/router/intent-classifier";

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

/**
 * Impor aturan default (RULES statis) ke tabel `ai_intent_rules`.
 *
 * Hanya menyisipkan kategori yang BELUM punya baris di DB — jadi aman
 * dijalankan berkali-kali dan tidak menimpa hasil suntingan admin. Tujuannya
 * agar admin bisa melihat & menyunting aturan bawaan, bukan mengeditnya buta.
 */
export const seedDefaultIntentRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const seed = getDefaultIntentRulesSeed();

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("ai_intent_rules")
      .select("category");

    if (readErr) {
      throw new Error(`Failed to read existing rules: ${readErr.message}`);
    }

    const existingCats = new Set((existing ?? []).map((r: { category: string }) => r.category));
    const toInsert = seed.filter((s) => !existingCats.has(s.category));

    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from("ai_intent_rules").insert(toInsert);
      if (error) {
        throw new Error(`Failed to seed default rules: ${error.message}`);
      }
    }

    clearIntentRulesCache();

    return { inserted: toInsert.length, skipped: seed.length - toInsert.length };
  });

const TestIntentInput = z.object({
  text: z.string().min(1).max(500),
  mode: z.enum(["guest", "admin", "managerial"]).default("guest"),
});

/**
 * Alat uji: jalankan classifier pada contoh pesan tamu lalu kembalikan
 * kategori pemenang + confidence + kata yang cocok. Memakai aturan DB yang
 * sedang aktif (lewat supabaseAdmin) sehingga admin bisa memverifikasi
 * efek suntingannya. `llmConfig` sengaja tidak diberikan agar hasil murni
 * berbasis aturan (deterministik) tanpa memicu fallback LLM.
 */
export const testIntentClassification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => TestIntentInput.parse(d))
  .handler(async ({ data }) => {
    const result = await classifyIntent(data.text, supabaseAdmin, undefined, {
      mode: data.mode,
    });
    return result;
  });
