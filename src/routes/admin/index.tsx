import { createFileRoute } from "@tanstack/react-router";
import { DashboardView } from "@/admin/components/dashboard-view";
import { getDashboardMetrics, getDashboardOverview } from "@/admin/functions/dashboard.functions";

export const Route = createFileRoute("/admin/")({
  // Start the dashboard requests as soon as the route is matched or preloaded
  // (bottom-nav intent / idle warm-up), in parallel with the route chunk, instead
  // of after the component mounted. Not awaited: the page paints right away and
  // useQuery shares this request (same keys as DashboardView).
  loader: ({ context }) => {
    if (typeof window === "undefined") return;
    void context.queryClient.prefetchQuery({
      queryKey: ["dashboard", "overview"],
      queryFn: () => getDashboardOverview(),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["dashboard", "metrics"],
      queryFn: () => getDashboardMetrics(),
    });
  },
  component: AdminIndexPage,
});

function AdminIndexPage() {
  return <DashboardView />;
}
