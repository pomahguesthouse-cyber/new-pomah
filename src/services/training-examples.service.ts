/**
 * Retrieval contoh percakapan latihan (training examples) untuk diinject
 * ke system prompt chatbot. Skor sederhana berbasis overlap kata + bobot
 * intent/stage agar tidak memerlukan embedding.
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
  "di", "ke", "dari", "ini", "itu", "ada", "apa", "bisa", "tolong", "mau",
  "sudah", "belum", "ya", "tidak", "lagi", "juga", "saja", "aja", "dong",
  "kalau", "kalo", "jadi", "biar", "agar", "sih", "deh", "nya",
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

function scoreExample(ex: TrainingExample, input: ScoreInput): number {
  const userTokens = tokenize(input.userMessage);
  if (userTokens.size === 0) return 0;
  const exTokens = tokenize(ex.user_message);
  let overlap = 0;
  for (const t of exTokens) if (userTokens.has(t)) overlap += 1;
  const denom = Math.max(1, Math.min(userTokens.size, exTokens.size));
  let score = overlap / denom; // 0..1

  if (input.intent && ex.intent && ex.intent.toLowerCase() === input.intent.toLowerCase()) {
    score += 0.4;
  }
  if (input.stage && ex.stage && ex.stage.toLowerCase() === input.stage.toLowerCase()) {
    score += 0.3;
  }
  return score;
}

/**
 * Ambil top-N contoh paling relevan untuk pesan tamu saat ini.
 * Mengembalikan array kosong bila tidak ada contoh aktif atau koneksi gagal.
 */
export async function findRelevantTrainingExamples(
  supabase: { from: (t: string) => any },
  input: ScoreInput,
  limit = 3,
): Promise<TrainingExample[]> {
  try {
    const { data, error } = await supabase
      .from("chatbot_training_examples")
      .select(
        "id, stage, state_before, user_message, intent, slot_updates, ideal_assistant_response",
      )
      .eq("is_active", true)
      .limit(500);
    if (error || !Array.isArray(data) || data.length === 0) return [];

    const scored: Scored[] = (data as TrainingExample[])
      .map((ex) => ({ ex, score: scoreExample(ex, input) }))
      .filter((s) => s.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((s) => s.ex);
  } catch {
    return [];
  }
}

/** Format contoh sebagai blok teks "CONTOH PERCAKAPAN BENAR" untuk system prompt. */
export function formatTrainingExamplesBlock(examples: TrainingExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, i) => {
    const meta = [ex.intent, ex.stage].filter(Boolean).join(" / ");
    const header = meta ? `Contoh ${i + 1} (${meta})` : `Contoh ${i + 1}`;
    return `${header}\nTamu: ${ex.user_message.trim()}\nJawaban ideal: ${ex.ideal_assistant_response.trim()}`;
  });
  return [
    "CONTOH PERCAKAPAN BENAR (WAJIB diikuti gaya & isinya bila konteks mirip):",
    ...lines,
    "Jangan menyalin huruf demi huruf — sesuaikan dengan data tamu saat ini, tetapi pertahankan struktur, nada, dan informasi kuncinya.",
  ].join("\n\n");
}
