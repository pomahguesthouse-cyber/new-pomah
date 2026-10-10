import { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminMobileNav } from "@/admin/components/admin-mobile-nav";
import { AdminSidebar } from "@/admin/components/admin-sidebar";
import { AdminTopbar } from "@/admin/components/admin-topbar";
import { CALENDAR_DRAWER_BREAKPOINT } from "@/admin/lib/calendar-grid-layout";
import { cn } from "@/lib/utils";

/** Routes that render full-screen, without the admin sidebar / topbar. */
const BARE_ROUTES = ["/admin/pages", "/admin/ai-lab"];

export function AdminShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const bare = BARE_ROUTES.some((r) => path === r || path.startsWith(r + "/"));

  if (bare) {
    return <div className="h-dvh max-h-dvh w-full overflow-hidden bg-background">{children}</div>;
  }

  const chat = path === "/admin/whatsapp" || path.startsWith("/admin/whatsapp/");
  const calendar = path === "/admin/calendar" || path.startsWith("/admin/calendar/");

  return (
    <SidebarProvider
      className={cn("admin-theme", calendar && "h-dvh max-h-dvh overflow-hidden")}
      mobileBreakpoint={calendar ? CALENDAR_DRAWER_BREAKPOINT : undefined}
    >
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden bg-background">
        <AdminTopbar fullName="Admin" email={null} />
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]",
            chat || calendar ? "overflow-hidden" : "overflow-auto",
          )}
        >
          {children}
        </main>
        <AdminMobileNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
