/**
 * Remembers when /admin's beforeLoad last validated the session with the auth
 * server. Lives in its own module because routes/admin.tsx is code-split: the
 * component chunk and beforeLoad must share one mutable value, and a plain
 * top-level `let` in a split route file cannot be reassigned.
 */
let lastValidAt = 0;

export const SESSION_TRUST_MS = 3 * 60_000;
/** The layout skips its own getUser() when beforeLoad validated this recently. */
export const LAYOUT_REUSE_MS = 30_000;

export function markSessionValidated(): void {
  lastValidAt = Date.now();
}

export function resetSessionValidated(): void {
  lastValidAt = 0;
}

export function sessionValidatedWithin(ms: number): boolean {
  return lastValidAt > 0 && Date.now() - lastValidAt < ms;
}
