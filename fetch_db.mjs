import fs from 'fs';

async function main() {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const env = {};
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }

  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log("No url/key"); return; }
  
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };
  
  console.log("=== PROPERTIES ===");
  let res = await fetch(`${url}/rest/v1/properties?select=ai_lab_config,meta_access_token,meta_phone_number_id&limit=1`, { headers });
  console.log(await res.json());

  console.log("\n=== LAST 5 MESSAGES ===");
  res = await fetch(`${url}/rest/v1/whatsapp_messages?select=id,direction,body,created_at&order=created_at.desc&limit=5`, { headers });
  console.log(await res.json());
}
main();
