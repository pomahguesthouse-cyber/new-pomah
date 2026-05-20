// Server-side Supabase clients.
//
// Two clients are exported:
//
//   supabaseAdmin  – uses SUPABASE_SERVICE_ROLE_KEY. Bypasses RLS.
//                    Use ONLY for trusted operations that genuinely
//                    need to bypass RLS (e.g. admin bootstrap, role
//                    management). Never expose to the client.
//
//   supabasePublic – uses SUPABASE_PUBLISHABLE_KEY (anon). Subject to
//                    RLS. Use for public-facing server functions and
//                    server routes that read/write data the anon role
//                    is already permitted to touch (public site data,
//                    guest booking submission, sitemap, llms.txt, …).
//
// Preferring supabasePublic keeps the app least-privilege and lets it
// run on environments where the service role key is intentionally
// not provisioned.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function createSupabaseAdminClient() {
  const SUPABASE_URL = readEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = readEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`;
    // Log but DO NOT THROW on startup, because not all environments have the service role key.
    console.warn(`[Supabase] ${message}`);
    // Return a dummy proxy that throws when actually used
    return new Proxy({} as any, {
      get(target, prop) {
        throw new Error(`Cannot use supabaseAdmin: ${message}`);
      }
    });
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createSupabasePublicClient() {
  const SUPABASE_URL = readEnv("SUPABASE_URL");
  const SUPABASE_PUBLISHABLE_KEY = readEnv("SUPABASE_PUBLISHABLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Connect Supabase in Lovable Cloud.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;
let _supabasePublic: ReturnType<typeof createSupabasePublicClient> | undefined;

// Server-side Supabase client with service role - bypasses RLS.
// SECURITY: Only use this for trusted server-side operations, never expose to client code.
// Import like: import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});

// Server-side Supabase client with the anon publishable key. Subject to RLS,
// suitable for any data the anon role is already allowed to read or write.
// Import like: import { supabasePublic } from "@/integrations/supabase/client.server";
export const supabasePublic = new Proxy({} as ReturnType<typeof createSupabasePublicClient>, {
  get(_, prop, receiver) {
    if (!_supabasePublic) _supabasePublic = createSupabasePublicClient();
    return Reflect.get(_supabasePublic, prop, receiver);
  },
});
