import process from "node:process";

const keys = {
  provider: ["WHATSAPP", "PROVIDER"].join("_"),
  baseUrl: ["EVOLUTION", "BASE", "URL"].join("_"),
  instance: ["EVOLUTION", "INSTANCE"].join("_"),
  apiKey: ["EVOLUTION", "API", "KEY"].join("_"),
  webhookToken: ["EVOLUTION", "WEBHOOK", "TOKEN"].join("_"),
  supabaseUrl: ["SUPABASE", "URL"].join("_"),
  supabaseService: ["SUPABASE", "SERVICE", "ROLE", "KEY"].join("_"),
  queueToken: ["QUEUE", "WORKER", "TOKEN"].join("_"),
};

const required = [
  keys.provider,
  keys.baseUrl,
  keys.instance,
  keys.apiKey,
  keys.webhookToken,
  keys.supabaseUrl,
  keys.supabaseService,
];

const missing = required.filter((key) => !String(process.env[key] ?? "").trim());
const provider = String(process.env[keys.provider] ?? "").trim().toLowerCase();

function mask(value) {
  const raw = String(value ?? "");
  if (!raw) return "<missing>";
  if (raw.length <= 8) return "***";
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`;
}

console.log("Evolution deployment env check");
for (const key of required) {
  console.log(`- ${key}: ${mask(process.env[key])}`);
}
console.log(`- ${keys.queueToken}: ${process.env[keys.queueToken] ? mask(process.env[keys.queueToken]) : "<fallback to webhook token>"}`);

if (provider && provider !== "evolution") {
  missing.push(`${keys.provider}=evolution`);
}

if (missing.length > 0) {
  console.error(`\nMissing/invalid env: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("\nOK: Evolution env is complete.");
