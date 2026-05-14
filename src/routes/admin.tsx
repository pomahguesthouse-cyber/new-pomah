import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { getMyAccess, claimFirstAdmin } from "@/lib/auth.functions";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const fn = useServerFn(getMyAccess);
  const { data, error, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fn(),
    retry: false,
  });

  useEffect(() => {
    if (error) navigate({ to: "/login" });
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!data) return null;
  if (!data.isStaff) return <NoAccess />;

  return (
    <SidebarProvider>
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="bg-background">
        <AdminTopbar
          fullName={data.profile?.full_name}
          email={data.profile?.email ?? null}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NoAccess() {
  const navigate = useNavigate();
  const claim = useServerFn(claimFirstAdmin);
  const [granting, setGranting] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No access
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          You're signed in, but not yet staff.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ask an admin to grant you access. If this is the first staff account, click
          below to claim admin.
        </p>
        <button
          disabled={granting}
          onClick={async () => {
            setGranting(true);
            try {
              await claim();
              window.location.reload();
            } catch (e) {
              alert((e as Error).message);
            } finally {
              setGranting(false);
            }
          }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {granting ? "…" : "Claim admin"}
        </button>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/login" });
          }}
          className="mt-3 block w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
