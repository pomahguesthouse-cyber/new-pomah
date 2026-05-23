import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const INTEGRATION_FIELDS = [
  "id",
  "meta_access_token",
  "meta_phone_number_id",
  "meta_verify_token",
  "google_place_id",
  "google_places_api_key",
  "google_analytics_id",
  "google_tag_manager_id",
  "google_search_console",
  "ai_api_key",
  "ai_base_url",
  "ai_model",
  "payment_bank_name",
  "payment_account_number",
  "payment_account_holder",
  "hotel_policy",
];

async function main() {
  console.log("Testing individual fields on properties table...");
  for (const field of INTEGRATION_FIELDS) {
    const { data, error } = await supabase.from("properties").select(field).limit(1);
    if (error) {
      console.log(`❌ Field "${field}": FAILED - ${error.message}`);
    } else {
      console.log(`✅ Field "${field}": SUCCESS`);
    }
  }

  console.log("\nTesting combined query...");
  const { data, error } = await supabase.from("properties").select(INTEGRATION_FIELDS.join(", ")).limit(1);
  if (error) {
    console.error("❌ Combined query failed:", error.message);
  } else {
    console.log("✅ Combined query succeeded:", data);
  }
}

main();
