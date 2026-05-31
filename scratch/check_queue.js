import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

// Load .env manually
const envContent = fs.readFileSync(".env", "utf8");
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
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("=== CHECKING QUEUE STATUS ===");
  const { data: queueItems, error: qErr } = await supabase
    .from("wa_conversation_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (qErr) {
    console.error("Error reading queue:", qErr.message);
  } else {
    console.log(`Found ${queueItems.length} recent queue items:`);
    queueItems.forEach((item) => {
      console.log(`- ID: ${item.id.slice(0, 8)} | Phone: ${item.phone} | Status: ${item.status} | Attempt: ${item.attempt} | Process After: ${item.process_after} | Lock Expires: ${item.lock_expires_at} | Last Error: ${item.last_error}`);
    });
  }

  console.log("\n=== LAST 5 MESSAGES ===");
  const { data: lastMsgs, error: mErr } = await supabase
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .order("sent_at", { ascending: false })
    .limit(5);

  if (mErr) {
    console.error("Error reading messages:", mErr.message);
  } else {
    lastMsgs.forEach((msg) => {
      console.log(`[${msg.sent_at}] ${msg.direction === "in" ? "GUEST" : "BOT"}: ${msg.body.slice(0, 80)}`);
    });
  }
}

main().catch(console.error);
