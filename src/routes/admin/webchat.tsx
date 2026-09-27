import { createFileRoute, redirect } from "@tanstack/react-router";

/** Admin web chat inbox was removed. Bookmarks land on the admin home. */
export const Route = createFileRoute("/admin/webchat")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
