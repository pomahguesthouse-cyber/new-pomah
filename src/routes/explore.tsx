import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for /explore and /explore/$slug. The index page owns the listing head. */
export const Route = createFileRoute("/explore")({
  component: ExploreLayout,
});

function ExploreLayout() {
  return <Outlet />;
}
