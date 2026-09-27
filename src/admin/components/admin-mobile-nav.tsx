import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, LayoutDashboard, Menu, MessageCircle } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/bookings", label: "Booking", icon: CalendarDays, exact: false },
  { to: "/admin/whatsapp", label: "Chat WA", icon: MessageCircle, exact: false },
] as const;

function isActive(path: string, to: string, exact: boolean): boolean {
  if (exact) return path === to;
  return path === to || path.startsWith(`${to}/`);
}

/** Phone navigation. Desktop keeps the existing sidebar. */
export function AdminMobileNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { setOpenMobile, openMobile } = useSidebar();
  const onPrimary = TABS.some((tab) => isActive(path, tab.to, tab.exact));

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Admin"
    >
      <ul className="grid h-16 grid-cols-4">
        {TABS.map((tab) => {
          const active = isActive(path, tab.to, tab.exact);
          const Icon = tab.icon;
          return (
            <li key={tab.to}>
              <Link
                to={tab.to}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium",
              !onPrimary || openMobile ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
