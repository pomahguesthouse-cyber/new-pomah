import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("whatsapp_threads")
    .select("id, phone, whatsapp_messages(direction, body, sent_at)")
    .order("last_message_at", { ascending: false })
    .limit(3);
    
  if (error) console.error(error);
  else console.log(JSON.stringify(data, null, 2));
}
run();
