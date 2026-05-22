import { createFileRoute } from "@tanstack/react-router";
import { MediaLibraryView } from "@/admin/modules/media/media-library-view";

export const Route = createFileRoute("/admin/media")({
  head: () => ({ meta: [{ title: "Media Library — Admin" }] }),
  component: MediaLibraryView,
});
