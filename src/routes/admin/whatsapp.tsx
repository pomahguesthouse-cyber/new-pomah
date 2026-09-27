import { createFileRoute } from "@tanstack/react-router";
import { WhatsAppPage } from "@/admin/modules/whatsapp/whatsapp-page";

export const Route = createFileRoute("/admin/whatsapp")({
  component: WhatsAppPage,
});
