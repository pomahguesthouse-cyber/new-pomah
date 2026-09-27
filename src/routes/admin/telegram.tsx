import { createFileRoute } from "@tanstack/react-router";
import { TelegramPage } from "@/admin/modules/telegram/telegram-page";

export const Route = createFileRoute("/admin/telegram")({
  component: TelegramPage,
});
