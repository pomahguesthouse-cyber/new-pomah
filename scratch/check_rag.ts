import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log("Fetching simulator training logs...");
  const { data: logs, error } = await supabase
    .from("ai_conversation_logs")
    .select("id, title, user_message, ai_response, correction, rating, used, source, embedding, created_at")
    .eq("source", "simulator")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching logs:", error);
    return;
  }

  console.log(`Found ${logs?.length ?? 0} simulator logs:\n`);
  for (const log of logs ?? []) {
    console.log(`ID: ${log.id}`);
    console.log(`Title: "${log.title}"`);
    console.log(`User message: "${log.user_message}"`);
    console.log(`Rating: ${log.rating}, Used: ${log.used}`);
    console.log(`Embedding populated: ${log.embedding ? "YES (length: " + log.embedding.length + ")" : "NO"}`);
    console.log(`Created At: ${log.created_at}`);
    console.log("-".repeat(50));
  }
}

run();
