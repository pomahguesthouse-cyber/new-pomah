/**
 * Reaction emoji WhatsApp (Meta Cloud API, `type: "reaction"`).
 *
 * Reaction BUKAN pesan baru: tidak membuat bubble, tidak memicu balasan AI,
 * tidak masuk OCR bukti bayar. Disimpan di `metadata.reactions` pesan yang
 * direaksi (dicari lewat wamid), satu emoji terakhir per pengirim reaction.
 * Emoji kosong = reaction dihapus.
 */

type Admin = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export interface MetaReactionPayload {
  message_id?: string;
  emoji?: string;
}

export interface ReactionEntry {
  emoji: string;
  at: string;
  direction: "in" | "out";
}

export type ReactionMap = Record<string, ReactionEntry>;

export function isReactionMessage(m: { type?: string; reaction?: unknown } | null | undefined): boolean {
  return !!m && (m.type === "reaction" || (!!m.reaction && typeof m.reaction === "object"));
}

/** Terapkan satu reaction ke peta reaction (murni, untuk test & fallback). */
export function applyReaction(
  current: unknown,
  reactor: string,
  emoji: string | null | undefined,
  at: string,
  direction: "in" | "out" = "in",
): ReactionMap {
  const base: ReactionMap = {};
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
      const e = v as Partial<ReactionEntry> | null;
      if (e && typeof e.emoji === "string" && e.emoji) {
        base[k] = { emoji: e.emoji, at: String(e.at ?? ""), direction: e.direction === "out" ? "out" : "in" };
      }
    }
  }
  const prev = base[reactor];
  // Event lama (redelivery terlambat) tidak menimpa reaction yang lebih baru.
  if (prev && prev.at && at && prev.at > at) return base;
  const clean = (emoji ?? "").trim();
  if (!clean) delete base[reactor];
  else base[reactor] = { emoji: clean, at, direction };
  return base;
}

export interface ReactionPill {
  emoji: string;
  count: number;
}

/** Ringkas reaction untuk UI: kelompokkan per emoji, urut paling awal. */
export function summarizeReactions(metadata: unknown): ReactionPill[] {
  const raw =
    metadata && typeof metadata === "object" ? (metadata as { reactions?: unknown }).reactions : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const groups = new Map<string, { count: number; first: string }>();
  for (const v of Object.values(raw as Record<string, unknown>)) {
    const e = v as Partial<ReactionEntry> | null;
    if (!e || typeof e.emoji !== "string" || !e.emoji.trim()) continue;
    const g = groups.get(e.emoji);
    const at = String(e.at ?? "");
    if (g) {
      g.count += 1;
      if (at < g.first) g.first = at;
    } else groups.set(e.emoji, { count: 1, first: at });
  }
  return [...groups.entries()]
    .sort((a, b) => (a[1].first < b[1].first ? -1 : a[1].first > b[1].first ? 1 : 0))
    .map(([emoji, g]) => ({ emoji, count: g.count }));
}

/** Pesan lama "[Lampiran reaction]" (sebelum fitur ini) tidak ditampilkan sebagai bubble. */
export function isLegacyReactionBubble(m: { body?: string | null; metadata?: unknown }): boolean {
  const mt = m.metadata && typeof m.metadata === "object" ? (m.metadata as { media_type?: unknown }).media_type : null;
  return mt === "reaction" || (m.body ?? "").trim() === "[Lampiran reaction]";
}

function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const out = new Set<string>([phone, d]);
  if (d.startsWith("62")) out.add(`0${d.slice(2)}`);
  if (d.startsWith("0")) out.add(`62${d.slice(1)}`);
  return [...out].filter(Boolean);
}

/** Cari baris whatsapp_messages yang direaksi berdasarkan wamid. */
export async function findReactionTarget(
  admin: Admin,
  wamid: string,
  reactorPhone: string,
): Promise<{ id: string; metadata: Record<string, unknown> } | null> {
  const pick = (res: any) => {
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    if (!row?.id) return null;
    const md = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
    return { id: String(row.id), metadata: md as Record<string, unknown> };
  };
  // 1) Pesan tamu & pesan manual admin menyimpan wamid di wpp_id.
  const direct = await admin.from("whatsapp_messages").select("id, metadata").eq("wpp_id", wamid).limit(1);
  const hit = pick(direct);
  if (hit) return hit;

  // 2) Balasan bot hanya tercatat di whatsapp_meta_outbound → cocokkan isi + waktu.
  const ob = await admin
    .from("whatsapp_meta_outbound")
    .select("recipient, body, created_at")
    .eq("provider_message_id", wamid)
    .limit(1);
  const o = Array.isArray(ob?.data) ? ob.data[0] : ob?.data;
  if (!o?.created_at) return null;
  const phones = phoneVariants(String(o.recipient ?? reactorPhone));
  const orFilter = phones.flatMap((p) => [`phone.eq.${p}`, `canonical_phone.eq.${p}`]).join(",");
  const th = await admin.from("whatsapp_threads").select("id").or(orFilter).limit(5);
  const threadIds = (Array.isArray(th?.data) ? th.data : []).map((t: any) => t.id).filter(Boolean);
  if (!threadIds.length) return null;
  const t0 = new Date(o.created_at).getTime();
  const res = await admin
    .from("whatsapp_messages")
    .select("id, metadata, body, sent_at")
    .in("thread_id", threadIds)
    .eq("direction", "out")
    .gte("sent_at", new Date(t0 - 5 * 60_000).toISOString())
    .lte("sent_at", new Date(t0 + 5 * 60_000).toISOString())
    .limit(50);
  const rows = (Array.isArray(res?.data) ? res.data : []) as any[];
  const body = String(o.body ?? "").trim();
  const candidates = rows.filter((r) => body && String(r.body ?? "").trim() === body);
  const pool = candidates.length ? candidates : rows.length === 1 ? rows : [];
  if (!pool.length) return null;
  pool.sort(
    (a, b) => Math.abs(new Date(a.sent_at).getTime() - t0) - Math.abs(new Date(b.sent_at).getTime() - t0),
  );
  return pick({ data: pool[0] });
}

export interface ReactionHandleResult {
  stored: boolean;
  reason: "stored" | "invalid" | "target_missing" | "error";
}

/** Simpan reaction tamu. Tidak pernah melempar: reaction tidak boleh memblokir inbox. */
export async function handleInboundReaction(
  admin: Admin,
  m: { from?: string; id?: string; timestamp?: string; reaction?: MetaReactionPayload },
): Promise<ReactionHandleResult> {
  const wamid = m.reaction?.message_id?.trim();
  const reactor = m.from?.trim();
  if (!wamid || !reactor) return { stored: false, reason: "invalid" };
  const at = m.timestamp
    ? new Date(Number(m.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  const emoji = m.reaction?.emoji ?? "";
  try {
    const target = await findReactionTarget(admin, wamid, reactor);
    if (!target) {
      console.warn(`[WaReaction] target ${wamid} tidak ditemukan; reaction diabaikan`);
      return { stored: false, reason: "target_missing" };
    }
    // Atomik lewat RPC (migration). Bila belum dipasang, jatuh ke update biasa.
    const rpc = await admin.rpc("apply_whatsapp_message_reaction", {
      p_message_id: target.id,
      p_reactor: reactor,
      p_emoji: emoji,
      p_at: at,
      p_direction: "in",
    });
    if (!rpc?.error) return { stored: true, reason: "stored" };
    const code = String(rpc.error.code ?? "");
    const msg = String(rpc.error.message ?? "");
    if (code !== "PGRST202" && !/function|does not exist|schema cache/i.test(msg)) {
      console.warn("[WaReaction] rpc gagal:", msg);
    }
    const reactions = applyReaction(target.metadata.reactions, reactor, emoji, at, "in");
    const { error } = await admin
      .from("whatsapp_messages")
      .update({ metadata: { ...target.metadata, reactions } })
      .eq("id", target.id);
    if (error) {
      console.warn("[WaReaction] simpan gagal:", error.message ?? error);
      return { stored: false, reason: "error" };
    }
    return { stored: true, reason: "stored" };
  } catch (e) {
    console.warn("[WaReaction] error:", e instanceof Error ? e.message : e);
    return { stored: false, reason: "error" };
  }
}
