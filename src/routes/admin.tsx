import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/admin/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AdminLayout,
});

/**
 * Layout wrapper for all /admin/* routes.
 *
 * The app runs on a single domain (pomahliving.com). Admin pages live
 * under the /admin/* path prefix and require authentication, which is
 * enforced in beforeLoad. Server-side authorization is handled by
 * Supabase RLS.
 */
function AdminLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
