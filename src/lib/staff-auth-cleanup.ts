import { supabase } from "@/integrations/supabase/client";
import {
  clearAdminAssignFlag,
  clearAuthNext,
  clearStaffSessionHint,
  resetFullPageRedirectGuard,
} from "@/lib/auth-return";
import {
  authErrorText,
  authStorageKeysToRemove,
  currentSupabaseAuthStorageKey,
  isForeignProjectAccessToken,
  isInvalidSessionError,
  isTransientAuthError,
} from "@/lib/auth-storage";
import { clearChunkReloadFlag } from "@/lib/chunk-reload";

export type SessionCheckStatus = "valid" | "anonymous" | "stale" | "unavailable";

const CLEAR_DEBOUNCE_MS = 5000;
let lastClearAt = 0;
let sessionCheck: Promise<unknown> = Promise.resolve();

function supabaseUrl(): string {
  const fromVite = import.meta.env.VITE_SUPABASE_URL;
  if (typeof fromVite === "string" && fromVite) return fromVite;
  if (typeof process !== "undefined" && process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  return "";
}

function browserStorageKeys(): string[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

function removeStorageKeys(keys: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }
}

/** Drop sb-* keys that belong to another project, leaving the current session. */
export function sweepForeignAuthKeys(): void {
  const currentKey = currentSupabaseAuthStorageKey(supabaseUrl());
  const remove = authStorageKeysToRemove(browserStorageKeys(), {
    currentKey,
    dropCurrent: false,
  });
  if (!remove.length) return;
  removeStorageKeys(remove);
  console.info("[auth] removed other-project auth keys:", remove.join(", "));
}

/**
 * Local sign-out plus the leftovers that keep a normal browser tab stuck:
 * sb-* / supabase auth keys, the pomah_staff cookie, and the saved next path.
 */
export async function clearStaleStaffAuth(reason: string): Promise<void> {
  const now = Date.now();
  if (now - lastClearAt < CLEAR_DEBOUNCE_MS) {
    console.info("[auth] stale cleanup already ran:", reason);
    return;
  }
  lastClearAt = now;
  console.info("[auth] clearing stale staff session:", reason);

  const currentKey = currentSupabaseAuthStorageKey(supabaseUrl());
  const remove = authStorageKeysToRemove(browserStorageKeys(), {
    currentKey,
    dropCurrent: true,
  });
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    console.info("[auth] local sign-out failed:", authErrorText(error));
  }
  removeStorageKeys(remove);
  clearStaffSessionHint();
  clearAuthNext();
  clearAdminAssignFlag();
  clearChunkReloadFlag();
  resetFullPageRedirectGuard();
}

function enqueueSessionCheck<T>(task: () => Promise<T>): Promise<T> {
  const run = sessionCheck.then(task, task);
  sessionCheck = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * A stored session is signed-in only when the auth server still accepts it.
 * Invalid refresh tokens and tokens for another project are wiped so /login
 * shows a clean form instead of bouncing to /admin.
 * Checks run one at a time so a slow stale read cannot sign out a newer login.
 */
export function checkSession(reason: string): Promise<SessionCheckStatus> {
  return enqueueSessionCheck(async () => {
    if (typeof window === "undefined") return "unavailable";
    sweepForeignAuthKeys();
    try {
      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error && isTransientAuthError(sessionResult.error)) return "unavailable";
      const session = sessionResult.data.session;
      if (!session) {
        // A stored session that failed to refresh comes back as "no session" plus
        // an auth error. Anonymous visits have no error. Clear the leftovers either way
        // when the client is reporting a rejected session.
        if (sessionResult.error && !isTransientAuthError(sessionResult.error)) {
          await clearStaleStaffAuth(`${reason}: ${authErrorText(sessionResult.error)}`);
          return "stale";
        }
        return "anonymous";
      }
      if (isForeignProjectAccessToken(session.access_token, supabaseUrl())) {
        await clearStaleStaffAuth(`${reason}: token is for a different project`);
        return "stale";
      }
      const userResult = await supabase.auth.getUser();
      if (userResult.data.user && !isInvalidSessionError(userResult.error)) return "valid";
      if (isTransientAuthError(userResult.error)) return "unavailable";
      const detail = authErrorText(userResult.error);
      await clearStaleStaffAuth(
        `${reason}: ${detail === "auth error" ? "stored session rejected" : detail}`,
      );
      return "stale";
    } catch (error) {
      if (isTransientAuthError(error)) return "unavailable";
      if (isInvalidSessionError(error)) {
        await clearStaleStaffAuth(`${reason}: ${authErrorText(error)}`);
        return "stale";
      }
      console.info("[auth] session check failed:", reason, error);
      return "unavailable";
    }
  });
}
