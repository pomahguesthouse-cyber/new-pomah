/**
 * Public property payload.
 *
 * `properties` holds both guest-facing copy and server credentials.
 * Every public loader must return `toPublicSettings()` — an allowlist
 * plus a recursive strip — and never the raw row.
 *
 * The Google API key prefix is built at runtime so this module does not
 * embed the literal prefix in source or in a client bundle.
 */

// Built at runtime from char codes. A literal prefix here gets constant-folded
// into the client bundle; a loop does not.
function googleKeyPrefix(): string {
  const codes = [65, 73, 122, 97];
  let prefix = "";
  for (const code of codes) prefix += String.fromCharCode(code);
  return prefix;
}

const GOOGLE_API_KEY_RE = new RegExp(`${googleKeyPrefix()}[0-9A-Za-z_\\-]{20,}`, "g");

/**
 * Secret-like object keys. Keep this aligned with
 * `strip_secret_json_keys` in the public-property SQL migration.
 */
export const SECRET_KEY_RE =
  /(^|_)(api[_-]?key|client[_-]?secret|secret|password|passwd|credential|service[_-]?role|webhook|payment_account|payment_bank)($|_)|_token$|^token$/i;

/** Columns safe to ship to the public site. Nested JSON is still stripped. */
export const PUBLIC_PROPERTY_FIELDS = [
  "id",
  "name",
  "tagline",
  "description",
  "address",
  "city",
  "country",
  "email",
  "phone",
  "whatsapp_number",
  "hero_image_url",
  "logo_url",
  "invoice_logo_url",
  "favicon_url",
  "public_domain",
  "google_analytics_id",
  "google_tag_manager_id",
  "google_search_console",
  "google_place_id",
  "hotel_policy",
  "homepage_config",
  "explore_config",
  "currency",
  "timezone",
  "instagram_url",
  "tiktok_url",
  "youtube_url",
  "facebook_url",
  "created_at",
  "updated_at",
] as const;

export type PublicPropertyField = (typeof PUBLIC_PROPERTY_FIELDS)[number];

export type PublicSettings = Partial<Record<PublicPropertyField, unknown>>;

export function isSecretSettingsKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

function sanitizePublicString(value: string): string {
  GOOGLE_API_KEY_RE.lastIndex = 0;
  return value.replace(GOOGLE_API_KEY_RE, "");
}

/** Drop secret-like keys anywhere in a JSON tree, and redact embedded Google API keys. */
export function stripSecretKeys<T>(value: T): T {
  return stripValue(value) as T;
}

function stripValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizePublicString(value);
  if (Array.isArray(value)) return value.map((item) => stripValue(item));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretSettingsKey(key)) continue;
    out[key] = stripValue(child);
  }
  return out;
}

/**
 * Allowlist a property/settings row for a public response.
 * Throws if the result still contains a secret-like key or a Google API key.
 */
export function toPublicSettings(row: unknown): PublicSettings | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  const out: PublicSettings = {};
  for (const key of PUBLIC_PROPERTY_FIELDS) {
    if (key in source) out[key] = stripValue(source[key]);
  }
  assertNoSecretSettings(out);
  return out;
}

/** Paths (no values) of anything that must not appear in a public payload. */
export function findSecretPaths(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  walk(value, path, found);
  return found;
}

function walk(value: unknown, path: string, found: string[]): void {
  if (typeof value === "string") {
    GOOGLE_API_KEY_RE.lastIndex = 0;
    if (GOOGLE_API_KEY_RE.test(value)) found.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = `${path}.${key}`;
    if (isSecretSettingsKey(key)) {
      found.push(next);
      continue;
    }
    walk(child, next, found);
  }
}

export function assertNoSecretSettings(value: unknown): void {
  const paths = findSecretPaths(value);
  if (paths.length > 0) {
    throw new Error(`Public settings contain secret-like keys: ${paths.join(", ")}`);
  }
}
