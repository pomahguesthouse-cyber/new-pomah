import { createFileRoute } from "@tanstack/react-router";
import { HealthPage } from "@/admin/modules/health/health-page";

export const Route = createFileRoute("/admin/health")({
  component: HealthPage,
});
