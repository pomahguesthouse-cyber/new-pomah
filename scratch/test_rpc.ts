import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://gofvxeiulaljwyfyhnww.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnZ4ZWl1bGFsand5Znlobnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTYxMzQsImV4cCI6MjA5NDMzMjEzNH0.hYJqRzZa5l2lW1ttLSc1VRbW-NgayPvUY-Be7QLLxtU"
);

async function run() {
  try {
    const { data, error } = await supabase.rpc("save_outbound_whatsapp", {
      p_thread_id: "00000000-0000-0000-0000-000000000000",
      p_body: "Test",
      p_metadata: { agent: "test" }
    });
    console.log("With 3 args:", { data, error });

    const { data: data2, error: error2 } = await supabase.rpc("save_outbound_whatsapp", {
      p_thread_id: "00000000-0000-0000-0000-000000000000",
      p_body: "Test"
    });
    console.log("With 2 args:", { data2, error2 });
    
    const { data: data3, error: error3 } = await supabase
      .from("whatsapp_threads")
      .select("id, phone, whatsapp_messages(direction, body, sent_at)")
      .order("last_message_at", { ascending: false })
      .limit(3);
      
    console.log("Threads:", JSON.stringify({ data: data3, error: error3 }, null, 2));
  } catch (e) {
    console.error("FATAL", e);
  }
}
run().then(() => console.log("Done")).catch(console.error);
