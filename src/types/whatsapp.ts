import type { ChatSummaryStructured } from "@/ai/chat-summary.types";

export type WhatsAppDirection = "in" | "out";
export type WhatsAppThreadStatus = "open" | "closed";

export interface WhatsAppThread {
  id: string;
  guest_id: string | null;
  phone: string;
  display_name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number | null;
  status: WhatsAppThreadStatus | string | null;
  created_at: string | null;
  tags: string[] | null;
  intent: string | null;
  pinned: boolean | null;
  assigned_to: string | null;
  ai_analysis: Record<string, unknown> | null;
  is_training_example: boolean | null;
  ai_auto: boolean | null;
  chat_summary: string | null;
  chat_summary_json: ChatSummaryStructured | Record<string, unknown> | null;
  chat_summary_version: number | null;
  chat_summary_updated_at: string | null;
}

export interface WhatsAppMessage {
  id: string;
  thread_id: string;
  direction: WhatsAppDirection | string;
  body: string;
  sent_at: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WhatsAppGuestContext {
  id?: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface WhatsAppBookingContext {
  id: string;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  adults: number | null;
  children: number | null;
  total_amount: number | null;
  special_requests: string | null;
  room_type_id: string | null;
  room_id: string | null;
}

export interface WhatsAppThreadDetail {
  thread: WhatsAppThread | null;
  messages: WhatsAppMessage[];
  guest: WhatsAppGuestContext | null;
  booking: WhatsAppBookingContext | null;
}

export function isEmptySummaryJson(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
  );
}

export function threadNeedsSummary(thread: Pick<WhatsAppThread, "chat_summary" | "chat_summary_json" | "chat_summary_updated_at"> | null | undefined): boolean {
  if (!thread) return false;
  return (
    !thread.chat_summary_updated_at ||
    !thread.chat_summary?.trim() ||
    isEmptySummaryJson(thread.chat_summary_json)
  );
}
