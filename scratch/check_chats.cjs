const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load .env manually
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    envFile.split("\n").forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
        if (key && !key.startsWith("#")) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (e) {
  console.error("Failed to load .env:", e);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase URL or Key in environment variables!");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Fetching all sop_documents...");
  const { data: docs, error: err } = await supabase
    .from("sop_documents")
    .select("id, name, content");

  if (err) {
    console.error("Error fetching sop_documents:", err);
    return;
  }

  console.log(`Found ${docs.length} documents:`);
  docs.forEach((d) => {
    console.log(`- ID: ${d.id}`);
    console.log(`  Name: ${d.name}`);
    console.log(`  Content Length: ${d.content ? d.content.length : 0}`);
    if (d.content) {
      console.log(`  Preview: ${d.content.slice(0, 300)}...`);
    }
  });
}

main().catch(console.error);
