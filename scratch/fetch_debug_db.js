import fs from 'fs';

async function main() {
  const envContent = fs.readFileSync(".env", "utf8");
  const env = {};
  envContent.split("\n").forEach((line) => {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, '');
      env[key] = value;
    }
  });

  const token = env.FONNTE_WEBHOOK_TOKEN;
  const url = `https://new-pomah.lovable.app/api/debug-db?token=${token}`;
  console.log(`Calling endpoint: ${url}`);
  try {
    const res = await fetch(url);
    console.log(`Status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json();
      console.log("=== DIAGNOSTIC REPORT ===");
      console.log(JSON.stringify(data, null, 2));
    } else {
      const text = await res.text();
      console.log(text.slice(0, 500));
    }
  } catch (err) {
    console.error(`Fetch failed for ${url}:`, err.message);
  }
}

main().catch(console.error);
