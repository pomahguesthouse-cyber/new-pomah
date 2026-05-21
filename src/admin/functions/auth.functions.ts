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
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    return {
      userId: context.userId,
      email,
      profile: profile ?? null,
      roles: roleList,
      isStaff: roleList.includes("admin") || roleList.includes("staff"),
    };
  });

export const getAccessBootstrapStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { count, error: countError } = await supabaseAdmin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");

  if (countError) throw countError;

  const adminCount = count ?? 0;
  let adminNames: string[] = [];

  if (adminCount > 0) {
    const { data: adminRows, error: adminRowsError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (adminRowsError) throw adminRowsError;

    const adminIds = [...new Set((adminRows ?? []).map((row: any) => row.user_id))];

    if (adminIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .in("id", adminIds);

      if (profilesError) throw profilesError;

      adminNames = (profiles ?? [])
        .map((profile: any) => profile.full_name)
        .filter((name: any): name is string => Boolean(name));
    }
  }

  return {
    adminCount,
    hasAdmin: adminCount > 0,
    canClaimAdmin: adminCount === 0,
    adminNames,
  };
});

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error: countError } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      throw new Error("An admin already exists. Ask them to grant you access.");
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: "admin" });
    if (error) throw error;
    return { ok: true };
  });
