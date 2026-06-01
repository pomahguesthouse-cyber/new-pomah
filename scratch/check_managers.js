import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

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
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== CHECKING MANAGERS ===");
  const { data, error } = await supabase
    .from("property_managers")
    .select("id, name, role, telegram_chat_id, telegram_link_token, telegram_token_expires_at, telegram_linked_at, is_active");

  if (error) {
    console.error("Error fetching managers:", error.message);
  } else {
    console.log("Managers:", JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
