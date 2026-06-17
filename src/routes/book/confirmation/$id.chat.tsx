import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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

  const { data, isLoading } = useQuery({
    queryKey: ["booking-invoice", id],
    queryFn: async () => {
      const res = await fetch(`/api/booking-invoice/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("Gagal memuat data booking");
      return res.json() as Promise<{ invoice: any | null }>;
    },
  });

  const inv = data?.invoice ?? null;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
        <span className="ml-2 text-sm text-stone-500">Memuat chat…</span>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50 px-6">
        <p className="text-stone-600">Data booking tidak ditemukan.</p>
        <Link
          to="/"
          className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
        >
          Kembali ke Beranda
        </Link>
      </div>
    );
  }

  return (
    <WebchatWindow
      initialBookingCode={id}
      initialGuestName={inv.guest?.full_name ?? ""}
      initialGuestPhone={inv.guest?.phone ?? ""}
      autoStart={true}
    />
  );
}
