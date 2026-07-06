import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Halaman ini sudah disatukan ke /admin/ai-lab (Training & Evaluation).
 * Route lama dipertahankan untuk kompatibilitas link/bookmark dan
 * langsung me-redirect ke Control Room.
 */
export const Route = createFileRoute("/admin/chatbot-training")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/ai-lab", search: { view: "training" } });
  },
});
