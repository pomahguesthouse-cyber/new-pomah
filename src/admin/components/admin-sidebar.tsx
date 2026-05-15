import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  BedDouble,
  DollarSign,
  MessageCircle,
  Sparkles,
  GraduationCap,
  BarChart3,
  Search,
  Settings,
  Hotel,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/admin/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/admin/bookings", label: "Bookings", icon: CalendarDays },
      { to: "/rooms", label: "Rooms", icon: BedDouble },
      { to: "/admin/pricing", label: "Pricing", icon: DollarSign },
    ],
  },
  {
    label: "Guests & Comms",
    items: [
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/admin/ai", label: "AI Suggestions", icon: Sparkles },
      { to: "/admin/training", label: "Training", icon: GraduationCap },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/admin/seo", label: "SEO", icon: Search },
    ],
  },
  {
    label: "System",
    items: [{ to: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

export function AdminSidebar({ propertyName }: { propertyName?: string | null }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const isActive = (item: NavItem) =>
    item.exact ? path === item.to : path === item.to || path.startsWith(item.to + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2.5 px-2 py-1.5 group/brand">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Hotel className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[13px] font-semibold leading-tight tracking-tight">
                POMAH<span className="text-accent">.</span>
              </p>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                {propertyName ?? "Hospitality OS"}
              </p>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.18em]">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = isActive(item);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        className="group/item relative"
                      >
                        <Link to={item.to}>
                          {active && (
                            <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
                          )}
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
        ))}
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && (
          <div className="rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
              AI Concierge
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              All systems nominal
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
