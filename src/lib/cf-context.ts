/**
 * Carries the Cloudflare Worker ExecutionContext into route handlers.
 *
 * TanStack route handlers only receive `({ request })`, but the Worker's
 * `ctx.waitUntil` (available in server.ts `fetch(request, env, ctx)`) is needed
 * to keep background work alive after the response is returned. We stash it in
 * an AsyncLocalStorage so any handler running within the same request can reach
 * it via `getWaitUntil()`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type WaitUntil = (promise: Promise<unknown>) => void;

interface CfRequestContext {
  waitUntil?: WaitUntil;
}

const storage = new AsyncLocalStorage<CfRequestContext>();

/** Run `fn` with the given Worker context bound for the duration of the request. */
export function runWithCfContext<T>(ctx: CfRequestContext, fn: () => T): T {
  if (ctx.waitUntil) {
    (globalThis as any).__cfWaitUntil = ctx.waitUntil;
  }
  return storage.run(ctx, fn);
}

/**
 * Returns the Worker's `waitUntil` if available, else undefined (e.g. local dev
 * / non-Cloudflare runtime). Callers should fall back to `await`-ing their work.
 */
export function getWaitUntil(): WaitUntil | undefined {
  return storage.getStore()?.waitUntil || (globalThis as any).__cfWaitUntil;
}

/**
 * Run `task` in the background. On Cloudflare Workers, hands it to
 * `waitUntil` so the runtime keeps the request alive until it settles;
 * elsewhere falls back to awaiting it. Either way, errors are logged and
 * swallowed so callers stay non-blocking.
 */
export function runDeferred(label: string, task: () => Promise<unknown>): void | Promise<void> {
  const safe = task().catch((err) => console.error(`[${label}] deferred task failed:`, err));
  const wu = getWaitUntil();
  if (wu) {
    wu(safe);
    return;
  }
  // Local dev / non-CF: await so the process doesn't exit early.
  return safe.then(() => undefined);
}
