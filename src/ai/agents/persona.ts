export function normalizeAssistantName(name: string | null | undefined, fallback = "Rani"): string {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  if (/^(pak\s+)?faizal$/i.test(trimmed)) return "Rani";
  return trimmed.replace(/\bPak\s+Faizal\b/gi, "Rani").replace(/\bFaizal\b/g, "Rani");
}
