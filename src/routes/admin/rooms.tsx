import { createFileRoute } from "@tanstack/react-router";
import { RoomsManageView } from "@/admin/components/rooms-manage-view";

export const Route = createFileRoute("/admin/rooms")({
  component: AdminRoomsPage,
});

function AdminRoomsPage() {
  return <RoomsManageView />;
}
