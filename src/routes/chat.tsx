import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Web chat was removed. Keep the public URL so old links and bookmarks
 * land on the homepage instead of a missing page.
 */
export const Route = createFileRoute("/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/", statusCode: 301 });
  },
});
