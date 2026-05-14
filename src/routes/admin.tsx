import { useEffect, useState } from "react";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  Link,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  CalendarDays,
  BedDouble,
  MessageCircle,
  Sparkles,
  Settings,
  LogOut,
  DollarSign,
  BarChart3,
  Search,
  GraduationCap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccess, claimFirstAdmin } from "@/lib/auth.functions";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/bookings", label: "Bookings", icon: CalendarDays, exact: false },
  { to: "/admin/rooms", label: "Rooms", icon: BedDouble, exact: false },
  { to: "/admin/pricing", label: "Pricing", icon: DollarSign, exact: false },
  { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle, exact: false },
  { to: "/admin/ai", label: "AI Suggestions", icon: Sparkles, exact: false },
  { to: "/admin/training", label: "Training", icon: GraduationCap, exact: false },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3, exact: false },
  { to: "/admin/seo", label: "SEO", icon: Search, exact: false },
  { to: "/admin/settings", label: "Settings", icon: Settings, exact: false },
] as const;

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

  const path = useRouterState({ select: (s) => s.location.pathname });

  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!data) return null;

  if (!data.isStaff) return <NoAccess />;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar collapsible="icon">
          <SidebarContent>
            <div className="px-4 py-5">
              <Link to="/admin" className="font-mono text-sm font-semibold tracking-tight">
                POMAH<span className="text-accent">.</span>
              </Link>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Curated Ledger
              </p>
            </div>
            <SidebarGroup>
              <SidebarGroupLabel>Operations</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const active = item.exact ? path === item.to : path.startsWith(item.to);
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild isActive={active}>
                          <Link to={item.to}>
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div className="flex flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Pomah Guesthouse · Single property
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{data.profile?.full_name ?? "Staff"}</span>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate({ to: "/login" });
                }}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function NoAccess() {
  const navigate = useNavigate();
  const claim = useServerFn(claimFirstAdmin);
  const [granting, setGranting] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">No access</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">You're signed in, but not yet staff.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Ask an admin to grant you access. If this is the first staff account, click below to claim admin.
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
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
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
