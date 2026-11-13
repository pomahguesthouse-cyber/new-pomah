/**
 * Tes webhook Moota: signature valid/invalid, replay, debit diabaikan,
 * mode flag, dan penolakan IP opsional. Tidak memanggil jaringan/DB sungguhan.
 */
import assert from "node:assert/strict";
import { mootaSignature, verifyMootaSignature, parseMootaMutationList, isMootaIpAllowed, resolvePaymentMatchMode, mutationCoversAmount, extractBookingCodeFromText, isAllowedMootaAccount } from "../src/lib/moota";
import { handleMootaWebhookRequest } from "../src/services/moota-webhook";
import { OFFICIAL_TRANSFER_ACCOUNT } from "../src/lib/payment-account";

const SECRET = "test-webhook-secret";

function sample(over: Record<string, unknown> = {}) {
  return {
    account_number: OFFICIAL_TRANSFER_ACCOUNT.accountNumber,
    date: "2026-11-13 08:00:00",
    description: "TRSF E-BANKING CR 13/11 124123 BUDI",
    amount: 830000,
    type: "CR",
    balance: 1000000,
    mutation_id: "mutA0000001",
    bank_id: "bankBca1",
    ...over,
  };
}

function signed(body: string, secret = SECRET) {
  return mootaSignature(body, secret);
}

async function main() {
  const body = JSON.stringify([sample()]);
  const sig = signed(body);
  assert.equal(verifyMootaSignature(body, SECRET, sig), true, "signature valid");
  assert.equal(verifyMootaSignature(body, SECRET, sig.toUpperCase()), true, "hex case-insensitive");
  assert.equal(verifyMootaSignature(body, SECRET, "deadbeef"), false, "signature salah");
  assert.equal(verifyMootaSignature(body, SECRET, null), false, "tanpa header");
  assert.equal(verifyMootaSignature(body + " ", SECRET, sig), false, "body diubah");
  assert.equal(verifyMootaSignature(body, "other-secret", sig), false, "secret lain");

  const parsed = parseMootaMutationList(JSON.parse(body));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.mutations[0].mutation_id, "mutA0000001");
    assert.equal(parsed.mutations[0].type, "CR");
    assert.equal(parsed.mutations[0].amount, 830000);
  }
  const wrapped = parseMootaMutationList({ data: [sample({ amount: "415000.00", type: "credit" })] });
  assert.equal(wrapped.ok, true);
  if (wrapped.ok) {
    assert.equal(wrapped.mutations[0].amount, 415000);
    assert.equal(wrapped.mutations[0].type, "CR");
  }
  assert.equal(parseMootaMutationList({ hello: true }).ok, false);

  assert.equal(mutationCoversAmount(830000, 830000), true);
  assert.equal(mutationCoversAmount(836500, 830000), true);
  assert.equal(mutationCoversAmount(836501, 830000), false);
  assert.equal(mutationCoversAmount(829000, 830000), false);
  assert.equal(extractBookingCodeFromText("TRSF PG-AUTO1 BUDI"), "PG-AUTO1");
  assert.equal(isAllowedMootaAccount(OFFICIAL_TRANSFER_ACCOUNT.accountNumber, {}), true);
  assert.equal(isAllowedMootaAccount("1234567890", {}), false);

  assert.equal(resolvePaymentMatchMode({}), "proof_only");
  assert.equal(resolvePaymentMatchMode({ MOOTA_WEBHOOK_SECRET: "x" }), "require_mutation");
  assert.equal(resolvePaymentMatchMode({ MOOTA_API_TOKEN: "t" }), "require_mutation");
  assert.equal(resolvePaymentMatchMode({ MOOTA_WEBHOOK_SECRET: "x", PAYMENT_MATCH_MODE: "proof_only" }), "proof_only");
  assert.equal(resolvePaymentMatchMode({ PAYMENT_MATCH_MODE: "require_mutation" }), "require_mutation");

  assert.equal(isMootaIpAllowed("1.2.3.4", {}), true, "default tidak menolak IP");
  assert.equal(isMootaIpAllowed("103.236.201.178", { MOOTA_ENFORCE_IP: "true" }), true);
  assert.equal(isMootaIpAllowed("1.2.3.4", { MOOTA_ENFORCE_IP: "true" }), false);

  const rejected = await handleMootaWebhookRequest({
    rawBody: body,
    signature: "nope",
    ip: "1.2.3.4",
    supabase: {},
    env: { MOOTA_WEBHOOK_SECRET: SECRET },
    matchNow: false,
  });
  assert.equal(rejected.httpStatus, 401);
  assert.equal((rejected.body as any).reason, "invalid_signature");

  const unconfigured = await handleMootaWebhookRequest({
    rawBody: body,
    signature: sig,
    ip: null,
    supabase: {},
    env: {},
  });
  assert.equal(unconfigured.httpStatus, 503);

  const stored: string[] = [];
  const db = {
    from: (name: string) => {
      const q: any = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({
        data: stored.includes("mutA0000001") && name === "bank_mutations"
          ? { mutation_id: "mutA0000001", match_status: "unmatched", type: "CR", amount: 830000, account_number: OFFICIAL_TRANSFER_ACCOUNT.accountNumber }
          : null,
        error: null,
      });
      q.insert = async (row: any) => {
        if (stored.includes(row.mutation_id)) return { error: { code: "23505", message: "duplicate" } };
        stored.push(row.mutation_id);
        return { error: null };
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };

  const env = { MOOTA_WEBHOOK_SECRET: SECRET, PAYMENT_MATCH_MODE: "proof_only" };
  const first = await handleMootaWebhookRequest({
    rawBody: body,
    signature: sig,
    ip: null,
    supabase: db,
    env,
    matchNow: false,
  });
  assert.equal(first.httpStatus, 200, JSON.stringify(first.body));
  assert.equal(first.body.stored, 1);

  const replay = await handleMootaWebhookRequest({
    rawBody: body,
    signature: sig,
    ip: null,
    supabase: db,
    env,
    matchNow: false,
  });
  assert.equal(replay.httpStatus, 200);
  assert.equal(replay.body.stored, 0, "replay tidak insert ulang");
  assert.equal(stored.length, 1);

  const debitBody = JSON.stringify([sample({ mutation_id: "mutDebit001", type: "DB" })]);
  const debit = await handleMootaWebhookRequest({
    rawBody: debitBody,
    signature: signed(debitBody),
    ip: null,
    supabase: {
      from: () => {
        const q: any = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = async () => ({ data: null, error: null });
        q.insert = async (row: any) => {
          assert.equal(row.match_status, "ignored_debit");
          stored.push(row.mutation_id);
          return { error: null };
        };
        return q;
      },
    },
    env,
    matchNow: false,
  });
  assert.equal(debit.httpStatus, 200);
  assert.ok(stored.includes("mutDebit001"));

  console.log("test-moota-webhook: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
