import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
});

const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(url, key);

async function check() {
  console.log("Querying room_types (public)...");
  const { data: rooms, error: err1 } = await supabase.from("room_types").select("id, name");
  console.log("room_types error:", err1);
  console.log("room_types count:", rooms?.length);

  console.log("\nQuerying properties...");
  const { data: props, error: err2 } = await supabase.from("properties").select("id, name");
  console.log("properties error:", err2);
  console.log("properties data:", props);
}

check().catch(console.error);
