import { useEffect } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
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
  const router = useRouter();

  // Warm the bottom-nav route chunks once the first screen is idle so the
  // first tap on Booking / Chat WA does not wait on a chunk download.
  useEffect(() => {
    const warm = () => {
      for (const tab of TABS) {
        if (!isActive(path, tab.to, tab.exact)) void router.preloadRoute({ to: tab.to }).catch(() => {});
      }
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const onPrimary = TABS.some((tab) => isActive(path, tab.to, tab.exact));

  return (
    <nav
      className="admin-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
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
                preload="intent"
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
