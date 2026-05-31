import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/admin/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async ({ location }) => {
    // Gunakan getUser() agar session direvalidasi ke Auth server (lihat tanstack-supabase-integration).
    // Jangan skip SSR — biarkan redirect terjadi sebelum komponen render & memanggil server fn.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
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
