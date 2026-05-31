/**
 * Context Resolver.
 *
 * Sits between the booking-state machine and the intent classifier.
 * Job: given the latest guest message + the persisted ConversationState,
 * decide
 *   - what TOPIC the guest is talking about (room facilities, pricing, ...)
 *   - what ENTITY the topic is about (which room, which date range)
 *   - which booking SLOTS the message provides (dates, guest count, ...)
 *
 * The resolver is a PURE function — it does no I/O. The orchestrator
 * loads state, calls resolveContext(), then persists the result.
 *
 * No LLM is involved. Short follow-ups like "kalau deluxe" inherit the
 * last topic; long messages with explicit keywords override it.
 */
import type { RoomTypeRow } from "@/ai/context-builder";

export type TopicKind =
  | "room_facilities"   // "fasilitas kamarnya apa aja"
  | "room_specs"        // "kamarnya berapa orang", "ada tv?"
  | "pricing"           // "berapa harganya"
  | "availability"      // "tanggal segini masih kosong?"
  | "policies"          // check-in/out, parkir, sarapan, refund
  | "location"
  | "payment"
  | "complaint"
  | "smalltalk";

export interface EntityRef {
  kind: "room" | "date_range" | "amenity";
  /** Room id when known (lookup from rooms table). */
  id?: string;
  /** Human-readable label, e.g. "Family Suite 100", "Deluxe". */
  label?: string;
}

export interface PartialSlots {
  checkIn?: string;       // ISO date
  checkOut?: string;
  nights?: number;
  adults?: number;
  children?: number;
  roomLabel?: string;
}

export interface ConversationStateSnapshot {
  lastTopic?: string | null;
  lastEntity?: Record<string, unknown> | null;
  slots?: Record<string, unknown>;
}

export interface ResolvedContext {
  topic?: TopicKind;
  entity?: EntityRef;
  slots: PartialSlots;
  /** True when the topic was inherited from prior state rather than from the message itself. */
  topicInherited: boolean;
  /** True when the entity was inherited from prior state. */
  entityInherited: boolean;
  /** Debug trail of which rules fired. */
  reasons: string[];
}

// ─── Topic keyword tables ─────────────────────────────────────────────────────

const TOPIC_KEYWORDS: Array<[TopicKind, RegExp]> = [
  ["room_facilities", /\b(fasilitas|amenit(ies|as)|perlengkapan|ada (apa|wifi|ac|tv|kulkas|dapur)|punya (wifi|ac|tv))\b/i],
  ["pricing",         /\b(harga|tarif|rate|biaya|cost|per malam|semalam|diskon|promo|paket|berapa(an| sih)?)\b/i],
  ["availability",    /\b(kosong|tersedia|available|availability|ada kamar|masih ada|booking|reservasi|pesan|kapan)\b/i],
  ["room_specs",      /\b(berapa orang|kapasitas|ukuran|luas|tempat tidur|bed|king|double|twin|lantai)\b/i],
  ["policies",        /\b(check[ -]?in|check[ -]?out|sarapan|breakfast|parkir|refund|kebijakan|aturan|jam berapa)\b/i],
  ["location",        /\b(alamat|lokasi|dimana|di ?mana|maps|peta|dekat|jarak)\b/i],
  ["payment",         /\b(bayar|transfer|rekening|invoice|kwitansi|bukti bayar)\b/i],
  ["complaint",       /\b(komplain|kecewa|buruk|jelek|tidak puas|nggak puas)\b/i],
  ["smalltalk",       /^(halo|hai|hi|hey|hello|selamat (pagi|siang|sore|malam))\b/i],
];

// Generic short follow-up words that, on their own, mean "same topic, new entity".
const FOLLOW_UP_PATTERN = /^\s*(kalau|kalo|terus|lalu|trus|gimana|bagaimana( dengan)?|kalau yang|yang)\b/i;

// ─── Entity extractors ───────────────────────────────────────────────────────

const POSITIONAL_ROOM = /\byang\s+(bawah|atas|lantai\s*\d|murah|mahal|paling\s+\w+)\b/i;

function extractRoomEntity(text: string, rooms: RoomTypeRow[]): EntityRef | undefined {
  // 1. Direct match against known room names (longest first to prefer "Family Suite 100" over "Family").
  const sorted = [...rooms].sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  const lower = text.toLowerCase();
  for (const r of sorted) {
    if (!r.name) continue;
    const name = r.name.toLowerCase();
    // Match the full name OR a meaningful trailing word (e.g. "deluxe").
    if (lower.includes(name)) {
      return { kind: "room", id: r.id, label: r.name };
    }
    // Try the last word ("Family Suite 100" → "100", "Standard Deluxe" → "deluxe").
    const lastWord = name.split(/\s+/).pop();
    if (lastWord && lastWord.length >= 4 && new RegExp(`\\b${lastWord}\\b`, "i").test(text)) {
      return { kind: "room", id: r.id, label: r.name };
    }
  }
  // 2. Generic positional reference — entity without an id, label preserved.
  const positional = text.match(POSITIONAL_ROOM);
  if (positional) {
    return { kind: "room", label: positional[0].trim() };
  }
  return undefined;
}

const NIGHTS_RE  = /\b(\d{1,2})\s*malam\b/i;
const ADULTS_RE  = /\b(\d{1,2})\s*(orang|dewasa|tamu|pax)\b/i;
const CHILDREN_RE = /\b(\d{1,2})\s*anak\b/i;

function extractSlots(text: string): PartialSlots {
  const slots: PartialSlots = {};
  const nights = text.match(NIGHTS_RE);
  if (nights) slots.nights = Number(nights[1]);
  const adults = text.match(ADULTS_RE);
  if (adults) slots.adults = Number(adults[1]);
  const children = text.match(CHILDREN_RE);
  if (children) slots.children = Number(children[1]);
  return slots;
}

// ─── Main resolver ───────────────────────────────────────────────────────────

export function resolveContext(
  message: string,
  state: ConversationStateSnapshot,
  rooms: RoomTypeRow[],
): ResolvedContext {
  const reasons: string[] = [];
  const text = message.trim();

  // 1. Topic from explicit keywords in the message.
  let topic: TopicKind | undefined;
  for (const [kind, re] of TOPIC_KEYWORDS) {
    if (re.test(text)) {
      topic = kind;
      reasons.push(`topic:${kind} from message keyword`);
      break;
    }
  }

  // 2. Entity from message (room name match, positional ref).
  let entity = extractRoomEntity(text, rooms);
  if (entity) reasons.push(`entity:room:${entity.label}`);

  // 3. Slots from message.
  const messageSlots = extractSlots(text);
  if (Object.keys(messageSlots).length) reasons.push(`slots:${JSON.stringify(messageSlots)}`);

  // 4. Inheritance rules.
  let topicInherited = false;
  let entityInherited = false;

  // 4a. Greeting clears the topic.
  if (topic === "smalltalk") {
    reasons.push("greeting — clearing prior topic");
    return {
      topic,
      entity,
      slots: messageSlots,
      topicInherited: false,
      entityInherited: false,
      reasons,
    };
  }

  // 4b. If no explicit topic AND the message looks like a short follow-up
  //     (≤ 4 words OR starts with kalau/gimana/terus/yang), inherit lastTopic.
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp = wordCount <= 4 || FOLLOW_UP_PATTERN.test(text);
  if (!topic && state.lastTopic && looksLikeFollowUp) {
    topic = state.lastTopic as TopicKind;
    topicInherited = true;
    reasons.push(`topic:${topic} inherited (short follow-up)`);
  }

  // 4c. If we found a new entity but no topic in either message or state,
  //     and the entity is a room → assume the guest wants to know about it.
  //     Default to whatever the last topic was, or room_specs as a sensible
  //     default for "tell me about room X".
  if (!topic && entity?.kind === "room") {
    topic = "room_specs";
    reasons.push("topic:room_specs default for bare room mention");
  }

  // 4d. Inherit entity when message has slots/topic but no entity of its own.
  if (!entity && state.lastEntity) {
    entity = state.lastEntity as unknown as EntityRef;
    entityInherited = true;
    reasons.push(`entity inherited: ${entity?.label}`);
  }

  // 5. Merge slots: prior slots persist unless overridden by this message.
  const priorSlots = (state.slots ?? {}) as PartialSlots;
  const slots: PartialSlots = { ...priorSlots, ...messageSlots };
  if (entity?.kind === "room" && entity.label) slots.roomLabel = entity.label;

  return { topic, entity, slots, topicInherited, entityInherited, reasons };
}
