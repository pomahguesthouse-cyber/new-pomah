import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await supabase.from("properties").select("meta_access_token").limit(1);
  if (error) {
    console.error("DB Error:", error.message);
  } else {
    console.log("DB Success, data:", data);
  }
}
main();
