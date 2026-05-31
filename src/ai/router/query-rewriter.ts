/**
 * Query Rewriter.
 *
 * Turns a short, context-dependent guest message into a self-contained
 * query that the intent classifier and downstream agents can handle
 * without needing access to conversation history.
 *
 * Pure function, template-based — no LLM, no I/O.
 *
 * Example:
 *   message "kalau deluxe"
 *   resolved { topic: "room_facilities", entity: { label: "Deluxe" } }
 *   → "fasilitas kamar Deluxe"
 */

import type { ResolvedContext, TopicKind } from "./context-resolver";

export interface RewriteResult {
  /** Original message, unchanged. */
  original: string;
  /** Rewritten query for the classifier — same as original if no rewrite applied. */
  rewritten: string;
  /** True when a rewrite was actually performed. */
  rewritten_applied: boolean;
}

const TOPIC_TEMPLATE: Record<TopicKind, (entityLabel?: string) => string> = {
  room_facilities: (e) => `fasilitas kamar ${e ?? ""}`.trim(),
  room_specs:      (e) => `spesifikasi kamar ${e ?? ""}`.trim(),
  pricing:         (e) => `harga kamar ${e ?? ""}`.trim(),
  availability:    (e) => `ketersediaan kamar ${e ?? ""}`.trim(),
  policies:        ()  => "kebijakan dan aturan menginap",
  location:        ()  => "lokasi dan alamat properti",
  payment:         ()  => "informasi pembayaran",
  complaint:       ()  => "komplain tamu",
  smalltalk:       ()  => "sapaan",
};

export function rewriteQuery(message: string, resolved: ResolvedContext): RewriteResult {
  const original = message.trim();

  // Only rewrite when we INHERITED something — otherwise the message is
  // already self-contained and rewriting it would just add noise.
  if (!resolved.topicInherited && !resolved.entityInherited) {
    return { original, rewritten: original, rewritten_applied: false };
  }

  if (!resolved.topic) {
    return { original, rewritten: original, rewritten_applied: false };
  }

  const template = TOPIC_TEMPLATE[resolved.topic];
  if (!template) {
    return { original, rewritten: original, rewritten_applied: false };
  }

  const entityLabel = resolved.entity?.label;
  const rewritten = template(entityLabel);
  if (!rewritten || rewritten === original) {
    return { original, rewritten: original, rewritten_applied: false };
  }

  return { original, rewritten, rewritten_applied: true };
}
