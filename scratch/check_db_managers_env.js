import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

// Read and parse .env manually
let envContent = "";
try {
  envContent = fs.readFileSync(".env", "utf8");
} catch (e) {
  console.error("Could not read .env file:", e);
}

const env = {};
envContent.split("\n").forEach((line) => {
  const parts = line.split("=");
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const value = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
});

const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment/env file.");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    storage: undefined,
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  try {
    console.log("=== PROPERTY MANAGERS ===");
    const { data: managers, error: mgrErr } = await supabaseAdmin
      .from("property_managers")
      .select("id, name, role, phone, is_active, telegram_chat_id");
    if (mgrErr) console.error(mgrErr);
    else console.log(JSON.stringify(managers, null, 2));

    console.log("\n=== LAST 5 WHATSAPP THREADS ===");
    const { data: threads, error: thErr } = await supabaseAdmin
      .from("whatsapp_threads")
      .select("id, phone, display_name, auto_reply_enabled, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(5);
    if (thErr) console.error(thErr);
    else console.log(JSON.stringify(threads, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
