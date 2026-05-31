import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  CalendarDays,
  BedDouble,
  DollarSign,
  Sparkles,
  BarChart3,
  Search,
  Settings,
  LayoutTemplate,
  FlaskConical,
  MessageCircle,
  Images,
  Compass,
  AlertTriangle,
  Bell,
  Send,
} from "lucide-react";

import { getBrandingSettings } from "@/admin/modules/settings/settings.functions";
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
      { to: "/admin/rooms", label: "Rooms", icon: BedDouble },
      { to: "/admin/media", label: "Media Library", icon: Images },
      { to: "/admin/pages", label: "Page Builder", icon: LayoutTemplate },
      { to: "/admin/explore", label: "City Guide", icon: Compass },
      { to: "/admin/pricing", label: "Pricing", icon: DollarSign },
    ],
  },
  {
    label: "Guests & Comms",
    items: [
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/admin/telegram", label: "Telegram", icon: Send },
      { to: "/admin/complaints", label: "Komplain", icon: AlertTriangle },
      { to: "/admin/notifications", label: "Log Notifikasi", icon: Bell },
      { to: "/admin/ai", label: "AI Suggestions", icon: Sparkles },
      { to: "/admin/ai-lab", label: "AI Lab", icon: FlaskConical },
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

  const brandingFn = useServerFn(getBrandingSettings);
  const { data: branding } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => brandingFn(),
  });
  const logoUrl = branding?.logo_url ?? null;

  const isActive = (item: NavItem) =>
    item.exact ? path === item.to : path === item.to || path.startsWith(item.to + "/");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader>
        <Link
          to="/admin"
          className="flex items-center justify-center px-2 py-1.5"
          title={propertyName ?? "Dashboard"}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={propertyName ?? "Logo"}
              className={
                collapsed ? "h-8 w-8 object-contain" : "h-10 w-auto max-w-[170px] object-contain"
              }
            />
          ) : (
            <span className="truncate font-mono text-[13px] font-semibold tracking-tight">
              {collapsed ? "P" : (propertyName ?? "POMAH")}
            </span>
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
