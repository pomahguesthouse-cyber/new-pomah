import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { generateSessionSummary } from "../src/services/wa-autoreply.service";

config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function main() {
  console.log("=== Testing WhatsApp Session Summary ===");

  // 1. Fetch properties for LLM config
  const { data: prop, error: propErr } = await supabaseAdmin
    .from("properties")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (propErr || !prop) {
    console.error("Failed to load property settings:", propErr);
    return;
  }

  const p = prop as any;
  const explicitKey = p.ai_api_key?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const apiKey = explicitKey || lovableKey;
  
  if (!apiKey) {
    console.error("No LLM API key configured in property or env.");
    return;
  }

  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : (p.ai_base_url || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const cfgModel = p.ai_model?.trim();
  const model = useLovable
    ? cfgModel?.includes("/")
      ? cfgModel
      : "google/gemini-2.5-flash"
    : cfgModel || "gpt-4o-mini";

  console.log(`LLM Config: baseUrl=${baseUrl}, model=${model}`);

  // 2. Load latest WhatsApp thread with messages
  const { data: threads, error: threadErr } = await supabaseAdmin
    .from("whatsapp_threads")
    .select("id, display_name, phone, chat_summary")
    .order("last_message_at", { ascending: false })
    .limit(1);

  if (threadErr || !threads || threads.length === 0) {
    console.error("Failed to load threads or no threads exist:", threadErr);
    return;
  }

  const targetThread = threads[0];
  console.log(`Target Thread: Name=${targetThread.display_name}, Phone=${targetThread.phone}`);
  console.log(`Existing Summary: "${targetThread.chat_summary || '(empty)'}"`);

  // 3. Load recent messages for the thread
  const { data: messages, error: msgErr } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("direction, body, sent_at")
    .eq("thread_id", targetThread.id)
    .order("sent_at", { ascending: true })
    .limit(30);

  if (msgErr || !messages || messages.length === 0) {
    console.error("Failed to load messages or no messages found:", msgErr);
    return;
  }

  console.log(`Loaded ${messages.length} messages from the thread history.`);

  // 4. Generate summary
  console.log("\nGenerating summary using LLM...");
  const t0 = Date.now();
  const summary = await generateSessionSummary(
    messages.map(m => ({ direction: m.direction, body: m.body, sent_at: m.sent_at })),
    targetThread.chat_summary,
    { apiKey, baseUrl, model }
  );

  const duration = Date.now() - t0;
  console.log(`Summary Call completed in ${duration}ms.`);
  console.log(`\n--- GENERATED SUMMARY ---`);
  console.log(summary || "FAILED TO GENERATE");
  console.log(`-------------------------\n`);
}

main().catch(console.error);
