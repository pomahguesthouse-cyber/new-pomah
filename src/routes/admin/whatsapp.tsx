import { createFileRoute } from "@tanstack/react-router";
import { WhatsAppPage } from "@/admin/modules/whatsapp/whatsapp-page";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/admin/whatsapp")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } => {
    const thread =
      typeof search.thread === "string" && THREAD_ID.test(search.thread)
        ? search.thread
        : undefined;
    return thread ? { thread } : {};
  },
  component: WhatsAppRoute,
});

function WhatsAppRoute() {
  const { thread } = Route.useSearch();
  return <WhatsAppPage initialThreadId={thread ?? null} />;
}
