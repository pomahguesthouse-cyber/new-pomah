/**
 * Public NAP and map constants.
 *
 * GOOGLE_BUSINESS_PROFILE_CID was not in the 27 Sep 2026 audit. Leave it
 * empty until the owner pastes the decimal CID from the Business Profile.
 * POMAH_GEO is an approximate Sampangan pin for schema.org and should be
 * confirmed against that same profile.
 */
export const POMAH_NAME = "Pomah Guesthouse";
export const POMAH_STREET = "Jl. Dewi Sartika IV No. 71";
export const POMAH_LOCALITY = "Sampangan, Semarang";
export const POMAH_POSTAL_CODE = "50232";
export const POMAH_REGION = "Jawa Tengah";
export const POMAH_NAP_LINE = `${POMAH_NAME}, ${POMAH_STREET}, ${POMAH_LOCALITY}`;

/** Decimal Google Business Profile CID. Empty until the owner supplies it. */
export const GOOGLE_BUSINESS_PROFILE_CID = "";

export const POMAH_GEO = {
  latitude: -6.9936,
  longitude: 110.3987,
};

const FALLBACK_PHONE_DIGITS = "6285190986169";

export function phoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return FALLBACK_PHONE_DIGITS;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

/** +62 851-9098-6169 style, from the number stored in site settings. */
export function formatSitePhone(raw: string | null | undefined): string {
  const digits = phoneDigits(raw);
  const local = digits.startsWith("62") ? digits.slice(2) : digits;
  if (local.length >= 9) {
    return `+62 ${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return `+${digits}`;
}

export function schemaTelephone(raw: string | null | undefined): string {
  return `+${phoneDigits(raw)}`;
}

export function pomahHasMapUrl(): string {
  if (GOOGLE_BUSINESS_PROFILE_CID) {
    return `https://www.google.com/maps?cid=${GOOGLE_BUSINESS_PROFILE_CID}`;
  }
  return "https://www.google.com/maps/search/?api=1&query=Pomah+Guesthouse";
}

export function pomahMapEmbedUrl(): string {
  if (GOOGLE_BUSINESS_PROFILE_CID) {
    return `https://maps.google.com/maps?cid=${encodeURIComponent(GOOGLE_BUSINESS_PROFILE_CID)}&output=embed`;
  }
  const query = `${POMAH_NAME}, ${POMAH_STREET}, ${POMAH_LOCALITY}`;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

export function sameAsLinks(property?: {
  instagram_url?: string | null;
  tiktok_url?: string | null;
  facebook_url?: string | null;
  youtube_url?: string | null;
} | null): string[] {
  const links = [
    property?.instagram_url,
    property?.tiktok_url,
    property?.facebook_url,
    property?.youtube_url,
    pomahHasMapUrl(),
  ];
  return links.map((link) => (link ?? "").trim()).filter(Boolean);
}
