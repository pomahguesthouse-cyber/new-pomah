import fs from 'fs';

async function run() {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const env = {};
  for (const line of envContent.split('\n')) {
    const cleanedLine = line.replace('\r', '').trim();
    const match = cleanedLine.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      // Remove surrounding quotes if they exist
      val = val.replace(/^["']|["']$/g, '');
      env[key] = val;
    }
  }

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  
  if (!url || !key) {
    console.error("Missing keys. Found keys:", Object.keys(env));
    return;
  }

  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  console.log("=== ROOM TYPES ===");
  try {
    const res = await fetch(`${url}/rest/v1/room_types?select=*`, { headers });
    const roomTypes = await res.json();
    console.log(JSON.stringify(roomTypes, null, 2));
  } catch (e) {
    console.error("Error fetching room types:", e);
  }
}

run();
