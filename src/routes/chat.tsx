import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WebchatWindow } from "@/public/components/webchat/webchat-window";

const SearchSchema = z.object({
  booking: z.string().optional(),
});

export const Route = createFileRoute("/chat")({
  validateSearch: (s) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Web Chat — Pomah Guesthouse" },
      {
        name: "description",
        content:
          "Kanal cadangan resmi Pomah Guesthouse. Hubungi kami via Web Chat kalau WhatsApp sedang gangguan.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { booking } = Route.useSearch();
  return <WebchatWindow initialBookingCode={booking ?? null} />;
}
