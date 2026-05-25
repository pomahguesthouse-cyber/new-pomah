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

if (!url || !key) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.from('whatsapp_threads').select('phone').limit(5);
  console.log("Error:", error);
  console.log("Data:", data);
}
run();
