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
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== CHECKING AI CONFIG FROM PROPERTIES ===");
  const { data, error } = await supabase
    .from("properties")
    .select("name, ai_lab_config")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching properties:", error.message);
  } else if (!data) {
    console.log("No properties found.");
  } else {
    console.log("Property Name:", data.name);
    console.log("AI Lab Config:", JSON.stringify(data.ai_lab_config, null, 2));
    
    const autoReplyEnabled = data.ai_lab_config?.agents?.["front-office"]?.autoReply;
    console.log(`\nChatbot Auto-Reply status: ${autoReplyEnabled ? "🟢 ENABLED (AKTIF)" : "🔴 DISABLED (NON-AKTIF)"}`);
  }
}

main().catch(console.error);
