import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <SidebarProvider>
      <AdminSidebar propertyName="Pomah Guesthouse" />
      <SidebarInset className="bg-background">
        <AdminTopbar fullName="Admin" email={null} />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
