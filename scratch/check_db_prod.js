import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = "https://gofvxeiulaljwyfyhnww.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnZ4ZWl1bGFsand5Znlobnd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTYxMzQsImV4cCI6MjA5NDMzMjEzNH0.hYJqRzZa5l2lW1ttLSc1VRbW-NgayPvUY-Be7QLLxtU";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDb() {
  const { data: queue, error: queueError } = await supabase
    .from('wa_conversation_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (queueError) {
    console.error("Error fetching queue:", queueError);
  } else {
    console.log("=== WA Conversation Queue (Last 10) ===");
    console.log(JSON.stringify(queue, null, 2));
  }

  const { data: messages, error: messagesError } = await supabase
    .from('wa_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (messagesError) {
    console.error("Error fetching messages:", messagesError);
  } else {
    console.log("=== WA Messages (Last 5) ===");
    console.log(JSON.stringify(messages, null, 2));
  }
}

checkDb();
