import { useEffect, useState } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

export const Route = createFileRoute("/_admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AdminLayout,
});

/**
 * Layout wrapper for all /_admin/* routes.
 *
 * Runs a client-side host-guard so that authenticated users who land on
 * an admin route while on the PUBLIC domain (pomahliving.com) are
 * immediately redirected to "/" rather than briefly seeing admin UI.
 *
 * Server-side host enforcement is handled by Supabase RLS; the guard
 * here is purely a UX/SEO concern (no admin chrome on the public site).
 */
function AdminLayout() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    if (isAdminHost(host) || isDeveloperHost(host)) {
      setAllowed(true);
    } else {
      // Public domain visiting an admin route → redirect to public home
      navigate({ to: "/" });
    }
  }, [navigate]);

  // Render nothing while we determine the correct domain.
  // This prevents a flash of admin UI on the public domain.
  if (allowed === null) return null;

  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
