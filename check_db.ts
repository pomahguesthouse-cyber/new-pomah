import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log("=== THREADS ===");
  const { data: threads } = await supabase.from("whatsapp_threads").select("*").order("last_message_at", { ascending: false }).limit(2);
  console.log(JSON.stringify(threads, null, 2));

  console.log("\n=== MESSAGES ===");
  const { data: messages } = await supabase.from("whatsapp_messages").select("*").order("created_at", { ascending: false }).limit(5);
  console.log(JSON.stringify(messages, null, 2));

  console.log("\n=== PROPERTIES ===");
  const { data: props } = await supabase.from("properties").select("ai_lab_config, meta_access_token, meta_phone_number_id").limit(1);
  console.log(JSON.stringify(props, null, 2));
}
main();
