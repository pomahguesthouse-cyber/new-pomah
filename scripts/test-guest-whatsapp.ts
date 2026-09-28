/**
 * Guest WhatsApp routing: Meta for new numbers, Evolution only as fallback,
 * invoice template retry on a closed 24h window. Does not send WhatsApp.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildMetaTemplatePayload,
  sanitizeTemplateParam,
  toMetaRecipient,
} from "../src/services/whatsapp-meta.service";
import {
  INVOICE_TEMPLATE_MISSING_ERROR,
  evolutionFallbackReady,
  isMetaReengagementError,
  sendGuestWhatsApp,
  type GuestWhatsAppDeps,
} from "../src/services/guest-whatsapp.service";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = (async () => {
  fetchCalls += 1;
  throw new Error("test must not perform a real WhatsApp or HTTP send");
}) as typeof fetch;

const savedEnv = {
  WHATSAPP_INVOICE_TEMPLATE_NAME: process.env.WHATSAPP_INVOICE_TEMPLATE_NAME,
  WHATSAPP_INVOICE_TEMPLATE_LANG: process.env.WHATSAPP_INVOICE_TEMPLATE_LANG,
  EVOLUTION_BASE_URL: process.env.EVOLUTION_BASE_URL,
  EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE,
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const phones: Array<[string, string]> = [
  ["0812-3456-7890", "6281234567890"],
  ["81234567890", "6281234567890"],
  ["+62 812 3456 7890", "6281234567890"],
  ["6281234567890", "6281234567890"],
];
for (const [input, expected] of phones) {
  assert.equal(toMetaRecipient(input), expected, `toMetaRecipient(${input})`);
}

assert.equal(isMetaReengagementError({ raw: { error: { code: 131047 } } }), true);
assert.equal(isMetaReengagementError({ raw: { error: { code: "131026" } } }), true);
assert.equal(isMetaReengagementError({ raw: { error: { error_subcode: 470 } } }), true);
assert.equal(isMetaReengagementError({ error: 'HTTP 400: {"error":{"code":131047}}' }), true);
assert.equal(isMetaReengagementError({ raw: { error: { code: 100, message: "Invalid" } } }), false);
assert.equal(isMetaReengagementError({ error: "HTTP 500: gateway down" }), false);

const payload = buildMetaTemplatePayload("6281234567890", "invoice_pemesanan", "id", [
  "Sari\nPutri",
  "PG-NPWPX",
  "Rp 1.500.000",
  "https://pomahguesthouse.com/book/confirmation/PG-NPWPX",
]);
assert.equal(payload.type, "template");
const template = payload.template as {
  name: string;
  language: { code: string };
  components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
};
assert.equal(template.name, "invoice_pemesanan");
assert.equal(template.language.code, "id");
assert.equal(template.components[0]?.type, "body");
assert.deepEqual(
  template.components[0]?.parameters.map((param) => param.text),
  [
    "Sari Putri",
    "PG-NPWPX",
    "Rp 1.500.000",
    "https://pomahguesthouse.com/book/confirmation/PG-NPWPX",
  ],
);
assert.equal(sanitizeTemplateParam("   "), "-");

interface HarnessOptions {
  meta?: boolean;
  evolution?: boolean;
  metaResult?: { ok: boolean; error: string | null; raw?: unknown; status?: number };
  templateResult?: { ok: boolean; error: string | null };
}

function harness(options: HarnessOptions) {
  const calls: string[] = [];
  const deps: GuestWhatsAppDeps = {
    isMetaConfigured: () => options.meta === true,
    toRecipient: toMetaRecipient,
    sendMeta: async (phone) => {
      calls.push(`meta:${phone}`);
      return options.metaResult ?? { ok: true, error: null, messageId: "wamid.text" };
    },
    sendTemplate: async (phone, name, lang, params) => {
      calls.push(`template:${name}:${lang}:${params.join("|")}:${phone}`);
      return options.templateResult ?? { ok: true, error: null, messageId: "wamid.template" };
    },
    evolutionReady: () => options.evolution === true,
    sendEvolution: async (token, phone) => {
      calls.push(`evolution:${token}:${phone}`);
      return { ok: true, error: null };
    },
    isReengagement: isMetaReengagementError,
    templateName: () => (process.env.WHATSAPP_INVOICE_TEMPLATE_NAME ?? "").trim(),
    templateLang: () => (process.env.WHATSAPP_INVOICE_TEMPLATE_LANG ?? "").trim() || "id",
  };
  return { calls, deps };
}

const invoiceTemplate = {
  guestName: "Sari",
  bookingCode: "PG-NPWPX",
  total: "Rp 1.500.000",
  invoiceUrl: "https://pomahguesthouse.com/book/confirmation/PG-NPWPX",
};
const closed = {
  ok: false,
  error: "HTTP 400: re-engagement",
  raw: { error: { code: 131047 } },
  status: 400,
};

delete process.env.WHATSAPP_INVOICE_TEMPLATE_NAME;
delete process.env.WHATSAPP_INVOICE_TEMPLATE_LANG;

{
  const { calls, deps } = harness({ meta: true });
  const result = await sendGuestWhatsApp(
    "081234567890",
    "Halo",
    { evolutionToken: "evo-token" },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.channel, "meta");
  assert.deepEqual(calls, ["meta:6281234567890"]);
}

{
  process.env.WHATSAPP_INVOICE_TEMPLATE_NAME = "invoice_pemesanan";
  process.env.WHATSAPP_INVOICE_TEMPLATE_LANG = "id";
  const { calls, deps } = harness({ meta: true, evolution: true, metaResult: closed });
  const result = await sendGuestWhatsApp(
    "+6281234567890",
    "Invoice",
    { evolutionToken: "evo-token", invoiceTemplate },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.channel, "meta");
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "meta:6281234567890");
  assert.equal(
    calls[1],
    "template:invoice_pemesanan:id:Sari|PG-NPWPX|Rp 1.500.000|https://pomahguesthouse.com/book/confirmation/PG-NPWPX:6281234567890",
  );
  assert.equal(
    calls.some((call) => call.startsWith("evolution:")),
    false,
  );
}

{
  delete process.env.WHATSAPP_INVOICE_TEMPLATE_NAME;
  const { calls, deps } = harness({ meta: true, evolution: true, metaResult: closed });
  const result = await sendGuestWhatsApp("6281234567890", "Invoice", { invoiceTemplate }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, INVOICE_TEMPLATE_MISSING_ERROR);
  assert.equal(result.channel, "meta");
  assert.deepEqual(calls, ["meta:6281234567890"]);
}

{
  process.env.WHATSAPP_INVOICE_TEMPLATE_NAME = "invoice_pemesanan";
  const { calls, deps } = harness({ meta: true, metaResult: closed });
  const result = await sendGuestWhatsApp("6281234567890", "pengingat", undefined, deps);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /24 jam/);
  assert.equal(
    calls.some((call) => call.startsWith("template:")),
    false,
  );
}

{
  const { calls, deps } = harness({
    meta: true,
    evolution: true,
    metaResult: { ok: false, error: "HTTP 500: gateway down", raw: { error: { code: 1 } } },
  });
  const result = await sendGuestWhatsApp("6281234567890", "Invoice", { invoiceTemplate }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, "HTTP 500: gateway down");
  assert.deepEqual(calls, ["meta:6281234567890"]);
}

{
  delete process.env.WHATSAPP_INVOICE_TEMPLATE_NAME;
  const { calls, deps } = harness({ meta: false, evolution: true });
  const result = await sendGuestWhatsApp(
    "081234567890",
    "Halo",
    { evolutionToken: "prop-token" },
    deps,
  );
  assert.equal(result.ok, true);
  assert.equal(result.channel, "evolution");
  assert.deepEqual(calls, ["evolution:prop-token:6281234567890"]);
}

{
  const { calls, deps } = harness({ meta: false, evolution: false });
  const result = await sendGuestWhatsApp("081234567890", "Halo", { evolutionToken: null }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.channel, "none");
  assert.match(result.error ?? "", /Meta tidak aktif/);
  assert.deepEqual(calls, []);
}

{
  delete process.env.EVOLUTION_BASE_URL;
  delete process.env.EVOLUTION_INSTANCE;
  delete process.env.EVOLUTION_API_KEY;
  assert.equal(evolutionFallbackReady("token-saja"), false);
  process.env.EVOLUTION_BASE_URL = "https://example.invalid";
  process.env.EVOLUTION_INSTANCE = "pomah";
  assert.equal(evolutionFallbackReady(null), false);
  assert.equal(evolutionFallbackReady("prop-token"), true);
  process.env.EVOLUTION_API_KEY = "env-key";
  assert.equal(evolutionFallbackReady(null), true);
}

const invoiceSrc = fs.readFileSync(
  new URL("../src/services/invoice-notification.service.ts", import.meta.url),
  "utf8",
);
assert.match(invoiceSrc, /sendGuestWhatsApp/);
assert.doesNotMatch(invoiceSrc, /sendWhatsAppMessage/);
assert.match(invoiceSrc, /provider: "meta"/);
assert.doesNotMatch(invoiceSrc, /if \(!wpp_token\)/);
assert.doesNotMatch(invoiceSrc, /if \(!wppToken\)/);

const dialogSrc = fs.readFileSync(
  new URL("../src/admin/components/invoice-dialog.tsx", import.meta.url),
  "utf8",
);
assert.match(dialogSrc, /toast\.warning/);
assert.doesNotMatch(dialogSrc, /WhatsApp tidak dikonfigurasi/);
assert.match(dialogSrc, /max-\[360px\]:w-full/);
assert.match(dialogSrc, /overflow-x-hidden/);

for (const rel of [
  "../src/admin/functions/contacts.functions.ts",
  "../src/admin/functions/booking-form-logs.functions.ts",
  "../src/routes/api.cron.booking-form-followup.ts",
]) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.match(src, /sendGuestWhatsApp/, rel);
}

assert.equal(fetchCalls, 0, "unit test performed an HTTP call");
restoreEnv();
globalThis.fetch = originalFetch;

console.log("guest whatsapp routing tests passed");
