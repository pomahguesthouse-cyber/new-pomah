/**
 * Intent classifier.
 *
 * Fast rule-based classification using keyword patterns.
 * Returns the best-matching IntentCategory + a confidence score.
 *
 * Design decisions:
 *   - Each rule has a weight; the highest total weight wins.
 *   - Complaint signals always trump other matches (escalation path).
 *   - "general" is the fallback with confidence 0.4.
 *   - No external calls — pure CPU, runs in < 1 ms.
 */

import type { IntentCategory }   from "@/ai/agents/types";
import type { ClassifiedIntent }  from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Rule definitions ─────────────────────────────────────────────────────────

interface IntentRule {
  category: IntentCategory;
  /** Array of regex patterns; EACH match adds `weight` to the score */
  patterns: RegExp[];
  weight:   number;
}

const RULES: IntentRule[] = [
  // ── Admin Rules (only match if in admin mode, very high weight)
  {
    category: "list_bookings",
    weight:   20,
    patterns: [
      /^\/(booking|list|daftar|cek)\b/i,
      /\b(tampilkan|lihat) (semua )?(booking|pesanan|reservasi)\b/i,
      /\b(daftar booking|list booking|cek booking|cek jadwal)\b/i,
    ],
  },
  {
    category: "booking_detail",
    weight:   20,
    patterns: [
      /^\/(detail)\b/i,
      /\b(lihat|cek) detail\b/i,
      /\b(detail booking|detail pesanan)\b/i,
    ],
  },
  {
    category: "payment_update",
    weight:   20,
    patterns: [
      /^\/(bayar|lunas|payment|update)\b/i,
      /\b(update bayar|sudah lunas|sudah dp|konfirmasi bayar|tandai (lunas|bayar))\b/i,
    ],
  },
  {
    category: "room_block",
    weight:   20,
    patterns: [
      /^\/(blok|block)\b/i,
      /\b(blok(ir)? kamar|kamar rusak|tutup kamar|kamar (sedang )?maintenance)\b/i,
    ],
  },
  {
    category: "send_to_manager",
    weight:   20,
    patterns: [
      /^\/(forward|laporkan|kirim)\b/i,
      /\b(teruskan ke (owner|manajer|manager|pengelola))\b/i,
      /\b(laporkan ke (owner|manajer|manager))\b/i,
    ],
  },

  // ── Complaints (highest weight — always escalate)
  {
    category: "complaint",
    weight:   10,
    patterns: [
      /\b(komplain|complain|kecewa|tidak puas|nggak puas|ga puas|buruk|jelek|parah|mengecewakan|kecewa banget|sangat kecewa)\b/i,
      /\b(minta ganti rugi|minta refund|kembalikan uang|uang kembali|cancel booking)\b/i,
      /\b(mana pelayanannya|pelayanan buruk|lambat banget|nggak profesional|tidak profesional)\b/i,
    ],
  },

  // ── Maintenance
  {
    category: "maintenance",
    weight:   8,
    patterns: [
      /\b(rusak|bocor|mati|tidak berfungsi|nggak berfungsi|ga berfungsi|error|trouble)\b/i,
      /\b(ac|air conditioner|kipas|lampu|listrik|tv|televisi|remote|kran|shower|toilet|flush|pintu|kunci|gembok)\b.*\b(rusak|mati|bocor|macet|tidak|nggak|ga)\b/i,
      /\b(tolong (perbaiki|cek|periksa)|ada masalah dengan|laporkan kerusakan|maintenance|teknisi)\b/i,
      /\b(mati lampu|air mati|air tidak keluar|ac tidak dingin|wifi mati|wifi tidak)\b/i,
    ],
  },

  // ── Customer Care
  {
    category: "customer-care",
    weight:   8,
    patterns: [
      /\b(handuk|towel|selimut|bantal|pillow|sabun|shampoo|sampo|toiletries|perlengkapan mandi)\b/i,
      /\b(bersih(kan)?|beres(kan)?|ganti|tukar|tambah(kan)?|kekurangan)\b.*\b(kamar|sprei|bed|tempat tidur|handuk)\b/i,
      /\b(housekeeping|room service|layanan kamar|minta (tolong )?(bersih|ganti|tambah))\b/i,
      /\b(sprei|bed cover|bantal tambahan|ekstra bantal|extra pillow|extra towel)\b/i,
    ],
  },

  // ── Payment / Finance
  {
    category: "payment",
    weight:   7,
    patterns: [
      /\b(bayar|pembayaran|payment|paymentnya)\b/i,                  // EN "payment" was missing — guests use it constantly.
      /\b(transfer|rekening|bank|bca|mandiri|bni|bri|gopay|ovo|dana|qris)\b/i,
      /\b(invoice|kwitansi|bukti bayar|konfirmasi bayar|sudah (bayar|transfer))\b/i,
      /\b(cicil|dp|uang muka|down payment|lunas|sisa pembayaran|tagihan)\b/i,
      /\b(refund|pengembalian dana|cancel dan refund|minta refund)\b/i,
    ],
  },

  // ── Pricing inquiry
  {
    category: "pricing_inquiry",
    weight:   6,
    patterns: [
      /\b(harga|tarif|rate|biaya|cost|per malam|semalam|weekend|weekday)\b/i,
      /\b(diskon|promo|paket|special rate|long stay|early bird|flash sale)\b/i,
      /\b(berapa (harga|tarif|biayanya?|costnya?))\b/i,
      /\b(kamar (paling )?(murah|termurah|mahal|termahal))\b/i,
    ],
  },

  // ── Availability check (explicit)
  {
    category: "availability_check",
    weight:   6,
    patterns: [
      /\b(ada kamar|kamar (ada|kosong|tersedia)|masih ada kamar|kamar masih)\b/i,
      /\b(tersedia|ketersediaan|available|availability)\b/i,
      /\b(cek kamar)\b/i,
      /\b(masih ada|ada kosong|ada yang kosong|masih tersedia)\b/i,
      /\btanggal\b.*\b(masih|ada|kosong)\b/i,
    ],
  },

  // ── Booking inquiry (broader — includes booking intent)
  {
    category: "booking_inquiry",
    weight:   5,
    patterns: [
      /\b(pesan|booking|reservasi|book|reserve|mau (pesan|booking|menginap|nginap))\b/i,
      /\b(check[ -]?in|check[ -]?out|checkin|checkout)\b/i,
      /\b(menginap|nginap|mau (malam|tidur) di|ingin menginap)\b/i,
      /\b(untuk (berapa malam|tanggal|besok|lusa|akhir pekan|weekend|malam ini))\b/i,
      /\b(lihat kamar|kamar untuk)\b/i,
    ],
  },

  // ── Booking start (explicit booking intent — lebih spesifik dari booking_inquiry)
  {
    category: "booking_start",
    weight:   6,
    patterns: [
      /\b(mau booking|mau pesan|booking dong|pesan kamar|reservasi dong|book kamar)\b/i,
      /\b(saya (mau|ingin) (booking|pesan|reservasi|menginap|nginap))\b/i,
    ],
  },

  // ── Guest count input
  {
    category: "guest_count_input",
    weight:   5,
    patterns: [
      /\b(dewasa|orang dewasa|adult)\s*\d+/i,
      /\d+\s*(dewasa|orang dewasa|adult)/i,
      /\b(anak|children|child|kids?)\s*\d+/i,
      /\d+\s*(anak|children|child|kids?)/i,
      /\b(kami|kita)\s+(?:ber)?\d+\b/i,
    ],
  },

  // ── Payment policy question
  {
    category: "payment_policy_question",
    weight:   7,
    patterns: [
      /\b(bisa dp|dp dulu|bayar berapa dulu|uang muka|down ?payment|dp minimal|dp berapa|cara bayar|metode (?:pembayaran|bayar))\b/i,
      /\b(bayar(?:nya)? (?:gimana|bagaimana|berapa)|kebijakan (?:pembayaran|bayar))\b/i,
    ],
  },

  // ── Bank account request
  {
    category: "bank_account_request",
    weight:   7,
    patterns: [
      /\b(norek|no\.?\s*rek|nomor rekening|nomer rekening)\b/i,
      /\b(transfer (?:ke ?mana|kemana|ke bank apa))\b/i,
      /\b(rekening (?:apa|bank|mana)|minta.{0,10}(?:norek|rekening))\b/i,
    ],
  },

  // ── Invoice request
  {
    category: "invoice_request",
    weight:   7,
    patterns: [
      /\b(minta invoice|kirim(?:kan)? invoice|butuh invoice|invoice(?:nya)?|kwitansi|bukti (?:booking|pemesanan|reservasi))\b/i,
    ],
  },

  // ── Room detail question
  {
    category: "room_detail_question",
    weight:   5,
    patterns: [
      /\b(wifi|wi-fi|parkir|sarapan|breakfast|kolam|pool|fasilitas|amenities|lantai berapa|view|pemandangan|kamar mandi|bathroom)\b.*\?/i,
      /\b(ada (?:wifi|parkir|sarapan|kolam|breakfast|ac))\b/i,
      /\b(kamar(?:nya)? (?:ada|punya|include|termasuk))\b/i,
    ],
  },

  // ── Check-in policy question
  {
    category: "checkin_policy_question",
    weight:   5,
    patterns: [
      /\b(jam check[ -]?in|check[ -]?in jam|early check[ -]?in|late check[ -]?out|jam berapa (?:check|cek)|checkout jam)\b/i,
      /\b(bisa check[ -]?in (?:lebih awal|pagi|jam)|boleh late)\b/i,
    ],
  },

  // ── Early arrival question
  {
    category: "early_arrival_guest_question",
    weight:   5,
    patterns: [
      /\b(datang lebih awal|sampai (?:lebih )?awal|titip (?:koper|barang|tas)|nitip (?:koper|barang)|sebelum (?:jam )?check[ -]?in)\b/i,
      /\b(tiba (?:pagi|sebelum)|arrival (?:pagi|awal))\b/i,
    ],
  },

  // ── Greetings
  {
    category: "greeting",
    weight:   3,
    patterns: [
      /^(halo|hai|hi|hey|hello|hei|assalam|selamat (pagi|siang|sore|malam)|pagi|siang|sore|malam)\b/i,
      /\b(apa kabar|gimana kabarnya|ada yang bisa dibantu|bisa dibantu)\b/i,
    ],
  },
];

interface DBIntentRule {
  category: string;
  patterns: string[];
  weight: number;
}

interface CachedRules {
  rules: IntentRule[];
  expiresAt: number;
}

let cachedDbRules: CachedRules | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Expose clear cache helper for admin editor
export function clearIntentRulesCache(): void {
  cachedDbRules = null;
}

/**
 * Optional conversation context that lets the classifier route short
 * follow-ups (e.g. "ya", "oke", "yg itu aja") to the previously-active intent
 * instead of falling through to "general".
 */
export interface IntentContext {
  /** True when the booking state machine is mid-flow (state !== IDLE). */
  bookingActive?: boolean;
  /** Last resolved topic from the context resolver (e.g. "pricing", "availability"). */
  lastTopic?: string | null;
  /** Current user mode */
  mode?: "guest" | "admin" | "managerial";
}

const SHORT_AFFIRMATIVE =
  /^\s*(ya|iya|yoi|yap|yup|oke|ok|okeh|sip|boleh|mau|lanjut|setuju|deal|gas|gass|baik|y|yh|yg itu|itu aja|yang itu|itu)[\s.!?]*$/i;

// Slot-filling follow-ups: jawaban PENDEK yang jelas mengisi satu slot
// booking saat percakapan sebelumnya masih seputar booking/pricing/availability.
// Tanpa ini, "Deluxe" atau "2 orang" jatuh ke intent "general" dan kena
// salah-route ke agen lain.
const SLOT_FILL_PEOPLE_COUNT = /^\s*\d+\s*(orang|tamu|dewasa|pax|anak|adult|child)?\s*(dan\s*\d+\s*(anak|child|kids?))?[\s.!?]*$/i;
const SLOT_FILL_ISOLATED_DATE =
  /^\s*(\d{1,2}([\/\-\.]\d{1,2})?([\/\-\.]\d{2,4})?|tanggal\s+\d{1,2}|\d{1,2}\s+(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)\w*|besok|lusa|hari ini|minggu depan|akhir (minggu|pekan))[\s.!?]*$/i;

const TOPIC_TO_INTENT: Record<string, IntentCategory> = {
  pricing:         "pricing_inquiry",
  availability:    "availability_check",
  room_facilities: "booking_inquiry",
  room_specs:      "booking_inquiry",
  payment:         "payment",
  complaint:       "complaint",
  booking:         "booking_inquiry",
};

/**
 * Optional extra signals for slot-fill detection: a list of room-type display
 * names so a bare reply like "Deluxe" can be recognised as `booking_inquiry`.
 */
export interface IntentContextExtras {
  roomTypeNames?: string[];
}

/**
 * Classify the intent of a user message.
 *
 * Returns the top-scoring IntentCategory with a normalised confidence (0–1).
 * "general" is the default when no rules match with meaningful weight.
 */
export async function classifyIntent(
  text: string,
  supabase?: SupabaseClient,
  llmConfig?: { apiKey: string; baseUrl: string; model: string },
  context?: IntentContext & IntentContextExtras,
): Promise<ClassifiedIntent> {
  // Short affirmative follow-up — inherit prior intent so the agent keeps
  // its train of thought instead of greeting/generalising.
  if (context && SHORT_AFFIRMATIVE.test(text)) {
    const inherited =
      (context.lastTopic && TOPIC_TO_INTENT[context.lastTopic]) ||
      (context.bookingActive ? "booking_inquiry" : undefined);
    if (inherited) {
      return { category: inherited, confidence: 0.8, matchedTerms: ["context-inherit"] };
    }
  }

  // Slot-fill follow-up: only when there's a booking-ish topic on the table.
  if (context) {
    const topicIsBookingish = context.bookingActive
      || context.lastTopic === "availability"
      || context.lastTopic === "pricing"
      || context.lastTopic === "booking"
      || context.lastTopic === "room_facilities"
      || context.lastTopic === "room_specs";

    if (topicIsBookingish) {
      const trimmed = text.trim();
      const isShort = trimmed.length <= 30;
      const matchesPeople = SLOT_FILL_PEOPLE_COUNT.test(trimmed);
      const matchesDate   = SLOT_FILL_ISOLATED_DATE.test(trimmed);
      const matchesRoom   = isShort && (context.roomTypeNames ?? []).some((rn) => {
        const n = rn.trim().toLowerCase();
        return n.length >= 3 && new RegExp(`^${n}$|^${n}\\s|\\s${n}$`, "i").test(trimmed);
      });

      if (matchesPeople || matchesDate || matchesRoom) {
        return {
          category: "booking_inquiry",
          confidence: 0.8,
          matchedTerms: [matchesRoom ? "slot-fill-room" : matchesPeople ? "slot-fill-people" : "slot-fill-date"],
        };
      }
    }
  }

  // Filter admin rules if user is not in admin/managerial mode
  let activeRules = RULES.filter(r => {
    const isAdminRule = [
      "list_bookings", "booking_detail", "payment_update", "room_block", "send_to_manager"
    ].includes(r.category);
    
    if (isAdminRule) {
      return context?.mode === "admin" || context?.mode === "managerial";
    }
    return true;
  });

  if (supabase) {
    const now = Date.now();
    if (cachedDbRules && cachedDbRules.expiresAt > now) {
      activeRules = cachedDbRules.rules;
    } else {
      try {
        const { data, error } = await supabase
          .from("ai_intent_rules")
          .select("category, patterns, weight")
          .order("weight", { ascending: false });

        if (error) {
          console.warn("[classifyIntent] Failed to fetch rules from database, using static fallback:", error.message);
        } else if (data && data.length > 0) {
          const parsedRules: IntentRule[] = [];
          for (const row of data as DBIntentRule[]) {
            const patterns: RegExp[] = [];
            for (const pStr of row.patterns) {
              try {
                let cleanPattern = pStr;
                let flags = "i";
                if (pStr.startsWith("/") && pStr.lastIndexOf("/") > 0) {
                  const lastSlash = pStr.lastIndexOf("/");
                  cleanPattern = pStr.slice(1, lastSlash);
                  const parsedFlags = pStr.slice(lastSlash + 1);
                  if (parsedFlags.includes("i") || parsedFlags === "") {
                    flags = parsedFlags;
                  }
                }
                patterns.push(new RegExp(cleanPattern, flags));
              } catch (e: any) {
                console.warn(`[classifyIntent] Invalid pattern ignored: "${pStr}" in category "${row.category}":`, e.message);
              }
            }
            parsedRules.push({
              category: row.category as IntentCategory,
              patterns,
              weight: row.weight,
            });
          }
          cachedDbRules = {
            rules: parsedRules,
            expiresAt: now + CACHE_TTL,
          };
          activeRules = parsedRules;
        } else {
          console.log("[classifyIntent] No rules found in database, using static fallback.");
        }
      } catch (e: any) {
        console.warn("[classifyIntent] Error fetching rules:", e.message);
      }
    }
  }

  const scores = new Map<IntentCategory, number>();
  const matched = new Map<IntentCategory, string[]>();

  for (const rule of activeRules) {
    for (const pattern of rule.patterns) {
      const hit = text.match(pattern);
      if (hit) {
        scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
        const terms = matched.get(rule.category) ?? [];
        terms.push(hit[0]);
        matched.set(rule.category, terms);
      }
    }
  }

  // Pick highest score
  let best:      IntentCategory = "general";
  let bestScore  = 0;
  let totalScore = 0;

  for (const [cat, score] of scores) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      best      = cat;
    }
  }

  // Normalise confidence: ratio of best score to total (capped at 0.95)
  const confidence = Math.min(0.95, bestScore / Math.max(totalScore, 1));

  const ruleResult = {
    category:     scores.size === 0 ? ("general" as IntentCategory) : best,
    confidence:   scores.size === 0 ? 0.4 : confidence,
    matchedTerms: scores.size === 0 ? [] : (matched.get(best) ?? []),
  };

  // Trigger LLM Fallback if ambiguous or general and llmConfig is present
  const isAmbiguous = ruleResult.category === "general" || ruleResult.confidence < 0.70;

  // Gibberish guard: don't let the LLM "autocorrect" a single nonsense token
  // (e.g. "sisng", "kmar", "asdf") into a confident booking/availability intent.
  // If the rules matched nothing AND the message is one short alphabetic token
  // that isn't a known short keyword, treat it as unintelligible → "general"
  // so the bot asks the guest to rephrase instead of firing tools.
  const trimmedForGuard = text.trim();
  const isSingleToken = /^[a-zA-Z]+$/.test(trimmedForGuard);
  const KNOWN_SHORT_WORDS = /^(ya|ok|oke|sip|halo|hai|hi|cek|kos|wifi|dp|booking|kamar)$/i;
  const isLikelyGibberish =
    scores.size === 0 &&
    isSingleToken &&
    trimmedForGuard.length <= 6 &&
    !KNOWN_SHORT_WORDS.test(trimmedForGuard);

  if (isLikelyGibberish) {
    return {
      category: "general",
      confidence: 0.4,
      matchedTerms: ["gibberish-guard"],
    };
  }

  if (isAmbiguous && llmConfig?.apiKey) {
    const INTENT_LLM_TIMEOUT_MS = 5_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INTENT_LLM_TIMEOUT_MS);
    try {
      const res = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: llmConfig.model,
          temperature: 0,
          max_tokens: 80,
          messages: [
            {
              role: "system",
              content:
                "Anda adalah asisten pengklasifikasi intent percakapan tamu hotel. " +
                "Klasifikasikan pesan tamu ke salah satu kategori intent berikut:\n" +
                "- greeting (salam, halo)\n" +
                "- booking_inquiry (tanya kamar, cara pesan, mau booking)\n" +
                "- availability_check (ketersediaan/ada kamar kosong atau tidak)\n" +
                "- pricing_inquiry (tanya harga, tarif, diskon, promo)\n" +
                "- customer-care (layanan kamar, minta handuk/bantal/bersih kamar)\n" +
                "- maintenance (kerusakan fasilitas: AC mati, kran bocor, wifi lambat)\n" +
                "- payment (metode transfer, bukti bayar, tagihan, invoice)\n" +
                "- complaint (keluhan tamu, pelayanan buruk, kecewa)\n" +
                "- general (pertanyaan umum/lain-lain)\n\n" +
                "Balas HANYA dengan objek JSON tanpa penjelasan lain, contoh format:\n" +
                "{\"category\": \"booking_inquiry\", \"confidence\": 0.95}"
            },
            {
              role: "user",
              content: `Pesan tamu: "${text}"`
            }
          ]
        }),
      });

      if (res.ok) {
        const rawBody = await res.text();
        const json = JSON.parse(rawBody);
        const content = json.choices?.[0]?.message?.content ?? "";
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.category && typeof parsed.confidence === "number") {
            const category = parsed.category.toLowerCase().trim();
            const VALID_CATEGORIES: IntentCategory[] = [
              "greeting",
              "booking_inquiry",
              "availability_check",
              "pricing_inquiry",
              "customer-care",
              "maintenance",
              "payment",
              "complaint",
              "booking_start",
              "guest_count_input",
              "payment_policy_question",
              "bank_account_request",
              "invoice_request",
              "room_detail_question",
              "checkin_policy_question",
              "early_arrival_guest_question",
              "list_bookings",
              "booking_detail",
              "payment_update",
              "room_block",
              "send_to_manager",
              "general",
            ];
            if (VALID_CATEGORIES.includes(category as IntentCategory)) {
              console.info(`[classifyIntent] LLM Fallback Success: mapped "${text}" to "${category}" (confidence: ${parsed.confidence})`);
              return {
                category: category as IntentCategory,
                confidence: Math.max(0, Math.min(0.95, parsed.confidence)),
                matchedTerms: ["llm-fallback"]
              };
            }
          }
        }
      } else {
        console.warn("[classifyIntent] LLM Fallback HTTP status error:", res.status);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        console.warn(`[classifyIntent] LLM Fallback timeout after ${INTENT_LLM_TIMEOUT_MS}ms — using rule-based result`);
      } else {
        console.warn("[classifyIntent] LLM Fallback failure, using rule-based result:", e?.message);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return ruleResult;
}
