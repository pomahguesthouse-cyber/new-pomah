import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data stays fresh for 30s so tab/page switches in the admin app render
        // from cache instead of refetching every query on each navigation.
        // Queries that need live data set staleTime: 0 themselves (public
        // availability) or are kept current by realtime invalidation.
        // refetchOnWindowFocus stays at its default (true).
        staleTime: 30_000,
        gcTime: 10 * 60_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Cache hasil preload selama 30 detik agar navigasi cepat tidak
    // memicu refetch berulang. Query tetap mengelola staleness via
    // useQuery/useSuspenseQuery.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
