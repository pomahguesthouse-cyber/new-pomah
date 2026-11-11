/**
 * Regresi halaman admin "Daftar Manager" (Settings → Manager).
 *
 * Bug 12 Nov 2026: klik "Tambah" menampilkan toast JSON Zod mentah
 * `[{"origin":"string","code":"invalid_format","format":"uuid",...}]`.
 * Akar masalah: `z.string().uuid()` (Zod v4) menolak id properti Pomah
 * `00000000-0000-0000-0000-000000000001` karena bukan UUID versi RFC.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { identityCandidates, normalizePhone } from "../src/services/wa-autoreply/identity";
import {
  findDuplicateManager,
  formatManagerPhone,
  friendlyManagerError,
  insertPropertyManager,
  normalizeManagerPhone,
  rowIdSchema,
  validateAddManagerInput,
  validateManagerName,
  validateManagerPhone,
} from "../src/admin/modules/settings/property-managers.shared";

const POMAH_PROPERTY_ID = "00000000-0000-0000-0000-000000000001";
let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

await test("reproduksi: z.string().uuid() menolak id properti Pomah (akar bug)", () => {
  const r = z
    .object({ property_id: z.string().uuid() })
    .safeParse({ property_id: POMAH_PROPERTY_ID });
  assert.equal(r.success, false);
  assert.equal(r.success ? "" : r.error.issues[0].code, "invalid_format");
});

await test("rowIdSchema menerima id properti Pomah dan uuid acak, menolak non-uuid", () => {
  assert.equal(rowIdSchema.safeParse(POMAH_PROPERTY_ID).success, true);
  assert.equal(rowIdSchema.safeParse("3f0c1b8e-5c55-4d1f-9a43-2b7f0c9d1e22").success, true);
  assert.equal(rowIdSchema.safeParse("").success, false);
  assert.equal(rowIdSchema.safeParse("abc").success, false);
});

await test("settings.functions.ts tidak lagi memakai z.string().uuid()", () => {
  const src = readFileSync("src/admin/modules/settings/settings.functions.ts", "utf8");
  assert.equal(/z\.string\(\)\.uuid\(\)/.test(src), false);
  // Tidak boleh mengimpor modul server (supabaseAdmin) ke file yang ikut bundle klien.
  assert.equal(/wa-autoreply\/identity/.test(src), false);
});

await test("normalisasi nomor konsisten dengan pencocokan WA inbound", () => {
  const inputs = [
    "0812-3456-7890",
    "+62 812 3456 7890",
    "62 812 3456 7890",
    "081234567890",
    "812 3456 7890",
    "620812 3456 7890",
  ];
  for (const raw of inputs) {
    const n = normalizeManagerPhone(raw);
    assert.equal(n, "6281234567890", raw);
    assert.equal(n, normalizePhone(raw));
    // Nomor WA dari Meta (62…) harus cocok dengan nomor tersimpan.
    assert.ok(identityCandidates("6281234567890").includes(n));
  }
});

await test("validasi nomor: pesan Indonesia, tolak format salah", () => {
  assert.equal(validateManagerPhone("0812 3456 7890"), null);
  assert.equal(validateManagerPhone("+6281234567890"), null);
  assert.match(validateManagerPhone("") ?? "", /wajib/);
  assert.match(validateManagerPhone("0812abc") ?? "", /angka/);
  assert.match(validateManagerPhone("123") ?? "", /Indonesia/);
  assert.match(validateManagerPhone("0812") ?? "", /Panjang/);
  assert.match(validateManagerPhone("+1 415 555 0100") ?? "", /Indonesia/);
  assert.match(validateManagerPhone("021 1234 5678") ?? "", /HP WhatsApp/);
});

await test("validasi nama wajib", () => {
  assert.match(validateManagerName("") ?? "", /wajib/);
  assert.match(validateManagerName("   ") ?? "", /wajib/);
  assert.equal(validateManagerName("Bu Titik"), null);
});

await test("validateAddManagerInput merapikan nama & menormalisasi nomor", () => {
  const ok = validateAddManagerInput({
    phone: "+62 812-254-6070",
    name: "  Pomah   Admin ",
    role: "super_admin",
  });
  assert.equal(ok.ok, true);
  if (ok.ok)
    assert.deepEqual(ok.value, { phone: "628122546070", name: "Pomah Admin", role: "super_admin" });
  const bad = validateAddManagerInput({ phone: "", name: "", role: "owner" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.phone && bad.errors.name && bad.errors.role);
    assert.match(bad.message, /Nomor WhatsApp wajib/);
  }
});

await test("deteksi duplikat lintas format (data lama 08… vs input +62…)", () => {
  const existing = [
    { id: "a", name: "Bu Titik", phone: "628122546070" },
    { id: "b", name: "Pak Faizal", phone: "082226749990" },
  ];
  assert.equal(findDuplicateManager(existing, "+62 822-2674-9990")?.name, "Pak Faizal");
  assert.equal(findDuplicateManager(existing, "0812 254 6070")?.name, "Bu Titik");
  assert.equal(findDuplicateManager(existing, "0812 254 6070", "a"), null);
  assert.equal(findDuplicateManager(existing, "0811 1111 2222"), null);
});

await test("format tampilan nomor", () => {
  assert.equal(formatManagerPhone("628122546070"), "+62 812-254-6070");
  assert.equal(formatManagerPhone("082226749990"), "+62 822-2674-9990");
  assert.equal(formatManagerPhone("6281234567890"), "+62 812-3456-7890");
});

await test("error ramah: JSON Zod mentah dari screenshot tidak pernah ditampilkan", () => {
  const raw =
    '[{"origin":"string","code":"invalid_format","format":"uuid","pattern":"/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/","path":["property_id"],"message":"Invalid UUID"}]';
  const msg = friendlyManagerError(new Error(raw));
  assert.equal(/[[\]{}]/.test(msg), false, msg);
  assert.match(msg, /kendala/);
  assert.match(
    friendlyManagerError({ issues: [{ path: ["phone"], message: "x" }] }),
    /Nomor WhatsApp/,
  );
  assert.match(
    friendlyManagerError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    /sudah terdaftar/,
  );
  assert.match(
    friendlyManagerError({ code: "42501", message: "new row violates row-level security policy" }),
    /izin/,
  );
  assert.match(friendlyManagerError(new Error("Failed to fetch")), /Koneksi/);
  assert.match(
    friendlyManagerError(new Error('null value in column "name" violates not-null constraint')),
    /kendala/,
  );
  assert.equal(friendlyManagerError(new Error("Nama wajib diisi.")), "Nama wajib diisi.");
});

/* ---------------- add flow dengan client Supabase palsu ---------------- */

type Row = Record<string, any>;
function fakeClient(
  state: { properties: Row[]; property_managers: Row[] },
  opts: { insertError?: unknown } = {},
) {
  const calls: string[] = [];
  const client = {
    from(table: "properties" | "property_managers") {
      let filters: Array<[string, unknown]> = [];
      let pendingInsert: Row[] | null = null;
      const rows = () => state[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      const b: any = {
        select: () => b,
        limit: () => b,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return b;
        },
        insert: (vals: Row[]) => {
          calls.push(`insert:${table}`);
          pendingInsert = vals;
          return b;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => {
          if (pendingInsert) {
            if (opts.insertError) return { data: null, error: opts.insertError };
            const row = { id: `id-${state[table].length + 1}`, ...pendingInsert[0] };
            state[table].push(row);
            return { data: row, error: null };
          }
          return { data: rows()[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return b;
    },
  };
  return { client, calls };
}

await test("add flow: berhasil dengan id properti Pomah, nomor tersimpan 62…", async () => {
  const state = {
    properties: [{ id: POMAH_PROPERTY_ID }],
    property_managers: [
      { id: "a", property_id: POMAH_PROPERTY_ID, name: "Bu Titik", phone: "628122546070" },
    ],
  };
  const { client } = fakeClient(state);
  const row = await insertPropertyManager(client, {
    phone: "0813-1111-2222",
    name: "Pomah Admin",
    role: "super_admin",
  });
  assert.equal(row.phone, "6281311112222");
  assert.equal(state.property_managers.at(-1)?.property_id, POMAH_PROPERTY_ID);
  assert.equal(state.property_managers.at(-1)?.is_active, true);
});

await test("add flow: duplikat ditolak sebelum insert dengan pesan ramah", async () => {
  const state = {
    properties: [{ id: POMAH_PROPERTY_ID }],
    property_managers: [
      { id: "b", property_id: POMAH_PROPERTY_ID, name: "Pak Faizal", phone: "082226749990" },
    ],
  };
  const { client, calls } = fakeClient(state);
  await assert.rejects(
    insertPropertyManager(client, {
      phone: "+62 822 2674 9990",
      name: "Faizal",
      role: "super_admin",
    }),
    /sudah terdaftar atas nama Pak Faizal/,
  );
  assert.equal(calls.includes("insert:property_managers"), false);
});

await test("add flow: error constraint DB diterjemahkan, nama kosong ditolak", async () => {
  const state = { properties: [{ id: POMAH_PROPERTY_ID }], property_managers: [] };
  const { client } = fakeClient(state, {
    insertError: { code: "23505", message: "duplicate key" },
  });
  await assert.rejects(
    insertPropertyManager(client, { phone: "081311112222", name: "X Y", role: "viewer" }),
    /sudah terdaftar sebagai manager/,
  );
  await assert.rejects(
    insertPropertyManager(fakeClient(state).client, {
      phone: "081311112222",
      name: " ",
      role: "viewer",
    }),
    /Nama wajib/,
  );
});

await test("add flow: tanpa baris properti → pesan jelas", async () => {
  const { client } = fakeClient({ properties: [], property_managers: [] });
  await assert.rejects(
    insertPropertyManager(client, { phone: "081311112222", name: "Ana", role: "viewer" }),
    /Data properti belum ada/,
  );
});

console.log(`\nproperty-managers admin: ${passed} tes lulus`);
