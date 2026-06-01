import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

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

const supabaseUrl = env.SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("=== TG WEBHOOK DIAGNOSTICS ===");
  const { data, error } = await supabase
    .from("properties")
    .select("name, telegram_bot_token, telegram_bot_username, telegram_webhook_secret")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error fetching properties:", error.message);
    return;
  }
  if (!data) {
    console.log("No properties record found in DB.");
    return;
  }

  const token = data.telegram_bot_token;
  console.log("Property name:", data.name);
  console.log("Bot username in DB:", data.telegram_bot_username);
  console.log("Has secret in DB:", !!data.telegram_webhook_secret);

  if (!token) {
    console.error("No telegram_bot_token found in DB.");
    return;
  }

  console.log("Bot token (first 10 chars):", token.slice(0, 10) + "...");

  try {
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meJson = await meRes.json();
    console.log("getMe response:", JSON.stringify(meJson, null, 2));

    const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const whJson = await whRes.json();
    console.log("getWebhookInfo response:", JSON.stringify(whJson, null, 2));
  } catch (e) {
    console.error("Error calling Telegram API:", e);
  }
}

main().catch(console.error);
