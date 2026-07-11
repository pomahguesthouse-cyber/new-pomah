import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility route for existing navigation links to `/rooms`.
 * The public room catalogue currently lives on the homepage, while
 * individual room details remain available at `/rooms/$slug`.
 */
export const Route = createFileRoute("/rooms")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "rooms" });
  },
});
