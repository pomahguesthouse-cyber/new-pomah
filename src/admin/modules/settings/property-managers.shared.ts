/**
 * Logika murni untuk halaman "Daftar Manager" (Settings → Manager).
 * Dipakai bersama oleh UI (validasi sebelum kirim) dan server function
 * (validasi otoritatif) supaya aturannya selalu sama.
 *
 * Tidak boleh mengimpor modul server (supabaseAdmin dsb.).
 */
import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

export const MANAGER_ROLES = ["super_admin", "booking_manager", "viewer"] as const;
export type ManagerRoleValue = (typeof MANAGER_ROLES)[number];

export const MANAGER_ROLE_INFO: Record<
  ManagerRoleValue,
  { label: string; short: string; description: string; dot: string; badge: string }
> = {
  super_admin: {
    label: "Super Admin",
    short: "Akses penuh",
    description: "Semua fitur, termasuk ubah harga dan hapus booking permanen.",
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-700 ring-red-200",
  },
  booking_manager: {
    label: "Booking Manager",
    short: "Kelola booking",
    description: "Lihat & buat booking, tandai pembayaran, check-in/out. Tanpa ubah harga.",
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
  },
  viewer: {
    label: "Viewer",
    short: "Hanya lihat",
    description: "Hanya membaca data (ketersediaan, daftar booking).",
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
  },
};

export function isManagerRoleValue(v: unknown): v is ManagerRoleValue {
  return typeof v === "string" && (MANAGER_ROLES as readonly string[]).includes(v);
}

/**
 * ID baris Supabase. Pakai `z.guid()` (format 8-4-4-4-12 heksadesimal) —
 * BUKAN `z.string().uuid()`: di Zod v4 `.uuid()` menolak UUID yang tidak
 * sesuai versi RFC 4122, termasuk id properti Pomah
 * `00000000-0000-0000-0000-000000000001`.
 */
export const rowIdSchema = z.guid({
  message: "ID data tidak valid. Muat ulang halaman lalu coba lagi.",
});

/** Normalisasi nomor manager — identik dengan pencocokan WA inbound (identity.ts). */
export function normalizeManagerPhone(raw: string): string {
  return normalizePhone(raw);
}

/**
 * Validasi nomor WhatsApp manager. Mengembalikan pesan error Indonesia,
 * atau null bila valid.
 */
export function validateManagerPhone(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "Nomor WhatsApp wajib diisi.";
  if (/[^\d\s+().-]/.test(trimmed)) {
    return "Nomor hanya boleh berisi angka, spasi, tanda + atau strip (-).";
  }
  const normalized = normalizeManagerPhone(trimmed);
  if (!normalized.startsWith("62")) {
    return "Gunakan nomor Indonesia, diawali 08, 62, atau +62.";
  }
  // 62 + 8–13 digit nomor (mis. 62 812 3456 7890 = 13 digit total).
  if (normalized.length < 10 || normalized.length > 15) {
    return "Panjang nomor tidak sesuai. Contoh yang benar: 0812 3456 7890.";
  }
  if (normalized[2] !== "8") {
    return "Gunakan nomor HP WhatsApp (diawali 08… atau +62 8…).";
  }
  return null;
}

export function validateManagerName(raw: string): string | null {
  const name = String(raw ?? "").trim();
  if (!name) return "Nama wajib diisi.";
  if (name.length < 2) return "Nama terlalu pendek (minimal 2 huruf).";
  if (name.length > 100) return "Nama terlalu panjang (maksimal 100 karakter).";
  return null;
}

/** Tampilkan nomor 62… sebagai "+62 812-3456-7890". */
export function formatManagerPhone(raw: string): string {
  const n = normalizeManagerPhone(raw);
  if (!n.startsWith("62") || n.length < 10 || n.length > 15) return String(raw ?? "");
  const local = n.slice(2);
  // 9–10 digit lokal: 812-254-6070; 11+ digit: 812-3456-7890.
  const mid = local.length <= 10 ? 6 : 7;
  const groups = [local.slice(0, 3), local.slice(3, mid), local.slice(mid)].filter(Boolean);
  return `+62 ${groups.join("-")}`;
}

export type ManagerLike = { id: string; name: string; phone: string };

/** Cari manager lain dengan nomor yang sama setelah dinormalisasi. */
export function findDuplicateManager<T extends ManagerLike>(
  existing: readonly T[],
  phone: string,
  ignoreId?: string,
): T | null {
  const target = normalizeManagerPhone(phone);
  if (!target) return null;
  return (
    existing.find((m) => m.id !== ignoreId && normalizeManagerPhone(m.phone) === target) ?? null
  );
}

export function duplicateManagerMessage(m: { name: string; phone: string }): string {
  return `Nomor ${formatManagerPhone(m.phone)} sudah terdaftar atas nama ${m.name}.`;
}

export type AddManagerInput = {
  name: string;
  phone: string;
  role: ManagerRoleValue;
};

export type AddManagerValidation =
  | { ok: true; value: AddManagerInput }
  | { ok: false; errors: Partial<Record<"name" | "phone" | "role", string>>; message: string };

/** Validasi input form tambah manager (dipakai UI dan server). */
export function validateAddManagerInput(input: unknown): AddManagerValidation {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name : "";
  const phone = typeof raw.phone === "string" ? raw.phone : "";
  const role = raw.role;
  const errors: Partial<Record<"name" | "phone" | "role", string>> = {};
  const phoneErr = validateManagerPhone(phone);
  if (phoneErr) errors.phone = phoneErr;
  const nameErr = validateManagerName(name);
  if (nameErr) errors.name = nameErr;
  if (!isManagerRoleValue(role)) errors.role = "Pilih role manager.";
  const first = errors.phone ?? errors.name ?? errors.role;
  if (first) return { ok: false, errors, message: first };
  return {
    ok: true,
    value: {
      name: name.trim().replace(/\s+/g, " "),
      phone: normalizeManagerPhone(phone),
      role: role as ManagerRoleValue,
    },
  };
}

const GENERIC_ERROR = "Terjadi kendala saat menyimpan. Coba lagi sebentar lagi.";

/**
 * Ubah error apa pun (Zod, Postgres/Supabase, jaringan) menjadi kalimat
 * Indonesia yang ramah. Tidak pernah mengembalikan JSON mentah.
 */
export function friendlyManagerError(err: unknown): string {
  const anyErr = err as { message?: unknown; code?: unknown; issues?: unknown } | null;
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const message =
    typeof err === "string" ? err : typeof anyErr?.message === "string" ? anyErr.message : "";

  if (code === "23505" || /duplicate key|property_managers_property_id_phone_key/i.test(message)) {
    return "Nomor ini sudah terdaftar sebagai manager.";
  }
  if (code === "23514" || /property_managers_role_check/i.test(message)) {
    return "Role tidak valid. Pilih Super Admin, Booking Manager, atau Viewer.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "Akun Anda tidak punya izin mengubah daftar manager.";
  }
  if (/unauthori[sz]ed|jwt|no authorization/i.test(message)) {
    return "Sesi login berakhir. Silakan masuk ulang lalu coba lagi.";
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Koneksi terputus. Periksa internet lalu coba lagi.";
  }

  // Zod issues (bisa berupa array objek, atau message berisi JSON array).
  let issues: unknown = Array.isArray(anyErr?.issues) ? anyErr?.issues : null;
  const trimmed = message.trim();
  if (!issues && (trimmed.startsWith("[") || trimmed.startsWith("{"))) {
    try {
      const parsed = JSON.parse(trimmed);
      issues = Array.isArray(parsed) ? parsed : (parsed?.issues ?? null);
    } catch {
      return GENERIC_ERROR;
    }
  }
  if (Array.isArray(issues)) {
    const first = issues[0] as { path?: unknown[]; message?: string } | undefined;
    const field = Array.isArray(first?.path) ? String(first?.path[0] ?? "") : "";
    if (field === "phone") return "Nomor WhatsApp tidak valid. Contoh: 0812 3456 7890.";
    if (field === "name") return "Nama wajib diisi.";
    if (field === "role") return "Pilih role manager.";
    return GENERIC_ERROR;
  }

  if (!message) return GENERIC_ERROR;
  // Pesan sudah dalam bahasa Indonesia dari server (validasi kita sendiri).
  if (
    message.length <= 160 &&
    !/[{}[\]]/.test(message) &&
    !/violates|constraint|column|relation|syntax|null value|invalid input|undefined|TypeError/i.test(
      message,
    )
  ) {
    return message;
  }
  return GENERIC_ERROR;
}

/* ------------------------------------------------------------------ */
/* Alur tambah manager (dipanggil server function; client disuntikkan  */
/* supaya bisa dites dengan client palsu).                             */
/* ------------------------------------------------------------------ */

type QueryResult<T> = { data: T | null; error: unknown };

/** Subset minimal SupabaseClient yang dipakai alur tambah manager. */
export type ManagerDbClient = {
  from(table: string): any;
};

/**
 * Tambah manager: tentukan property_id di server (tidak bergantung id dari
 * browser), tolak nomor duplikat (dibandingkan setelah normalisasi), simpan
 * nomor dalam format 62…. Semua error dilempar sebagai pesan Indonesia.
 */
export async function insertPropertyManager(
  client: ManagerDbClient,
  input: AddManagerInput & { property_id?: string },
): Promise<{ id: string; name: string; phone: string; role: string }> {
  const fail = (error: unknown): never => {
    console.error("[property_managers]", error);
    throw new Error(friendlyManagerError(error));
  };

  const v = validateAddManagerInput(input);
  if (!v.ok) throw new Error(v.message);

  let propertyId = input.property_id;
  if (!propertyId) {
    const res = (await client
      .from("properties")
      .select("id")
      .limit(1)
      .maybeSingle()) as QueryResult<{
      id?: string;
    }>;
    if (res.error) fail(res.error);
    propertyId = res.data?.id;
    if (!propertyId)
      throw new Error("Data properti belum ada. Lengkapi tab Properti terlebih dahulu.");
  }

  const listRes = (await client
    .from("property_managers")
    .select("id, name, phone")
    .eq("property_id", propertyId)) as QueryResult<ManagerLike[]>;
  if (listRes.error) fail(listRes.error);
  const dup = findDuplicateManager(listRes.data ?? [], v.value.phone);
  if (dup) throw new Error(duplicateManagerMessage(dup));

  const ins = (await client
    .from("property_managers")
    .insert([
      {
        property_id: propertyId,
        name: v.value.name,
        phone: v.value.phone,
        role: v.value.role,
        is_active: true,
      },
    ])
    .select("id, name, phone, role")
    .single()) as QueryResult<{ id: string; name: string; phone: string; role: string }>;
  if (ins.error) fail(ins.error);
  if (!ins.data) throw new Error("Terjadi kendala saat menyimpan. Coba lagi sebentar lagi.");
  return ins.data;
}
