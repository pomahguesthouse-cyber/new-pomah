import { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminMobileNav } from "@/admin/components/admin-mobile-nav";
import { AdminSidebar } from "@/admin/components/admin-sidebar";
import { AdminTopbar } from "@/admin/components/admin-topbar";
import { cn } from "@/lib/utils";

/** Routes that render full-screen, without the admin sidebar / topbar. */
const BARE_ROUTES = ["/admin/pages", "/admin/ai-lab"];

export function AdminShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const bare = BARE_ROUTES.some((r) => path === r || path.startsWith(r + "/"));

  if (bare) {
    return <div className="h-screen overflow-hidden bg-background">{children}</div>;
  }

  const chat = path === "/admin/whatsapp" || path.startsWith("/admin/whatsapp/");

  return (
    <SidebarProvider className="admin-theme">
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="bg-background min-w-0 overflow-hidden">
        <AdminTopbar fullName="Admin" email={null} />
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col max-md:pb-[calc(4rem+env(safe-area-inset-bottom))]",
            chat ? "overflow-hidden" : "overflow-auto",
          )}
        >
          {children}
        </main>
        <AdminMobileNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
