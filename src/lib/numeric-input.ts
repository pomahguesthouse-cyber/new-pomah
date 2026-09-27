/**
 * Commit rules for numeric text fields.
 *
 * Controlled `<input type="number" value={n} onChange={e => setN(Number(e.target.value) || 0)}>`
 * turns an empty string into 0 immediately, so backspace cannot clear the field.
 * Callers keep a string draft while the input is focused and use these helpers
 * to turn that draft into the number that business logic already expected.
 */

export type NumericCommitOptions = {
  /** Allow a single decimal point. Default false (integers only). */
  allowDecimal?: boolean;
  /**
   * Number stored when the draft is empty, incomplete, or not finite.
   * Also replaces a typed 0 when this is not 0, matching `Number(x) || fallback`.
   * Default 0.
   */
  emptyValue?: number;
  min?: number;
  max?: number;
  /**
   * "edit" — while typing, do not clamp up to `min` when the digits are still
   * a short prefix (so "1" can become "15" when min is 10).
   * "commit" — blur/submit, always clamp to min and max.
   */
  phase?: "edit" | "commit";
};

export function allowNegativeNumeric(min: number | undefined): boolean {
  return min == null || min < 0;
}

export function isAllowedNumericDraft(
  raw: string,
  opts: { allowDecimal?: boolean; allowNegative?: boolean } = {},
): boolean {
  if (raw === "") return true;
  const allowDecimal = opts.allowDecimal ?? false;
  const allowNegative = opts.allowNegative ?? false;
  if (allowDecimal) {
    return (allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/).test(raw);
  }
  return (allowNegative ? /^-?\d*$/ : /^\d*$/).test(raw);
}

export function isCompleteNumericDraft(raw: string, allowDecimal = false): boolean {
  const trimmed = raw.trim();
  if (allowDecimal) return /^-?\d+(\.\d+)?$/.test(trimmed);
  return /^-?\d+$/.test(trimmed);
}

function isIncomplete(raw: string, allowDecimal: boolean): boolean {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "+" || trimmed === "." || trimmed === "-." || trimmed === "+.") {
    return true;
  }
  if (allowDecimal && trimmed.endsWith(".")) return true;
  return false;
}

/** True when `raw` is a shorter prefix of a number that could still reach `min`. */
function isShortMinPrefix(raw: string, min: number): boolean {
  const digits = raw.replace(/^-/, "").split(".")[0]?.replace(/^0+/, "") ?? "";
  const minDigits = String(Math.trunc(Math.abs(min))).length;
  return digits.length > 0 && digits.length < minDigits;
}

export function commitNumericValue(raw: string, options: NumericCommitOptions = {}): number {
  const allowDecimal = options.allowDecimal ?? false;
  const emptyValue = options.emptyValue ?? 0;
  const phase = options.phase ?? "commit";
  const trimmed = raw.trim();

  let n = emptyValue;
  if (!isIncomplete(trimmed, allowDecimal)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      n = allowDecimal ? parsed : Math.trunc(parsed);
      if (n === 0 && emptyValue !== 0) n = emptyValue;
    }
  }

  if (options.max != null && n > options.max) n = options.max;

  const deferMin =
    phase === "edit" &&
    options.min != null &&
    n < options.min &&
    trimmed !== "" &&
    trimmed !== "0" &&
    trimmed !== "-0" &&
    isShortMinPrefix(trimmed, options.min);

  if (!deferMin && options.min != null && n < options.min) n = options.min;
  return n;
}

/**
 * Draft to show after a change. Over-max values snap to the cap.
 * An empty draft stays empty so the fallback number is not forced back in.
 */
export function numericDraftAfterChange(
  raw: string,
  committed: number,
  options: NumericCommitOptions = {},
): string {
  const allowDecimal = options.allowDecimal ?? false;
  if (!isCompleteNumericDraft(raw, allowDecimal)) return raw;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return raw;
  if (options.max != null && parsed > options.max) return String(committed);
  return raw;
}
