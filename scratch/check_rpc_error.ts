import { supabaseAdmin } from "../src/integrations/supabase/client.server";

async function main() {
  console.log("Calling RPC get_autoreply_context to debug errors...");
  
  // Get an active phone number from threads to test with
  const { data: threads, error: threadErr } = await supabaseAdmin
    .from("whatsapp_threads")
    .select("phone")
    .limit(1);
    
  if (threadErr) {
    console.error("❌ Error fetching a thread:", threadErr.message);
    return;
  }
  
  if (!threads || threads.length === 0) {
    console.log("⚠️ No whatsapp threads found in database.");
    return;
  }
  
  const testPhone = threads[0].phone;
  console.log(`Using phone: ${testPhone}`);
  
  const { data, error } = await supabaseAdmin.rpc("get_autoreply_context", {
    p_phone: testPhone
  });
  
  if (error) {
    console.error("❌ RPC get_autoreply_context failed with database error:", error.message);
    console.error(error);
  } else {
    console.log("✅ RPC get_autoreply_context succeeded!");
    console.log("Returned Data keys:", Object.keys(data || {}));
    console.log("Sample messages count:", data?.messages?.length || 0);
  }
}

main().catch(console.error);
