/**
 * Knowledge base fasilitas per kamar — SATU-SATUNYA sumber jawaban untuk
 * password WiFi (+ letak tulisannya), dapur & alat masak, handuk, hairdryer,
 * titik check-in, dan link maps.
 *
 * Latar (laporan Sania 13–18 Okt 2026): letak password WiFi dijawab dua versi
 * (di balik kunci vs stiker dekat TV) dan alat masak dapur tidak diketahui.
 * Aturan: bot TIDAK menebak. Kolom kosong → handoff ke admin.
 *
 * Tabel `room_facility_knowledge`: satu baris `room_type_id IS NULL` berlaku
 * untuk semua kamar; baris per tipe kamar menimpa kolom yang terisi.
 */

export const FACILITY_FIELDS = [
  "wifi_password",
  "wifi_password_location",
  "kitchen",
  "cooking_tools",
  "towels",
  "hairdryer",
  "checkin_point",
  "maps_url",
] as const;
export type FacilityField = (typeof FACILITY_FIELDS)[number];

export const FACILITY_FIELD_LABEL: Record<FacilityField, string> = {
  wifi_password: "Password WiFi",
  wifi_password_location: "Letak tulisan password WiFi",
  kitchen: "Dapur",
  cooking_tools: "Alat masak di dapur",
  towels: "Handuk",
  hairdryer: "Hairdryer",
  checkin_point: "Titik check-in",
  maps_url: "Link Google Maps",
};

export type FacilityKbRow = { room_type_id: string | null } & Partial<Record<FacilityField, string | null>>;

export type FacilityTopic =
  | "wifi_password"
  | "wifi_location"
  | "kitchen"
  | "cooking_tools"
  | "towels"
  | "hairdryer"
  | "checkin_point";

const n = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const WIFI = String.raw`(?:wifi|wi-fi|wi fi|wifinya|internet)`;
const PASS = String.raw`(?:password|passwordnya|pass|pasword|paswordnya|sandi|sandinya|pw|pwd|kata sandi|kode)`;
const WHERE = String.raw`(?:dimana|di mana|dmn|letak|letaknya|lokasi|ditempel|tertulis|ada di|sebelah mana|nemu|cari)`;

/** Topik fasilitas yang dijawab dari KB. null = bukan pertanyaan KB. */
export function detectFacilityTopic(text: string): FacilityTopic | null {
  const t = n(text);
  if (!t) return null;
  const mentionsPass = new RegExp(`${PASS}\\s*(?:${WIFI})|${WIFI}\\s*(?:nya\\s*)?(?:apa\\s*)?${PASS}|${WIFI}\\s*(?:nya\\s*)?apa\\b|${PASS}\\b.{0,15}${WIFI}`).test(t);
  if (mentionsPass) {
    if (new RegExp(`${WHERE}.{0,30}${PASS}|${PASS}.{0,30}${WHERE}`).test(t)) return "wifi_location";
    return "wifi_password";
  }
  if (/\b(alat masak|alat-alat masak|perlengkapan (?:dapur|masak)|peralatan (?:dapur|masak)|kompor|panci|wajan|penggorengan|teflon|rice cooker|magic com|magicom|piring|gelas|sendok)(?:nya)?\b/.test(t)) {
    return "cooking_tools";
  }
  if (/\b(dapur|dapurnya|kitchen|kitchennya|pantry|bisa masak|boleh masak|masak sendiri)\b/.test(t)) return "kitchen";
  if (/\b(handuk|handuknya|towel)\b/.test(t)) return "towels";
  if (/\b(hair ?dryer|hairdryer|pengering rambut)(?:nya)?\b/.test(t)) return "hairdryer";
  if (
    /\b(check.?in|cekin|chekin|ceckin|cek in)\b.{0,30}\b(dimana|di mana|dmn|sebelah mana|lewat mana|ke mana|kemana|lokasinya|tempatnya|pintu)\b/.test(t) ||
    /\b(dimana|di mana|dmn|sebelah mana|kemana|ke mana)\b.{0,25}\b(check.?in|cekin|chekin|resepsionis|receptionist|lobby|lobi|ambil kunci|kuncinya)\b/.test(t) ||
    /\b(ambil kunci|kuncinya|resepsionis|receptionist|lobby|lobi)\b.{0,20}\b(dimana|di mana|dmn|sebelah mana|kemana|ke mana)\b/.test(t)
  ) {
    return "checkin_point";
  }
  return null;
}

const val = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/** Nilai kolom: baris tipe kamar tamu → baris umum. Tidak ada tebakan. */
export function resolveFacilityField(
  rows: FacilityKbRow[],
  field: FacilityField,
  roomTypeIds: Array<string | null | undefined> = [],
): string | null {
  const ids = roomTypeIds.filter((x): x is string => !!x);
  if (ids.length > 0) {
    const specific = ids
      .map((id) => val(rows.find((r) => r.room_type_id === id)?.[field]))
      .filter((x): x is string => !!x);
    const unique = [...new Set(specific)];
    if (unique.length === 1 && specific.length === ids.length) return unique[0];
    if (unique.length > 1) return unique.join(" / ");
  }
  return val(rows.find((r) => r.room_type_id === null)?.[field]);
}

/** Kolom yang wajib terisi untuk menjawab topik. */
export function fieldsForTopic(topic: FacilityTopic): FacilityField[] {
  switch (topic) {
    case "wifi_password":
      return ["wifi_password"];
    case "wifi_location":
      return ["wifi_password", "wifi_password_location"];
    case "kitchen":
      return ["kitchen"];
    case "cooking_tools":
      return ["cooking_tools"];
    case "towels":
      return ["towels"];
    case "hairdryer":
      return ["hairdryer"];
    case "checkin_point":
      return ["checkin_point"];
  }
}

export type FacilityKbAnswer =
  | { kind: "answer"; reply: string; topic: FacilityTopic }
  | { kind: "handoff"; topic: FacilityTopic; missing: FacilityField[]; partialReply: string | null };

/**
 * Jawab dari KB. Kolom kosong → handoff (dengan jawaban parsial bila ada,
 * mis. password diketahui tapi letaknya belum).
 */
export function answerFromFacilityKb(input: {
  topic: FacilityTopic;
  rows: FacilityKbRow[];
  roomTypeIds?: Array<string | null | undefined>;
  fallbackMapsUrl?: string | null;
}): FacilityKbAnswer {
  const { topic, rows } = input;
  const get = (f: FacilityField) => resolveFacilityField(rows, f, input.roomTypeIds ?? []);
  const missing = fieldsForTopic(topic).filter((f) => !get(f));
  const wifi = get("wifi_password");
  const wifiLine = wifi ? `Password WiFi: *${wifi}* (huruf kecil semua, tanpa spasi), Kak.` : null;

  if (topic === "wifi_location") {
    const loc = get("wifi_password_location");
    if (wifi && loc) return { kind: "answer", topic, reply: `${wifiLine}\nTulisan passwordnya ada ${loc}.` };
    return { kind: "handoff", topic, missing, partialReply: wifiLine };
  }
  if (missing.length > 0) return { kind: "handoff", topic, missing, partialReply: null };

  switch (topic) {
    case "wifi_password":
      return { kind: "answer", topic, reply: wifiLine as string };
    case "kitchen": {
      const tools = get("cooking_tools");
      return {
        kind: "answer",
        topic,
        reply: `${get("kitchen")}${tools ? `\nAlat masak yang tersedia: ${tools}.` : ""}`,
      };
    }
    case "cooking_tools":
      return { kind: "answer", topic, reply: `Alat masak yang tersedia di dapur: ${get("cooking_tools")}.` };
    case "towels":
      return { kind: "answer", topic, reply: `${get("towels")}` };
    case "hairdryer":
      return { kind: "answer", topic, reply: `${get("hairdryer")}` };
    case "checkin_point": {
      const maps = get("maps_url") ?? val(input.fallbackMapsUrl);
      return { kind: "answer", topic, reply: `Titik check-in: ${get("checkin_point")}${maps ? `\nMaps: ${maps}` : ""}` };
    }
  }
}

/** Kolom yang belum diisi (untuk laporan ke pemilik). */
export function missingFacilityFields(rows: FacilityKbRow[]): FacilityField[] {
  return FACILITY_FIELDS.filter((f) => !resolveFacilityField(rows, f));
}

type Db = { from: (t: string) => any };

export async function loadFacilityKb(db: Db): Promise<FacilityKbRow[]> {
  const { data, error } = await db
    .from("room_facility_knowledge")
    .select(`room_type_id, ${FACILITY_FIELDS.join(", ")}`);
  if (error) throw new Error(error.message ?? "room_facility_knowledge query failed");
  return (Array.isArray(data) ? data : []) as FacilityKbRow[];
}

/** Blok konteks untuk AI: fakta KB + daftar kolom kosong yang tidak boleh ditebak. */
export function buildFacilityKbPromptBlock(
  rows: FacilityKbRow[],
  roomNameById: Map<string, string> = new Map(),
): string {
  const lines: string[] = [];
  const general = rows.find((r) => r.room_type_id === null);
  for (const f of FACILITY_FIELDS) {
    const g = val(general?.[f]);
    const specific = rows
      .filter((r) => r.room_type_id && val(r[f]))
      .map((r) => `${roomNameById.get(r.room_type_id as string) ?? "Kamar"}: ${val(r[f])}`);
    if (!g && specific.length === 0) {
      lines.push(`- ${FACILITY_FIELD_LABEL[f]}: BELUM DIKETAHUI`);
      continue;
    }
    lines.push(`- ${FACILITY_FIELD_LABEL[f]}: ${[g ? `semua kamar: ${g}` : null, ...specific].filter(Boolean).join("; ")}`);
  }
  return (
    "KNOWLEDGE BASE FASILITAS (sumber tunggal, menang atas SOP/contoh lain):\n" +
    lines.join("\n") +
    "\nUntuk kolom BELUM DIKETAHUI: JANGAN menebak atau memakai info lain; katakan bahwa hal itu kami teruskan ke admin."
  );
}
