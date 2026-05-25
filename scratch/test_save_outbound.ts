import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function run() {
  try {
    const { data, error } = await supabase.rpc("save_outbound_whatsapp", {
      p_thread_id: "00000000-0000-0000-0000-000000000000",
      p_body: "Test",
      p_metadata: { agent: "test" }
    });
    console.log("save_outbound_whatsapp response:", { data, error });
  } catch (e) {
    console.error("FATAL", e);
  }
}
run();
