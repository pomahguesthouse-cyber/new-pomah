import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Booking web chat was removed. Send the guest back to their invoice.
 */
export const Route = createFileRoute("/book/confirmation/$id/chat")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/book/confirmation/$id",
      params: { id: params.id },
      statusCode: 301,
    });
  },
});
