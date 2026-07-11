/**
 * Retrieval contoh percakapan latihan untuk diinject ke system prompt chatbot.
 * Fallback ini dipakai ketika embedding tidak tersedia atau gagal.
 */

export interface TrainingExample {
  id: string;
  stage: string | null;
  state_before: string | null;
  user_message: string;
  intent: string | null;
  slot_updates: unknown;
  ideal_assistant_response: string;
}

const STOPWORDS = new Set([
  "yang", "dan", "atau", "untuk", "dengan", "saya", "kak", "halo", "kakak",
  "di", "ke", "dari", "ini", "itu", "apa", "tolong", "sudah", "belum", "ya",
  "tidak", "lagi", "juga", "saja", "aja", "dong", "jadi", "biar", "agar",
  "sih", "deh", "nya",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

interface ScoreInput {
  userMessage: string;
  stage?: string | null;
  intent?: string | null;
}

interface Scored {
  ex: TrainingExample;
  score: number;
}

function normalized(value?: string | null): string | null {
  const cleaned = value?.trim().toLowerCase();
  return cleaned || null;
}

function scoreExample(ex: TrainingExample, input: ScoreInput): number {
  const userTokens = tokenize(input.userMessage);
  const exTokens = tokenize(ex.user_message);
  let overlap = 0;
  for (const t of exTokens) if (userTokens.has(t)) overlap += 1;
  const denom = Math.max(1, Math.min(userTokens.size || 1, exTokens.size || 1));
  let score = overlap / denom;

  const wantedIntent = normalized(input.intent);
  const exampleIntent = normalized(ex.intent);
  if (wantedIntent && exampleIntent) {
    score += wantedIntent === exampleIntent ? 0.4 : -0.12;
  }

  const wantedStage = normalized(input.stage);
  const exampleStage = normalized(ex.stage);
  if (wantedStage && exampleStage) {
    score += wantedStage === exampleStage ? 0.3 : -0.06;
  }
  return score;
}

export async function findRelevantTrainingExamples(
  supabase: { from: (t: string) => any },
  input: ScoreInput,
  limit = 3,
): Promise<TrainingExample[]> {
  try {
    const { data, error } = await supabase
      .from("chatbot_training_examples")
      .select("id, stage, state_before, user_message, intent, slot_updates, ideal_assistant_response")
      .eq("is_active", true)
      .limit(500);
    if (error || !Array.isArray(data) || data.length === 0) return [];

    return (data as TrainingExample[])
      .map((ex) => ({ ex, score: scoreExample(ex, input) }))
      .filter((s: Scored) => s.score > 0.15)
      .sort((a: Scored, b: Scored) => b.score - a.score)
      .slice(0, limit)
      .map((s: Scored) => s.ex);
  } catch {
    return [];
  }
}

/** Format contoh sebagai referensi pola, bukan sumber fakta operasional. */
export function formatTrainingExamplesBlock(examples: TrainingExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, i) => {
    const meta = [ex.intent, ex.stage].filter(Boolean).join(" / ");
    const header = meta ? `Contoh ${i + 1} (${meta})` : `Contoh ${i + 1}`;
    return `${header}\nTamu: ${ex.user_message.trim()}\nPola balasan yang disarankan: ${ex.ideal_assistant_response.trim()}`;
  });
  return [
    "REFERENSI POLA BALASAN:",
    "Gunakan contoh hanya sebagai referensi gaya dan alur ketika konteks benar-benar mirip.",
    "HIERARKI WAJIB: hasil tool dan hard guard > state booking > SOP/data properti terbaru > konteks percakapan > contoh training.",
    "Jangan mengambil harga, stok, kapasitas, fasilitas, nomor rekening, jarak tempuh, atau fakta dinamis dari contoh. Jika contoh bertentangan dengan sumber yang lebih tinggi, abaikan contoh.",
    ...lines,
    "Sesuaikan dengan data tamu saat ini dan jangan menyalin huruf demi huruf.",
  ].join("\n\n");
}
