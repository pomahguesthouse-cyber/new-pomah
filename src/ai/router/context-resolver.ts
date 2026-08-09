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
  | "room_facilities"
  | "room_specs"
  | "pricing"
  | "availability"
  | "policies"
  | "location"
  | "payment"
  | "complaint"
  | "smalltalk";

export interface EntityRef {
  kind: "room" | "date_range" | "amenity";
  id?: string;
  label?: string;
}

export interface PartialSlots {
  checkIn?: string;
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
  topicInherited: boolean;
  entityInherited: boolean;
  /**
   * Tamu memakai kata tunjuk ("yang ini", "kamar itu", "yang tadi") sementara
   * tipe kamar yang dirujuk TIDAK pernah ia sebut sendiri — entity satu-satunya
   * berasal dari warisan state/ringkasan sesi.
   *
   * Insiden 9 Agu 2026: setelah bot menampilkan 3 tipe kamar, tamu bertanya
   * "yang ini bisa berapa orang ya". Resolver mewarisi entity "Grand Deluxe"
   * dari ringkasan sesi dan bot menjawab kapasitas Grand Deluxe seolah tamu
   * sudah memilihnya — padahal tamu belum menyebut tipe apa pun. Flag ini
   * memberi tahu agent untuk MENGKONFIRMASI, bukan menebak.
   */
  entityAmbiguous: boolean;
  reasons: string[];
}

const TOPIC_KEYWORDS: Array<[TopicKind, RegExp]> = [
  ["room_facilities", /\b(fasilitas|amenit(ies|as)|perlengkapan|ada (apa|wifi|ac|tv|kulkas|dapur)|punya (wifi|ac|tv))\b/i],
  ["pricing", /\b(harga|tarif|rate|biaya|cost|per malam|semalam|diskon|promo|paket|berapa(an| sih)?)\b/i],
  ["availability", /\b(kosong|tersedia|available|availability|ada kamar|masih ada|booking|reservasi|pesan|kapan)\b/i],
  ["room_specs", /\b(berapa orang|kapasitas|ukuran|luas|tempat tidur|bed|king|double|twin|lantai|lanati|lt\.?\s*\d*)\b/i],
  ["policies", /\b(check[ -]?in|check[ -]?out|sarapan|breakfast|parkir|refund|kebijakan|aturan|jam berapa)\b/i],
  ["location", /\b(alamat|lokasi|dimana|di ?mana|maps|peta|dekat|jarak)\b/i],
  ["payment", /\b(bayar|transfer|rekening|invoice|kwitansi|bukti bayar)\b/i],
  ["complaint", /\b(komplain|kecewa|buruk|jelek|tidak puas|nggak puas)\b/i],
  ["smalltalk", /^(halo|hai|hi|hey|hello|selamat (pagi|siang|sore|malam))\b/i],
];

const FOLLOW_UP_PATTERN = /^\s*(kalau|kalo|terus|lalu|trus|gimana|bagaimana( dengan)?|kalau yang|yang)\b/i;
const POSITIONAL_ROOM = /\byang\s+(bawah|atas|lantai\s*\d|murah|mahal|paling\s+\w+)\b/i;

/**
 * Kata tunjuk tanpa antecedent yang jelas — "yang ini", "kamar itu", "yg tadi".
 * Sengaja TIDAK memasukkan bentuk yang sudah spesifik seperti "yang murah" atau
 * "yang lantai 2" (ditangani POSITIONAL_ROOM) karena itu benar-benar menunjuk.
 */
const DEMONSTRATIVE_REF =
  /\b(yang|yg)\s+(ini|itu|tadi|tsb|tersebut)\b|\bkamar\s+(ini|itu|tersebut)\b|^\s*(ini|itu)\b/i;

function normalizeRoomName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function extractRoomEntity(text: string, rooms: RoomTypeRow[]): EntityRef | undefined {
  const normalizedText = normalizeRoomName(text);
  if (!normalizedText) return undefined;

  // 1. Exact room-name input. "deluxe" must resolve to Deluxe, not Grand Deluxe.
  const exact = rooms.find((room) => normalizeRoomName(room.name) === normalizedText);
  if (exact) return { kind: "room", id: exact.id, label: exact.name };

  // 2. Match complete room names inside the sentence, longest first.
  // "kamar grand deluxe" resolves to Grand Deluxe, while "kamar deluxe"
  // resolves only to the exact full name Deluxe.
  const fullMatches = [...rooms]
    .filter((room) => {
      const name = normalizeRoomName(room.name);
      if (!name) return false;
      return new RegExp(`(^|\\s)${name.replace(/\s+/g, "\\s+")}($|\\s)`, "i").test(normalizedText);
    })
    .sort((a, b) => normalizeRoomName(b.name).length - normalizeRoomName(a.name).length);

  if (fullMatches.length > 0) {
    const room = fullMatches[0]!;
    return { kind: "room", id: room.id, label: room.name };
  }

  // 3. Accept a short alias only when unique across all room types.
  const tokens = normalizedText.split(" ").filter(Boolean);
  for (const token of tokens) {
    if (token.length < 4) continue;
    const matches = rooms.filter((room) => normalizeRoomName(room.name).split(" ").includes(token));
    if (matches.length === 1) {
      const room = matches[0]!;
      return { kind: "room", id: room.id, label: room.name };
    }
  }

  const positional = text.match(POSITIONAL_ROOM);
  if (positional) return { kind: "room", label: positional[0].trim() };
  return undefined;
}

const NIGHTS_RE = /\b(\d{1,2})\s*malam\b/i;
const ADULTS_RE = /\b(\d{1,2})\s*(orang|dewasa|tamu|pax)\b/i;
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

export function seedEntityFromSummary(
  args: {
    chatSummary?: string | null;
    chatSummaryJson?: { room_type?: string | null } | null;
  },
  rooms: RoomTypeRow[],
): EntityRef | undefined {
  const roomTypeHint = args.chatSummaryJson?.room_type?.trim();
  if (roomTypeHint) {
    const normalizedHint = normalizeRoomName(roomTypeHint);
    const exact = rooms.find((room) => normalizeRoomName(room.name) === normalizedHint);
    if (exact) return { kind: "room", id: exact.id, label: exact.name };

    const fullMatches = [...rooms]
      .filter((room) => {
        const name = normalizeRoomName(room.name);
        return name.length >= 3 && normalizedHint.includes(name);
      })
      .sort((a, b) => normalizeRoomName(b.name).length - normalizeRoomName(a.name).length);
    if (fullMatches.length === 1) {
      const room = fullMatches[0]!;
      return { kind: "room", id: room.id, label: room.name };
    }
    return { kind: "room", label: roomTypeHint };
  }
  if (!args.chatSummary) return undefined;
  return extractRoomEntity(args.chatSummary, rooms);
}

export function resolveContext(
  message: string,
  state: ConversationStateSnapshot,
  rooms: RoomTypeRow[],
): ResolvedContext {
  const reasons: string[] = [];
  const text = message.trim();

  let topic: TopicKind | undefined;
  for (const [kind, re] of TOPIC_KEYWORDS) {
    if (re.test(text)) {
      topic = kind;
      reasons.push(`topic:${kind} from message keyword`);
      break;
    }
  }

  let entity = extractRoomEntity(text, rooms);
  if (entity) reasons.push(`entity:room:${entity.label}`);

  const messageSlots = extractSlots(text);
  if (Object.keys(messageSlots).length) reasons.push(`slots:${JSON.stringify(messageSlots)}`);

  let topicInherited = false;
  let entityInherited = false;

  if (topic === "smalltalk") {
    reasons.push("greeting — clearing prior topic");
    return {
      topic,
      entity,
      slots: messageSlots,
      topicInherited: false,
      entityInherited: false,
      entityAmbiguous: false,
      reasons,
    };
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp = wordCount <= 4 || FOLLOW_UP_PATTERN.test(text);
  if (!topic && state.lastTopic && looksLikeFollowUp) {
    topic = state.lastTopic as TopicKind;
    topicInherited = true;
    reasons.push(`topic:${topic} inherited (short follow-up)`);
  }

  if (!topic && entity?.kind === "room") {
    topic = "room_specs";
    reasons.push("topic:room_specs default for bare room mention");
  }

  // Kata tunjuk terdeteksi SEBELUM warisan diterapkan: pertanyaannya adalah
  // apakah tamu menyebut tipe kamar SENDIRI di pesan ini.
  const usesDemonstrative = DEMONSTRATIVE_REF.test(text) && !POSITIONAL_ROOM.test(text);
  const namedRoomInMessage = !!entity;

  if (!entity && state.lastEntity) {
    entity = state.lastEntity as unknown as EntityRef;
    entityInherited = true;
    reasons.push(`entity inherited: ${entity?.label}`);
  }

  // Ambigu bila: tamu menunjuk ("yang ini") + tidak menyebut nama tipe kamar +
  // satu-satunya kandidat berasal dari warisan state/ringkasan. Menebak di sini
  // menghasilkan jawaban yang terdengar percaya diri tapi salah kamar.
  const entityAmbiguous = usesDemonstrative && !namedRoomInMessage && entityInherited;
  if (entityAmbiguous) {
    reasons.push(
      `entity AMBIGUOUS: demonstratif tanpa nama tipe kamar; kandidat warisan "${entity?.label ?? "-"}" tidak boleh diasumsikan`,
    );
  }

  const priorSlots = (state.slots ?? {}) as PartialSlots;
  const slots: PartialSlots = { ...priorSlots, ...messageSlots };
  // Jangan kunci roomLabel dari entity yang ambigu — nilai itu akan dipersist
  // ke conversation-state dan menular ke turn-turn berikutnya.
  if (entity?.kind === "room" && entity.label && !entityAmbiguous) slots.roomLabel = entity.label;

  return { topic, entity, slots, topicInherited, entityInherited, entityAmbiguous, reasons };
}
