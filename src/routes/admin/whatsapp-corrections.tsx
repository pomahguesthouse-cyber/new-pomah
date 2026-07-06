import { createFileRoute } from "@tanstack/react-router";
import { WhatsappCorrectionsPage } from "@/admin/modules/training/whatsapp-corrections-live-page";

export const Route = createFileRoute("/admin/whatsapp-corrections")({
  component: WhatsappCorrectionsPage,
});
