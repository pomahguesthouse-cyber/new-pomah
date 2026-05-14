import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", context.userId)
      .maybeSingle();
    const roleList = (roles ?? []).map((r) => r.role);
    return {
      userId: context.userId,
      profile: profile ?? null,
      roles: roleList,
      isStaff: roleList.includes("admin") || roleList.includes("staff"),
    };
  });
