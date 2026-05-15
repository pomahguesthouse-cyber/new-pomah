import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { getBookingReference } from "@/public/functions/public.functions";

export const Route = createFileRoute("/book/confirmation/$id")({
  head: () => ({
    meta: [
      { title: "Booking received — Pomah Guesthouse" },
      { name: "description", content: "Your reservation request has been received." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getBookingReference);
  const { data } = useQuery({
    queryKey: ["booking-reference", id],
    queryFn: () => fn({ data: { id } }),
  });
  const reference = data?.reference_code ?? null;

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-accent" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Booking received</h1>
        <p className="mt-3 text-muted-foreground">
          We'll confirm by WhatsApp shortly. Your reference is{" "}
          <span className="font-mono font-semibold text-foreground">
            {reference ?? "…"}
          </span>
          .
        </p>
        <Link to="/" className="mt-8 inline-block text-sm text-accent underline-offset-4 hover:underline">
          Back to home →
        </Link>
      </main>
      <PublicFooter />
    </div>
  );
}
