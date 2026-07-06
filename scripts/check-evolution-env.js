import process from "node:process";

const REQUIRED = [
  "WHATSAPP_PROVIDER",
  "EVOLUTION_BASE_URL",
  "EVOLUTION_INSTANCE",
  "EVOLUTION_API_KEY",
  "EVOLUTION_WEBHOOK_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function mask(value) {
  const text = String(value ?? "");
  if (!text) return "<missing>";
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

const missing = REQUIRED.filter((key) => !String(process.env[key] ?? "").trim());
const invalid = [];
const provider = String(process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
const queueToken = process.env.QUEUE_WORKER_TOKEN || process.env.EVOLUTION_WEBHOOK_TOKEN;

if (provider !== "evolution") {
  invalid.push("WHATSAPP_PROVIDER must be 'evolution'");
}

if (missing.length > 0 || invalid.length > 0) {
  console.error("[check:evolution-env] INVALID");
  if (missing.length > 0) console.error(`Missing: ${missing.join(", ")}`);
  for (const item of invalid) console.error(item);
  process.exit(1);
}

console.log("[check:evolution-env] OK");
for (const key of REQUIRED) {
  console.log(`${key}=${mask(process.env[key])}`);
}
console.log(
  `QUEUE_WORKER_TOKEN=${
    process.env.QUEUE_WORKER_TOKEN ? mask(process.env.QUEUE_WORKER_TOKEN) : "(fallback EVOLUTION_WEBHOOK_TOKEN)"
  }`,
);
console.log(`QUEUE_TOKEN_EFFECTIVE=${mask(queueToken)}`);
