import { createFileRoute } from "@tanstack/react-router";
import { WalkthroughBuilderView } from "@/admin/modules/walkthrough/walkthrough-builder-view";

export const Route = createFileRoute("/admin/walkthrough")({
  head: () => ({ meta: [{ title: "360° Virtual Tour — Admin" }] }),
  component: WalkthroughBuilderView,
});
