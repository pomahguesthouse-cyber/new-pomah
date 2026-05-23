import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Parse .env manually
const envPath = path.resolve(".env");
const envContent = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || "";
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
}

const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data: prop, error } = await supabase
    .from("properties")
    .select("explore_config")
    .limit(1)
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  const explore_config = prop.explore_config || {};
  console.log("explore_config keys:", Object.keys(explore_config));
  console.log("gemini_api_key length:", explore_config.gemini_api_key ? explore_config.gemini_api_key.length : "Not set");
  if (explore_config.gemini_api_key) {
    console.log("gemini_api_key starts with:", explore_config.gemini_api_key.substring(0, 7) + "...");
  }
}

main();
