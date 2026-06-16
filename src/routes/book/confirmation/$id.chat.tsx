import { createFileRoute } from "@tanstack/react-router";
import { WebchatWindow } from "@/public/components/webchat/webchat-window";

export const Route = createFileRoute("/book/confirmation/$id/chat")({
  head: () => ({
    meta: [
      { title: "Bantuan Booking — Pomah Guesthouse" },
      {
        name: "description",
        content: "Lanjutkan percakapan dengan Pomah Guesthouse via Web Chat.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BookingChatPage,
});

function BookingChatPage() {
  const { id } = Route.useParams();
  return <WebchatWindow initialBookingCode={id} />;
}
