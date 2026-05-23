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
    .select("id, ai_lab_config")
    .limit(1)
    .single();

  if (error) {
    console.error("Error:", error);
    return;
  }

  const testConfig = {
    ...prop.ai_lab_config,
    meta_access_token: "TEST_TOKEN_XYZ"
  };

  const { data: updatedData, error: updateErr, status } = await supabase
    .from("properties")
    .update({ ai_lab_config: testConfig })
    .eq("id", prop.id)
    .select();

  console.log("Update status code:", status);
  console.log("Update error:", updateErr);
  console.log("Updated rows returned:", JSON.stringify(updatedData, null, 2));
}

main();
