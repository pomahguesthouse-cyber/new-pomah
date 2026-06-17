import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

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
