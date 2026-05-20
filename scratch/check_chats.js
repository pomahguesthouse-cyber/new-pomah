const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load .env manually
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    envFile.split("\n").forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
        if (key && !key.startsWith("#")) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (e) {
  console.error("Failed to load .env:", e);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase URL or Key in environment variables!");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Searching threads for Yogi or phone: 6285643043447...");

  // Query threads first
  const { data: threads, error: threadErr } = await supabase
    .from("whatsapp_threads")
    .select("*")
    .or("phone.eq.6285643043447,guest_name.ilike.%Yogi%");

  if (threadErr) {
    console.error("Error fetching threads:", threadErr);
    return;
  }

  if (!threads || threads.length === 0) {
    console.log("No threads found for phone 6285643043447 or guest_name 'Yogi'.");
    return;
  }

  console.log(`Found ${threads.length} threads:`);
  for (const thread of threads) {
    console.log(`- Thread ID: ${thread.id}, Name: ${thread.guest_name}, Phone: ${thread.phone}, AI Enabled: ${thread.ai_enabled}`);

    // Query messages for each thread
    const { data: messages, error: msgErr } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true });

    if (msgErr) {
      console.error(`Error fetching messages for thread ${thread.id}:`, msgErr);
      continue;
    }

    if (!messages || messages.length === 0) {
      console.log("  No messages in this thread.");
      continue;
    }

    console.log(`\n  --- Messages for Thread: ${thread.guest_name} ---`);
    messages.forEach((m) => {
      const sender = m.direction === "inbound" ? "GUEST" : "AI/BOT";
      console.log(`  [${m.created_at}] ${sender}: ${m.body}`);
      if (m.metadata) {
        console.log(`    Metadata: ${JSON.stringify(m.metadata)}`);
      }
    });
    console.log("  --------------------------------------\n");
  }
}

main().catch(console.error);
