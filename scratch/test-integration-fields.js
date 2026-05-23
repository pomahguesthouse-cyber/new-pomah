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
  console.log("Calling RPC get_autoreply_context...");
  const { data, error } = await supabase.rpc("get_autoreply_context", { p_phone: "628123456789" });
  if (error) {
    console.error("❌ RPC get_autoreply_context failed:", error.message);
  } else {
    console.log("✅ RPC get_autoreply_context returned:", data);
  }
}

main();
