import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf-8');
let supabaseUrl = '';
let supabaseKey = '';

for (const line of envContent.split('\n')) {
  const parts = line.split('=');
  if (parts[0] && parts[1]) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim().replace(/['"]/g, '');
    if (key === 'SUPABASE_URL' || key === 'VITE_SUPABASE_URL') {
      supabaseUrl = val;
    }
    if (key === 'SUPABASE_PUBLISHABLE_KEY' || key === 'VITE_SUPABASE_PUBLISHABLE_KEY') {
      supabaseKey = val;
    }
  }
}

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing keys");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log("Checking supabaseUrl:", supabaseUrl);
  const { data, error } = await supabase
    .from('ai_intent_rules')
    .select('*')
    .limit(5);

  if (error) {
    console.error("Table ai_intent_rules error:", error.message);
  } else {
    console.log("Table ai_intent_rules exists! Data count:", data.length);
    console.log("Sample data:", data);
  }
}

check();
