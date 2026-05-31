/**
 * Telegram Bot API client.
 *
 * Thin wrapper over `https://api.telegram.org/bot<TOKEN>/*` so the rest of
 * the codebase doesn't have to know about HTTP details. Used by:
 *   - manager-notifier (outbound notifications: booking, payment proof,
 *     complaint), in parallel with WhatsApp
 *   - api.telegram webhook (inbound replies, callback answers)
 *   - admin function (setWebhook one-time setup)
 *
 * Telegram is forgiving: most send-message failures are recoverable and
 * non-fatal to the rest of the system, so every wrapper returns
 * `{ ok, error }` and never throws.
 */

const TG_BASE = "https://api.telegram.org";

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface ReplyMarkup {
  inline_keyboard?: InlineKeyboardButton[][];
}

interface SendOpts {
  parse_mode?: "MarkdownV2" | "HTML";
  reply_markup?: ReplyMarkup;
  disable_web_page_preview?: boolean;
}

async function call<T = any>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<TgResult<T>> {
  try {
    const res = await fetch(`${TG_BASE}/bot${token}/${method}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.warn(`[Telegram] ${method} failed:`, json.description);
      return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: json.result };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(`[Telegram] ${method} threw:`, m);
    return { ok: false, error: m };
  }
}

// ─── Outbound ─────────────────────────────────────────────────────────────────

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  opts: SendOpts = {},
): Promise<TgResult> {
  return call(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...opts,
  });
}

export async function sendPhoto(
  token: string,
  chatId: string | number,
  photo: string,
  caption?: string,
  opts: SendOpts = {},
): Promise<TgResult> {
  return call(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    caption,
    ...opts,
  });
}

export async function sendDocument(
  token: string,
  chatId: string | number,
  documentUrl: string,
  caption?: string,
): Promise<TgResult> {
  return call(token, "sendDocument", {
    chat_id: chatId,
    document: documentUrl,
    caption,
  });
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<TgResult> {
  return call(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function editMessageText(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  opts: SendOpts = {},
): Promise<TgResult> {
  return call(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...opts,
  });
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

export async function setWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<TgResult> {
  return call(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function getMe(token: string): Promise<TgResult<{ id: number; username: string }>> {
  return call(token, "getMe", {});
}

/** Resolve a Telegram-hosted file_id to a public-ish URL the OCR pipeline can fetch. */
export async function getFileUrl(
  token: string,
  fileId: string,
): Promise<string | null> {
  const r = await call<{ file_path: string }>(token, "getFile", { file_id: fileId });
  if (!r.ok || !r.result?.file_path) return null;
  return `${TG_BASE}/file/bot${token}/${r.result.file_path}`;
}
