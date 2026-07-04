/**
 * /api/wpp — alias baru untuk webhook WhatsApp (WPPConnect).
 *
 * Menggunakan handler yang sama dengan `/api/fonnte`. Route lama tetap
 * hidup selama masa transisi hingga webhook di VPS di-repoint ke path
 * baru ini.
 */

import { createFileRoute } from "@tanstack/react-router";
import { wppWebhookGet, wppWebhookPost } from "./api.fonnte";

export const Route = createFileRoute("/api/wpp")({
  server: {
    handlers: {
      POST: wppWebhookPost,
      GET: wppWebhookGet,
    },
  },
});
