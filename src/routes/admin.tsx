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
  const [switching, setSwitching] = useState(false);
  const canClaimAdmin = bootstrap?.canClaimAdmin ?? false;
  const knownAdmins = bootstrap?.adminNames ?? [];

  const switchAccount = async () => {
    setSwitching(true);
    try {
      // Sign out the current Supabase session, then immediately re-trigger
      // Google OAuth with prompt=select_account so the user can pick a
      // different Google account without leaving this screen.
      await supabase.auth.signOut();
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/admin",
        extraParams: { prompt: "select_account" },
      });
      if (result.error) {
        toast.error(result.error.message);
        setSwitching(false);
      }
    } catch (e) {
      toast.error((e as Error).message);
      setSwitching(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          No access
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          You're signed in, but not yet staff.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {email ? (
            <>
              Signed in as <span className="font-medium text-foreground">{email}</span>.
            </>
          ) : (
            <>This Google account doesn't have staff access yet.</>
          )}
        </p>
        {knownAdmins.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Current admin: {knownAdmins.join(", ")}
          </p>
        )}

        <div className="mt-6 rounded-md border border-border/60 bg-muted/30 p-4 text-left">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Quick fix
          </p>
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">1.</span> Click{" "}
              <span className="font-medium text-foreground">Switch Google account</span> below.
            </li>
            <li>
              <span className="font-medium text-foreground">2.</span> Pick the admin Google account
              from the chooser.
            </li>
            <li>
              <span className="font-medium text-foreground">3.</span> You'll land back here with
              full access.
            </li>
          </ol>
        </div>

        <button
          disabled={switching}
          onClick={switchAccount}
          className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {switching ? "Opening Google…" : "Switch Google account"}
        </button>

        {canClaimAdmin && (
          <button
            disabled={granting}
            onClick={async () => {
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
            className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {granting ? "…" : "Claim admin (first user only)"}
          </button>
        )}

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
