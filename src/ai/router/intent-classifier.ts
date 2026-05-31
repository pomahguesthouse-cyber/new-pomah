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
      /\b(bayar|pembayaran|transfer|rekening|bank|bca|mandiri|bni|bri|gopay|ovo|dana|qris)\b/i,
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
      /\b(cek kamar|lihat kamar|kamar untuk)\b/i,
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
 * Classify the intent of a user message.
 *
 * Returns the top-scoring IntentCategory with a normalised confidence (0–1).
 * "general" is the default when no rules match with meaningful weight.
 */
export async function classifyIntent(
  text: string,
  supabase?: SupabaseClient
): Promise<ClassifiedIntent> {
  let activeRules = RULES;

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

  if (scores.size === 0) {
    return { category: "general", confidence: 0.4, matchedTerms: [] };
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

  return {
    category:     best,
    confidence,
    matchedTerms: matched.get(best) ?? [],
  };
}
