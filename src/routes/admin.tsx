import { useEffect, useState } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { AdminShell } from "@/admin/components/admin-shell";
import { supabase } from "@/integrations/supabase/client";
import { isAdminHost, isDeveloperHost } from "@/lib/host";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      throw redirect({ to: "/login" });
    }
  },
  component: AdminLayout,
});

/**
 * Layout wrapper for /admin/* routes.
 *
 * Allows access to admin pages from ANY domain as long as:
 * 1. User is authenticated (checked in beforeLoad)
 * 2. They access via /admin/* path (path-based routing)
 *
 * Also maintains backward compatibility with domain-based routing:
 * - Users on admin.pomahguesthouse.com can access routes directly (e.g., /bookings)
 *   by using the legacy /_admin layout
 *
 * Server-side authorization is handled by Supabase RLS.
 */
function AdminLayout() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;

    // /admin/* routes are accessible from any domain if authenticated
    // Alternatively, allow access from admin domain or developer host
    if (isDeveloperHost(host)) {
      setAllowed(true);
    } else if (isAdminHost(host)) {
      // Admin domain gets full access to all admin features
      setAllowed(true);
    } else {
      // Public domain accessing /admin/* is allowed (path-based access)
      setAllowed(true);
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
