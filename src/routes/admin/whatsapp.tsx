import { createFileRoute } from "@tanstack/react-router";
import { WhatsAppPage } from "@/admin/modules/whatsapp/whatsapp-page";
import {
  defaultThreadsParams,
  threadQueryOptions,
  threadsQueryOptions,
} from "@/admin/modules/whatsapp/wa-queries";

const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/admin/whatsapp")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } => {
    const thread =
      typeof search.thread === "string" && THREAD_ID.test(search.thread)
        ? search.thread
        : undefined;
    return thread ? { thread } : {};
  },
  loaderDeps: ({ search }) => ({ thread: search.thread }),
  // Mulai ambil data begitu rute dipilih/di-preload (tap bottom nav, notifikasi
  // ?thread=<id>), TANPA menunggu: loader kembali langsung dan komponen memakai
  // cache/permintaan yang sama lewat useQuery. Daftar thread dan isi percakapan
  // yang dibuka dari notifikasi jadi berjalan paralel dengan unduhan chunk.
  loader: ({ context, deps }) => {
    if (typeof window === "undefined") return;
    const desktop = window.matchMedia("(min-width: 1024px)").matches;
    void context.queryClient.prefetchQuery(threadsQueryOptions(defaultThreadsParams(desktop)));
    if (deps.thread) {
      void context.queryClient.prefetchQuery(threadQueryOptions(deps.thread, desktop));
    }
  },
  component: WhatsAppRoute,
});

function WhatsAppRoute() {
  const { thread } = Route.useSearch();
  return <WhatsAppPage initialThreadId={thread ?? null} />;
}
