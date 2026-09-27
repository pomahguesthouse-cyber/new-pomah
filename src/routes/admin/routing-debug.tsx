import { createFileRoute } from "@tanstack/react-router";
import { RoutingDebugPage } from "@/admin/modules/routing/routing-debug-page";

export const Route = createFileRoute("/admin/routing-debug")({
  component: RoutingDebugPage,
});
