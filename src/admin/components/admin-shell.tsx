import { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/admin/components/admin-sidebar";
import { AdminTopbar } from "@/admin/components/admin-topbar";

/** Routes that render full-screen, without the admin sidebar / topbar. */
const BARE_ROUTES = ["/admin/pages", "/admin/ai-lab"];

export function AdminShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const bare = BARE_ROUTES.some((r) => path === r || path.startsWith(r + "/"));

  if (bare) {
    return <div className="h-screen overflow-hidden bg-background">{children}</div>;
  }

  return (
    <SidebarProvider>
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="bg-background min-w-0 overflow-hidden">
        <AdminTopbar fullName="Admin" email={null} />
        <main className="flex-1 overflow-auto min-h-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
