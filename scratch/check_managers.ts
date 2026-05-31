import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  console.log("=== PROPERTY MANAGERS ===");
  const { data, error } = await supabase
    .from("property_managers")
    .select("id, name, role, telegram_chat_id, telegram_link_token, telegram_token_expires_at, telegram_linked_at, is_active");
  
  if (error) {
    console.error("Error fetching managers:", error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
