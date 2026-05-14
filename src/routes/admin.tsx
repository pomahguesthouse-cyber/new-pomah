import { useEffect, useState } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import {
  claimFirstAdmin,
  getAccessBootstrapStatus,
  getMyAccess,
} from "@/lib/auth.functions";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const fn = useServerFn(getMyAccess);
  const bootstrapFn = useServerFn(getAccessBootstrapStatus);
  const { data, error, isLoading } = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fn(),
    retry: false,
  });
  const { data: bootstrap } = useQuery({
    queryKey: ["admin-bootstrap-status"],
    queryFn: () => bootstrapFn(),
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
  if (!data.isStaff) return <NoAccess email={data.email} bootstrap={bootstrap} />;

  return (
    <SidebarProvider>
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="bg-background">
        <AdminTopbar
          fullName={data.profile?.full_name}
          email={data.email ?? null}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NoAccess({
  email,
  bootstrap,
}: {
  email: string | null;
  bootstrap?: {
    adminCount: number;
    hasAdmin: boolean;
    canClaimAdmin: boolean;
    adminNames: string[];
  };
}) {
  const navigate = useNavigate();
  const claim = useServerFn(claimFirstAdmin);
  const [granting, setGranting] = useState(false);
  const canClaimAdmin = bootstrap?.canClaimAdmin ?? false;
  const knownAdmins = bootstrap?.adminNames ?? [];
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
          {email ? (
            <>
              Signed in as <span className="font-medium text-foreground">{email}</span>. Ask an
              admin to grant access to this account.
            </>
          ) : (
            <>Ask an admin to grant access to this account.</>
          )}
        </p>
        {knownAdmins.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Current admin: {knownAdmins.join(", ")}
          </p>
        )}
        <button
          disabled={granting || !canClaimAdmin}
          onClick={async () => {
            if (!canClaimAdmin) return;
            setGranting(true);
            try {
              await claim();
              window.location.reload();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setGranting(false);
            }
          }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {granting ? "…" : canClaimAdmin ? "Claim admin" : "Admin already exists"}
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
