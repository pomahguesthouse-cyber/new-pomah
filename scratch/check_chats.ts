import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

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

  console.log("Listing recent threads...");

  const { data: threads, error: threadErr } = await supabase
    .from("whatsapp_threads")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(20);

  if (threadErr) {
    console.error("Error fetching threads:", threadErr);
    return;
  }

  if (!threads || threads.length === 0) {
    console.log("No threads found in whatsapp_threads table.");
    return;
  }

  console.log(`Found ${threads.length} threads:`);
  threads.forEach((t) => {
    console.log(`- ID: ${t.id}, Phone: ${t.phone}, Name: ${t.guest_name}, Updated: ${t.updated_at}`);
  });
}

main().catch(console.error);
