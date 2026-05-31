import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

// Load .env manually to ensure service role keys are present
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
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials in .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("Supabase URL:", supabaseUrl);
  console.log("Fetching a phone number...");
  const { data: threads, error: threadErr } = await supabase
    .from("whatsapp_threads")
    .select("phone")
    .limit(1);

  if (threadErr) {
    console.error("Error fetching threads:", threadErr);
    return;
  }

  if (!threads || threads.length === 0) {
    console.log("No threads found.");
    return;
  }

  const phone = threads[0].phone;
  console.log("Testing with phone:", phone);

  const { data, error } = await supabase.rpc("get_autoreply_context", {
    p_phone: phone
  });

  if (error) {
    console.error("❌ RPC Error:", error.message);
    console.error(error);
  } else {
    console.log("✅ RPC Succeeded!");
    console.log("Returned Keys:", Object.keys(data || {}));
    console.log("Messages returned count:", data?.messages?.length);
    if (data?.messages?.length > 0) {
      console.log("Sample message:", data.messages[0]);
    }
    console.log("Summary:", data?.chat_summary);
  }
}

main().catch(console.error);
