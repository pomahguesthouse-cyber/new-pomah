import { createFileRoute, redirect } from "@tanstack/react-router";
import { WhatsappCorrectionsPage } from "@/admin/modules/training/whatsapp-corrections-live-page";

export const Route = createFileRoute("/admin/whatsapp-corrections")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/ai-lab", search: { panel: "training" } });
  },
  component: WhatsappCorrectionsPage,
});
