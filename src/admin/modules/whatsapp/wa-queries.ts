/**
 * Query options bersama untuk halaman chat WhatsApp admin. Dipakai oleh
 * komponen (useQuery), loader route, dan prefetch saat tap/hover supaya semuanya
 * berbagi cache dan permintaan yang sama.
 */
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { getOlderMessages, getThread, listThreads } from "@/admin/functions/whatsapp.functions";

export type ThreadFilter = "all" | "unread" | "open" | "closed";

/** Jumlah thread / pesan awal. Desktop tetap longgar, HP dibatasi. */
export const WA_PAGE = {
  desktop: { threads: 200, messages: 200 },
  mobile: { threads: 50, messages: 40 },
  threadsStep: 50,
  olderMessages: 50,
} as const;

export type ThreadsParams = { limit: number; q: string; filter: ThreadFilter };

export function defaultThreadsParams(desktop: boolean): ThreadsParams {
  return {
    limit: desktop ? WA_PAGE.desktop.threads : WA_PAGE.mobile.threads,
    q: "",
    filter: "all",
  };
}

export function threadsQueryOptions(params: ThreadsParams) {
  return queryOptions({
    queryKey: ["wa-threads", params] as const,
    queryFn: () =>
      listThreads({
        data: {
          limit: params.limit,
          ...(params.q ? { q: params.q } : {}),
          ...(params.filter !== "all" ? { filter: params.filter } : {}),
        },
      }),
    placeholderData: keepPreviousData,
  });
}

export function threadQueryOptions(id: string, desktop: boolean) {
  return queryOptions({
    queryKey: ["wa-thread", id, desktop ? "full" : "lite"] as const,
    // Cache dipakai langsung saat dibuka; refetch latar belakang bila > 5 dtk.
    staleTime: 5_000,
    queryFn: () =>
      getThread({
        data: {
          id,
          limit: desktop ? WA_PAGE.desktop.messages : WA_PAGE.mobile.messages,
          withContext: desktop,
        },
      }),
  });
}

export function fetchOlderMessages(threadId: string, before: string) {
  return getOlderMessages({
    data: { threadId, before, limit: WA_PAGE.olderMessages },
  });
}
