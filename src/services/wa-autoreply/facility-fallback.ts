/**
 * Fallback jawaban fasilitas bila knowledge base (room_facility_knowledge)
 * kosong / tidak cocok: cari di sumber lama yang sudah terverifikasi —
 * SOP chunks (termasuk Q&A "Pertanyaan : … Jawab : …") dan contoh pelatihan
 * aktif (mis. tr-wifi-password-20261018). Hanya kutip jawaban yang ADA di
 * sumber; tidak ada yang cocok → null (lalu handoff, tetap tidak menebak).
 *
 * Regresi #107/#108 (20 Okt): KB baru setengah terisi sehingga pertanyaan
 * fasilitas umum langsung "kami teruskan ke admin" + jeda 6 jam.
 */
import { detectFacilityTopic, type FacilityTopic } from "@/services/room-facility-kb";

export interface SopChunkSource {
  id: string;
  content: string;
  docName?: string | null;
}
export interface TrainingSource {
  id: string;
  user_message: string | null;
  ideal_assistant_response: string | null;
}
export interface FacilitySourceAnswer {
  reply: string;
  source: string;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Bersihkan persona lama & sisa pertanyaan penjualan dari jawaban sumber. */
export function cleanSourceAnswer(s: string): string {
  let out = squash(s)
    .replace(/\b(nanti\s+)?Rani\s+(jelaskan|bantu|cek|konfirmasi)/gi, (_m, _n, v) => `kami ${v.toLowerCase()}`)
    .replace(/\bRani\b/g, "kami");
  // Buang kalimat tanya lanjutan yang tidak diminta ("Kakak tertarik tipe kamar yang mana? …")
  out = out
    .split(/(?<=[.!?])\s+/)
    .filter((sent) => !/\?$/.test(sent.trim()))
    .join(" ")
    .trim();
  return out;
}

/** Pasangan Q&A dari dokumen format "Pertanyaan : … Jawab : …". */
export function parseQaPairs(content: string): Array<{ q: string; a: string }> {
  const pairs: Array<{ q: string; a: string }> = [];
  const re = /Pertanyaan\s*:\s*([\s\S]*?)\s*Jawab\s*:\s*([\s\S]*?)(?=\s*Pertanyaan\s*:|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) pairs.push({ q: squash(m[1]), a: squash(m[2]) });
  return pairs;
}

/** Ekstraksi fakta langsung dari teks SOP untuk topik yang jelas formatnya. */
function extractFromSopText(topic: FacilityTopic, content: string): string | null {
  const t = squash(content);
  if (topic === "wifi_password") {
    const m = t.match(/password\s+wi-?fi[^:]{0,40}:\s*([A-Za-z0-9_.@#-]{4,40})/i);
    if (m) return `Password WiFi: *${m[1]}* (huruf kecil semua, tanpa spasi), Kak.`;
  }
  if (topic === "towels") {
    const m = t.match(/handuk(?:\s+mandi)?\s+(\d+)\s*(?:buah|pcs|lembar)/i);
    if (m) return `Setiap kamar disediakan ${m[1]} handuk mandi, Kak. Kalau perlu tambahan handuk, kabari kami ya.`;
  }
  if (topic === "wifi_location") {
    // Hanya bila sumber menyebut letak tulisan password secara eksplisit.
    const m = t.match(/password\s+wi-?fi[^.]{0,60}\b(ditempel|tertempel|tertulis|dicetak)\s+(di\s+[^.]{3,80})/i);
    if (m) return `Tulisan password WiFi ada ${m[2].trim()}, Kak.`;
  }
  return null;
}

export function findFacilityAnswerInSources(
  topic: FacilityTopic,
  sources: { sop?: SopChunkSource[]; training?: TrainingSource[] },
): FacilitySourceAnswer | null {
  // 1) Contoh pelatihan aktif yang pertanyaannya bertopik sama.
  for (const tr of sources.training ?? []) {
    const q = tr.user_message ?? "";
    const a = tr.ideal_assistant_response ?? "";
    if (!q || !a) continue;
    if (detectFacilityTopic(q) !== topic) continue;
    const reply = cleanSourceAnswer(a);
    if (reply) return { reply, source: `training:${tr.id}` };
  }
  for (const c of sources.sop ?? []) {
    // 2) Q&A SOP dengan pertanyaan bertopik sama.
    for (const { q, a } of parseQaPairs(c.content ?? "")) {
      if (detectFacilityTopic(q) !== topic) continue;
      const reply = cleanSourceAnswer(a);
      if (reply) return { reply, source: `sop:${c.id}` };
    }
    // 3) Fakta eksplisit di teks SOP.
    const direct = extractFromSopText(topic, c.content ?? "");
    if (direct) return { reply: direct, source: `sop:${c.id}` };
  }
  return null;
}

const TOPIC_KEYWORDS: Record<FacilityTopic, string> = {
  wifi_password: "wifi",
  wifi_location: "wifi",
  kitchen: "dapur",
  cooking_tools: "dapur",
  towels: "handuk",
  hairdryer: "dryer",
  checkin_point: "check",
};

type Db = { from: (t: string) => any };

/** Muat kandidat sumber (ringan, difilter kata kunci topik). */
export async function loadFacilitySources(
  db: Db,
  topic: FacilityTopic,
): Promise<{ sop: SopChunkSource[]; training: TrainingSource[] }> {
  const kw = TOPIC_KEYWORDS[topic];
  const [sopRes, trRes] = await Promise.all([
    db.from("sop_chunks").select("id, content").ilike("content", `%${kw}%`).limit(30),
    db
      .from("chatbot_training_examples")
      .select("id, user_message, ideal_assistant_response")
      .eq("is_active", true)
      .ilike("user_message", `%${kw}%`)
      .limit(30),
  ]);
  return {
    sop: (Array.isArray(sopRes?.data) ? sopRes.data : []) as SopChunkSource[],
    training: (Array.isArray(trRes?.data) ? trRes.data : []) as TrainingSource[],
  };
}

/** Jeda bot saat handoff fasilitas: calon tamu tidak dijeda; tamu ber-booking 30 menit. */
export const FACILITY_HANDOFF_PAUSE_BOOKED_MS = 30 * 60 * 1000;
export function facilityHandoffPauseMs(hasActiveBooking: boolean): number {
  return hasActiveBooking ? FACILITY_HANDOFF_PAUSE_BOOKED_MS : 0;
}
