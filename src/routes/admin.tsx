import { useEffect } from "react";
import { createFileRoute, isRedirect, Outlet, redirect } from "@tanstack/react-router";
import { AdminShell } from "@/admin/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  clearAdminAssignFlag,
  clearStaffSessionHint,
} from "@/lib/auth-return";
import { requestHasStaffSessionHint } from "@/lib/staff-session-hint";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  beforeLoad: async () => {
    // Session hidup di localStorage, jadi SSR tidak bisa memanggil getUser().
    // Tanpa cookie hint, full load /admin selalu 307 ke /login dan login yang
    // memakai location.assign akan berputar. Hint bukan token — hanya penanda
    // bahwa browser ini baru saja masuk. Anonim (tanpa hint) tetap 307.
    if (typeof window === "undefined") {
      let allowed = false;
      try {
        allowed = await requestHasStaffSessionHint();
      } catch (error) {
        if (isRedirect(error)) throw error;
        console.error("[admin] session hint lookup failed:", error);
      }
      if (!allowed) {
        throw redirect({ to: "/login", search: { next: undefined } });
      }
      return;
    }
    // Gunakan getUser() agar session direvalidasi ke Auth server (lihat tanstack-supabase-integration).
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      clearStaffSessionHint();
      throw redirect({ to: "/login", search: { next: undefined } });
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
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        clearStaffSessionHint();
        clearAdminAssignFlag();
        window.location.assign("/login");
        return;
      }
      clearAdminAssignFlag();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
