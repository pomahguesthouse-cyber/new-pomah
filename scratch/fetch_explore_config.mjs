import { createClient } from "@supabase/supabase-js";
import fs from "fs";

async function main() {
  const envContent = fs.readFileSync(".env", "utf-8");
  const env = {};
  for (const line of envContent.split(/\r?\n/)) {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith("#")) continue;
    const idx = cleanLine.indexOf("=");
    if (idx !== -1) {
      const key = cleanLine.substring(0, idx).trim();
      let val = cleanLine.substring(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      env[key] = val;
    }
  }

  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  
  if (!url || !key) {
    console.log("No Supabase credentials found. env keys: ", Object.keys(env));
    return;
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase.from("properties").select("id, name, explore_config").limit(1).maybeSingle();
  
  if (error) {
    console.error("Error fetching properties:", error);
    return;
  }
  
  console.log("=== PROPERTIES IN DB ===");
  console.log(JSON.stringify(data, null, 2));
}

main();
