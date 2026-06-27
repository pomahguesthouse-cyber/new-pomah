import type { ToolContext, ToolHandler } from "../types";

export const sendToManager: ToolHandler = async (
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> => {
  const { message, urgency } = args as {
    message: string;
    urgency?: string;
  };

  // In a real system, this might send an email, a Telegram notification,
  // or a push notification to the manager's device. For now, we simulate
  // the delivery.
  console.log(`[sendToManager] [${urgency?.toUpperCase() || "NORMAL"}] Forwarding to manager: ${message}`);
  
  return JSON.stringify({
    ok: true,
    message: "Pesan berhasil diteruskan ke owner/manajer.",
  });
};
