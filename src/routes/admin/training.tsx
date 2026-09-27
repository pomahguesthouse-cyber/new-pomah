import { createFileRoute } from "@tanstack/react-router";
import { TrainingPage } from "@/admin/modules/training/training-page";

export const Route = createFileRoute("/admin/training")({
  component: TrainingPage,
});
