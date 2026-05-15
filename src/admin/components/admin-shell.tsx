import { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/admin/components/admin-sidebar";
import { AdminTopbar } from "@/admin/components/admin-topbar";

export function AdminShell({ children }: { children: ReactNode }) {
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