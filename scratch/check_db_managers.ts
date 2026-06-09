import { supabaseAdmin } from '../src/integrations/supabase/client.server';

async function main() {
  try {
    console.log("=== PROPERTY MANAGERS ===");
    const { data: managers, error: mgrErr } = await (supabaseAdmin as any)
      .from("property_managers")
      .select("id, name, role, phone, is_active");
    if (mgrErr) console.error(mgrErr);
    else console.log(JSON.stringify(managers, null, 2));

    console.log("\n=== LAST 3 WHATSAPP THREADS ===");
    const { data: threads, error: thErr } = await (supabaseAdmin as any)
      .from("whatsapp_threads")
      .select("id, phone, status, auto_reply_enabled, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(3);
    if (thErr) console.error(thErr);
    else console.log(JSON.stringify(threads, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }
}

main();
