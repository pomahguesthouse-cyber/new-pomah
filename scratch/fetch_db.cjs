const fs = require('fs');

async function main() {
  console.log("Starting...");
  const envContent = fs.readFileSync('.env', 'utf-8');
  const env = {};
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/\r/g, "");
    }
  }

  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("No url/key"); return; }
  
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
  
  console.log("=== PROPERTY MANAGERS ===");
  let res = await fetch(`${url}/rest/v1/property_managers?select=id,name,role,phone,is_active`, { headers });
  console.log(await res.json());

  console.log("\n=== LAST 3 WHATSAPP THREADS ===");
  res = await fetch(`${url}/rest/v1/whatsapp_threads?select=id,phone,status,auto_reply_enabled,last_message_at&order=last_message_at.desc&limit=3`, { headers });
  console.log(await res.json());
}
main().catch(console.error);
