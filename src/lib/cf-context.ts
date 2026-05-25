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
  return storage.run(ctx, fn);
}

/**
 * Returns the Worker's `waitUntil` if available, else undefined (e.g. local dev
 * / non-Cloudflare runtime). Callers should fall back to `await`-ing their work.
 */
export function getWaitUntil(): WaitUntil | undefined {
  return storage.getStore()?.waitUntil;
}
