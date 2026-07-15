import { createFileRoute } from "@tanstack/react-router";
import { WhatsappCorrectionsPage } from "@/admin/modules/training/whatsapp-corrections-live-page";
import "@/admin/modules/training/whatsapp-corrections-mobile.css";

function WhatsappCorrectionsRoute() {
  return (
    <div className="wa-correction-mobile-shell">
      <WhatsappCorrectionsPage />
    </div>
  );
}

export const Route = createFileRoute("/admin/whatsapp-corrections")({
  component: WhatsappCorrectionsRoute,
});
