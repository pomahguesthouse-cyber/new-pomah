/**
 * Carries the Cloudflare Worker ExecutionContext into route handlers.
 *
 * TanStack route handlers only receive `({ request })`, but the Worker's
 * `ctx.waitUntil` (available in server.ts `fetch(request, env, ctx)`) is needed
 * to keep background work alive after the response is returned. We stash it in
 * an AsyncLocalStorage so any handler running within the same request can reach
 * it via `getWaitUntil()`.
 *
 * Do not copy `waitUntil` onto `globalThis`. A previous request's callback stays
 * there after that request has finished, and handing new work to it drops the
 * promise in production (inbound media and chat summaries never finished).
 */

import type { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;

interface CfRequestContext {
  waitUntil?: WaitUntil;
}

// Import dinamis: `node:async_hooks` tidak boleh di-import statis karena modul
// ini ikut ter-bundle ke browser (dynamic import di-externalize Vite, bukan error build).
let storage: AsyncLocalStorage<CfRequestContext> | undefined;
try {
  const { AsyncLocalStorage: ALS } = (await import("node:async_hooks")) as {
    AsyncLocalStorage: typeof AsyncLocalStorage;
  };
  storage = new ALS<CfRequestContext>();
} catch {
  // Browser bundle / runtime tanpa async_hooks: getWaitUntil() tetap aman (undefined).
}

/** Run `fn` with the given Worker context bound for the duration of the request. */
export function runWithCfContext<T>(ctx: CfRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Returns the Worker's `waitUntil` for the current request, else undefined
 * (local dev, or a continuation that lost the request context).
 */
export function getWaitUntil(): WaitUntil | undefined {
  return storage.getStore()?.waitUntil;
}

/**
 * Run `task` after the response when the current request has `waitUntil`.
 * Otherwise the promise is returned so a caller can await it, and a warning is
 * logged — a `void` call will not keep the work alive.
 */
export function runDeferred(label: string, task: () => Promise<unknown>): void | Promise<void> {
  const wu = getWaitUntil();
  const safe = task().catch((err) => console.error(`[${label}] deferred task failed:`, err));
  if (wu) {
    wu(safe);
    return;
  }
  console.warn(`[${label}] deferred work has no waitUntil; it will not be kept alive after the response`);
  return safe.then(() => undefined);
}
