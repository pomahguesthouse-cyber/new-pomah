import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Halaman ini sudah disatukan ke /admin/training (tab "Curated examples").
 * Route lama dipertahankan untuk kompatibilitas link/bookmark dan
 * langsung me-redirect ke halaman gabungan.
 */
export const Route = createFileRoute("/admin/chatbot-training")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/training" });
  },
});
