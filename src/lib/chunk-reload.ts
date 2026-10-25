/**
 * One reload after a deploy when the open tab still asks for old hashed chunks.
 * The sessionStorage flag blocks a second reload if the new page fails the same way.
 */

const CHUNK_RELOAD_KEY = "pomah.chunk-reload";
const RESET_AFTER_MS = 10_000;

const CHUNK_ERROR_SNIPPETS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

export function isChunkLoadError(error: unknown): boolean {
  const parts: string[] = [];
  if (typeof error === "string") parts.push(error);
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const fields = current as { message?: unknown; cause?: unknown };
    if (typeof fields.message === "string") parts.push(fields.message);
    current = fields.cause;
  }
  const message = parts.join("\n");
  return CHUNK_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
}

/** A stuck flag would block the one reload that picks up new chunks after a deploy. */
export function clearChunkReloadFlag(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

export function reloadOnceOnChunkError(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    return false;
  }
  // A dialog or form in progress would be lost. Offer the reload instead.
  if (formInProgress()) {
    void import("sonner").then(({ toast }) =>
      toast("Versi baru tersedia", {
        description: "Simpan pekerjaan Anda, lalu muat ulang.",
        duration: Infinity,
        action: { label: "Muat ulang", onClick: () => window.location.reload() },
      }),
    );
    return false;
  }
  window.location.reload();
  return true;
}

function formInProgress(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true;
  const active = document.activeElement as HTMLElement | null;
  return !!active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
}

export function installChunkReloadGuard(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceOnChunkError();
  });
  // A healthy load clears the flag so a later deploy can reload once again.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      /* ignore */
    }
  }, RESET_AFTER_MS);
}
