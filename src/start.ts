import { createStart, createMiddleware } from "@tanstack/react-start";
import { removeResponseHeader, setResponseHeader } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  cdnHeaderNames,
  hasPersonalizedCookie,
  headerRecordForMode,
  isPublicCachePath,
  publicCacheMode,
  type PublicCacheMode,
} from "@/public/lib/public-cache";

function responseOf(result: unknown): { status: number; headers: Headers } | null {
  if (!result || typeof result !== "object") return null;
  const nested = "response" in result ? (result as { response?: unknown }).response : result;
  if (!nested || typeof nested !== "object") return null;
  const headers = (nested as { headers?: unknown }).headers;
  const status = (nested as { status?: unknown }).status;
  if (typeof status !== "number" || !headers || typeof (headers as Headers).get !== "function") {
    return null;
  }
  return { status, headers: headers as Headers };
}

function setCookieFrom(headers: Headers): string | null {
  const withList = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withList.getSetCookie === "function") {
    const values = withList.getSetCookie();
    if (values.length > 0) return values.join("\n");
  }
  return headers.get("set-cookie");
}

function writeCacheHeaders(response: { headers: Headers } | null, mode: PublicCacheMode) {
  const record = headerRecordForMode(mode);
  if (!record) return;
  if (mode === "private") {
    for (const name of cdnHeaderNames()) {
      removeResponseHeader(name);
      try {
        response?.headers.delete(name);
      } catch {
        /* Response headers can be frozen after the body starts. */
      }
    }
  }
  for (const [name, value] of Object.entries(record)) {
    setResponseHeader(name, value);
    try {
      response?.headers.set(name, value);
    } catch {
      /* The h3 event header still wins when the response is sealed. */
    }
  }
}

// Outermost request middleware: `next()` resolves to the finished document,
// then setResponseHeader writes the h3 event. toResponse merges those event
// headers over the SSR response, which is what the live host actually sends.
const publicCacheMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  try {
    const url = new URL(request.url);
    const response = responseOf(result);
    if (!response) {
      // Route headers may already have marked the document public. If this
      // request is signed in and we cannot see the response, force private.
      if (
        isPublicCachePath(url.pathname) &&
        (hasPersonalizedCookie(request.headers.get("cookie")) || request.headers.get("authorization"))
      ) {
        writeCacheHeaders(null, "private");
      }
    } else {
      const mode = publicCacheMode({
        method: request.method,
        pathname: url.pathname,
        search: url.search,
        status: response.status,
        contentType: response.headers.get("content-type"),
        setCookie: setCookieFrom(response.headers),
        cookie: request.headers.get("cookie"),
        authorization: request.headers.get("authorization"),
      });
      writeCacheHeaders(response, mode);
    }
  } catch (error) {
    console.error(
      "[public-cache] failed to set headers:",
      error instanceof Error ? error.message : error,
    );
  }
  return result;
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [publicCacheMiddleware, errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
