import { createFileRoute } from "@tanstack/react-router";
import { getBookingInvoice } from "@/public/functions/public.functions";

async function handle(id: string): Promise<Response> {
  try {
    const rawId = decodeURIComponent(id).trim();
    if (!rawId) {
      return Response.json({ invoice: null });
    }
    const result = await getBookingInvoice({ data: { id: rawId } });
    return Response.json(result);
  } catch (error: any) {
    console.error("[api.booking-invoice] Error fetching booking invoice:", error);
    return Response.json({ invoice: null });
  }
}

export const Route = createFileRoute("/api/booking-invoice/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => handle(params.id),
    },
  },
});
