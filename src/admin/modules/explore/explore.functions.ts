import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function db(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

export type ExploreCategory = "destination" | "culinary" | "event" | "news";

export interface ExploreItem {
  id: string;
  category: ExploreCategory;
  title: string;
  description: string | null;
  image_url: string | null;
  rating: number | null;
  badge: string | null;
  date_text: string | null;
  location_text: string | null;
  sort_order: number;
  is_published: boolean;
}

const CATEGORY = z.enum(["destination", "culinary", "event", "news"]);

const ItemInput = z.object({
  category: CATEGORY,
  title: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
  image_url: z.string().url().max(1000).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  badge: z.string().max(80).nullable().optional(),
  date_text: z.string().max(120).nullable().optional(),
  location_text: z.string().max(255).nullable().optional(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  is_published: z.boolean().default(true),
});

export const listExploreItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await db(context.supabase)
      .from("explore_items")
      .select("*")
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ExploreItem[];
  });

export const createExploreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ItemInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await db(context.supabase)
      .from("explore_items")
      .insert(data)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as ExploreItem;
  });

export const updateExploreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), patch: ItemInput.partial() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("explore_items")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExploreItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("explore_items")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
