import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

function loadEnv() {
  const env = {};
  const text = fs.readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase URL/key");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function compact(row) {
  if (!row) return row;
  return JSON.parse(JSON.stringify(row));
}

function print(title, value) {
  console.log(`\n=== ${title} ===`);
  console.dir(compact(value), { depth: null, colors: false, maxArrayLength: 100 });
}

async function selectOrPrint(label, builder) {
  const { data, error } = await builder;
  if (error) {
    print(`${label} ERROR`, error);
    return null;
  }
  print(label, data);
  return data;
}

const threads = await selectOrPrint(
  "Latest whatsapp_threads",
  supabase
    .from("whatsapp_threads")
    .select("*")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(5),
);

const latestThread = Array.isArray(threads) ? threads[0] : null;
if (latestThread?.id) {
  await selectOrPrint(
    "Messages in latest thread",
    supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("thread_id", latestThread.id)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("sent_at", { ascending: true, nullsFirst: true })
      .limit(50),
  );

  await selectOrPrint(
    "Queue for latest thread",
    supabase
      .from("wa_conversation_queue")
      .select("*")
      .eq("thread_id", latestThread.id)
      .order("created_at", { ascending: false })
      .limit(20),
  );
}

await selectOrPrint(
  "Recent queue all",
  supabase
    .from("wa_conversation_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20),
);

await selectOrPrint(
  "Recent AI conversation logs",
  supabase
    .from("ai_conversation_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10),
);
