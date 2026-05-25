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
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

async function check() {
  console.log("Checking database connection...");
  const { data: messages, error: err1 } = await supabase
    .from("whatsapp_messages")
    .select("id, direction, body, sent_at")
    .order("sent_at", { ascending: false })
    .limit(10);

  if (err1) {
    console.error("Error reading whatsapp_messages:", err1);
  } else {
    console.log("Last 10 messages:");
    console.log(messages);
  }

  const { data: queue, error: err2 } = await supabase
    .from("wa_conversation_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);

  if (err2) {
    console.error("Error reading wa_conversation_queue:", err2);
  } else {
    console.log("Last 10 queue items:");
    console.log(queue);
  }
}

check().catch(console.error);
