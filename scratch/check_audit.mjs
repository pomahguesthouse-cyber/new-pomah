import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const envMap = Object.fromEntries(
  env.split("\n")
    .filter(line => line.trim() && !line.startsWith("#"))
    .map(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      return match ? [match[1].trim(), match[2].trim()] : [];
    })
    .filter(pair => pair.length > 0)
);

const supabaseUrl = envMap.SUPABASE_URL;
const supabaseKey = envMap.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from("ai_retry_audit")
    .select("reason, model, latency_ms, attempt, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
    
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}

check();
