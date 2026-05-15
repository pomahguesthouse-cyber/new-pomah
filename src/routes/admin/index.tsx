import { createFileRoute } from "@tanstack/react-router";
import { DashboardView } from "@/admin/components/dashboard-view";

export const Route = createFileRoute("/admin/")({
  component: AdminIndexPage,
});

function AdminIndexPage() {
  return <DashboardView />;
}
