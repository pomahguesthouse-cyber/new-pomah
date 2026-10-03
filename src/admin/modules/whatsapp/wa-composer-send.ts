/**
 * Logika murni kotak balasan admin WhatsApp.
 * Tidak memanggil jaringan dan tidak mengubah isi/rute pesan ke tamu.
 * Dipakai supaya tap Kirim bisa memperbarui UI sebelum server function selesai,
 * sambil menolak kiriman ganda yang masih berjalan.
 */

export type ComposerAttachmentPayload = {
  path: string;
  name: string;
  mime: string;
  size: number;
  previewUrl: string | null;
};

export type ComposerSendPayload = {
  body: string;
  attachment: ComposerAttachmentPayload | null;
};

export type OutboxStatus = "sending" | "failed";

export type OutboxItem = {
  clientId: string;
  threadId: string;
  body: string;
  sentAt: string;
  status: OutboxStatus;
  error?: string;
  attachment: ComposerAttachmentPayload | null;
};

export function sendFingerprint(
  threadId: string,
  body: string,
  attachmentPath?: string | null,
): string {
  return `${threadId}\u0000${body.trim()}\u0000${attachmentPath ?? ""}`;
}

/** true = kiriman ini boleh berangkat. Sidik yang sama ditolak selama masih berjalan. */
export function claimSend(inflight: Set<string>, fingerprint: string): boolean {
  if (inflight.has(fingerprint)) return false;
  inflight.add(fingerprint);
  return true;
}

export function releaseSend(inflight: Set<string>, fingerprint: string): void {
  inflight.delete(fingerprint);
}

export function canSubmitReply(input: {
  body: string;
  attachmentReady: boolean;
  attachmentBusy: boolean;
  metaWindowClosed: boolean;
}): boolean {
  if (input.metaWindowClosed || input.attachmentBusy) return false;
  return input.body.trim().length > 0 || input.attachmentReady;
}

export function createOutboxItem(input: {
  clientId: string;
  threadId: string;
  body: string;
  attachment: ComposerAttachmentPayload | null;
  now?: string;
}): OutboxItem {
  return {
    clientId: input.clientId,
    threadId: input.threadId,
    body: input.body.trim(),
    sentAt: input.now ?? new Date().toISOString(),
    status: "sending",
    attachment: input.attachment,
  };
}

export function markOutboxFailed(
  outbox: OutboxItem[],
  clientId: string,
  error: string,
): OutboxItem[] {
  let changed = false;
  const next = outbox.map((item) => {
    if (item.clientId !== clientId || item.status === "failed") return item;
    changed = true;
    return { ...item, status: "failed" as const, error };
  });
  return changed ? next : outbox;
}

export function removeOutboxItem(outbox: OutboxItem[], clientId: string): OutboxItem[] {
  const next = outbox.filter((item) => item.clientId !== clientId);
  return next.length === outbox.length ? outbox : next;
}

export function readClientId(message: { metadata?: unknown }): string | null {
  const meta = message.metadata;
  if (!meta || typeof meta !== "object") return null;
  const id = (meta as { client_id?: unknown }).client_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export type OutboxThreadMessage = {
  id: string;
  thread_id: string;
  direction: "out";
  body: string;
  sent_at: string;
  metadata: Record<string, unknown>;
};

export function outboxToMessage(item: OutboxItem): OutboxThreadMessage {
  const metadata: Record<string, unknown> = {
    send_status: item.status,
    client_id: item.clientId,
    is_manual_admin: true,
    source: "admin_inbox",
    local_outbox: true,
  };
  if (item.error) metadata.error = item.error;
  const att = item.attachment;
  if (att) {
    metadata.file_name = att.name;
    metadata.mime_type = att.mime;
    metadata.storage_path = att.path;
    metadata.size = att.size;
    if (att.previewUrl) metadata.media_url = att.previewUrl;
    metadata.media_type = att.mime.startsWith("image/") ? "image" : "file";
  }
  return {
    id: `local:${item.clientId}`,
    thread_id: item.threadId,
    direction: "out",
    body: item.body,
    sent_at: item.sentAt,
    metadata,
  };
}

/** Sisipkan gelembung lokal yang belum punya baris server dengan client_id yang sama. */
export function mergeOutboxMessages<T extends { metadata?: unknown }>(
  serverMessages: T[],
  outbox: OutboxItem[],
  threadId: string | null,
): T[] {
  if (!threadId || outbox.length === 0) return serverMessages;
  const known = new Set<string>();
  for (const message of serverMessages) {
    const id = readClientId(message);
    if (id) known.add(id);
  }
  const extras = outbox.filter((item) => item.threadId === threadId && !known.has(item.clientId));
  if (extras.length === 0) return serverMessages;
  return [...serverMessages, ...(extras.map(outboxToMessage) as unknown as T[])];
}

export function reconcileOutbox(
  outbox: OutboxItem[],
  serverMessages: { metadata?: unknown }[],
): OutboxItem[] {
  if (outbox.length === 0) return outbox;
  const known = new Set<string>();
  for (const message of serverMessages) {
    const id = readClientId(message);
    if (id) known.add(id);
  }
  if (known.size === 0) return outbox;
  const next = outbox.filter((item) => !known.has(item.clientId));
  return next.length === outbox.length ? outbox : next;
}

export function canRetryMessage(message: { direction?: string; metadata?: unknown }): boolean {
  if (message.direction !== "out") return false;
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  if (meta.send_status !== "failed") return false;
  return meta.local_outbox === true || meta.is_manual_admin === true;
}

export function retryPayloadFromMessage(message: {
  body?: string | null;
  metadata?: unknown;
}): ComposerSendPayload | null {
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const body = String(message.body ?? "");
  const path = meta.storage_path;
  const name = meta.file_name;
  const mime = meta.mime_type;
  const size = meta.size;
  if (
    typeof path === "string" &&
    path.length > 0 &&
    typeof name === "string" &&
    name.length > 0 &&
    typeof mime === "string" &&
    mime.length > 0 &&
    typeof size === "number" &&
    Number.isInteger(size) &&
    size > 0
  ) {
    return {
      body,
      attachment: {
        path,
        name,
        mime,
        size,
        previewUrl: typeof meta.media_url === "string" ? meta.media_url : null,
      },
    };
  }
  if (!body.trim()) return null;
  return { body, attachment: null };
}
