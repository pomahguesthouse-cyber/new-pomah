import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: props, error: e1 } = await supabase.from("properties").select("ai_lab_config").limit(1);
  console.log("Properties:", JSON.stringify(props, null, 2), e1?.message);

  const { data: threads, error: e2 } = await supabase.from("whatsapp_threads").select("phone, display_name, ai_auto").order("last_message_at", { ascending: false }).limit(2);
  console.log("Recent Threads:", threads, e2?.message);

  const { data: messages, error: e3 } = await supabase.from("whatsapp_messages").select("direction, body, created_at").order("created_at", { ascending: false }).limit(3);
  console.log("Recent Messages:", messages, e3?.message);
}
main();
