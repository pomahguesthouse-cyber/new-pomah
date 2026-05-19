/**
 * Supabase Edge Function: process-wa-queue
 * Runtime: Deno
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  AI BACKGROUND WORKER                                               │
 * │                                                                     │
 * │  Triggered by pg_net after INSERT into wa_processing_queue.        │
 * │  Handles the entire AI pipeline without any timeout pressure        │
 * │  (Supabase Edge Functions allow up to 150s wall-clock).            │
 * │                                                                     │
 * │  Pipeline:                                                          │
 * │    1. Verify x-worker-secret                                        │
 * │    2. Fetch queue entry                                             │
 * │    3. Load autoreply context (fonnte_token, messages, delay_cfg)   │
 * │    4. Check auto_reply_enabled                                      │
 * │    5. Calculate smart delay, sleep                                  │
 * │    6. is_newest_pending_for_phone (winner check)                   │
 * │    7. Re-fetch fresh messages (accumulates burst)                  │
 * │    8. Build system prompt + run AI orchestration with tools        │
 * │    9. Send via Fonnte                                              │
 * │   10. Save outbound, mark queue done                               │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Environment variables required:
 *   SUPABASE_URL             — auto-provided by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase runtime
 *   WORKER_SECRET            — shared secret matching app.worker_secret DB setting
 *   LOVABLE_API_KEY          — AI gateway key (set via: supabase secrets set LOVABLE_API_KEY=...)
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const SUPABASE_URL             = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_SECRET            = Deno.env.get("WORKER_SECRET") ?? "";
const LOVABLE_API_KEY          = Deno.env.get("LOVABLE_API_KEY") ?? "";

function makeAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueEntry {
  id:         string;
  phone:      string;
  message_id: string | null;
  body:       string;
  status:     string;
  attempts:   number;
}

interface AutoreplyContext {
  thread_id:          string;
  auto_reply_enabled: boolean;
  fonnte_token:       string;
  messages:           Array<{ direction: string; body: string }>;
  smart_delay_config: SmartDelayConfig | null;
}

interface SmartDelayConfig {
  enabled:      boolean;
  shortMs:      number;
  mediumMs:     number;
  longMs:       number;
  waitSignalMs: number;
  maxDelayMs:   number;
}

interface RoomType {
  id:          string;
  name:        string;
  base_rate:   number | null;
  capacity:    number | null;
  bed_type:    string | null;
  description: string | null;
}

interface Property {
  id?:                      string;
  name?:                    string;
  ai_api_key?:              string;
  ai_model?:                string;
  ai_base_url?:             string;
  ai_lab_config?:           Record<string, unknown>;
  payment_bank_name?:       string;
  payment_account_number?:  string;
  payment_account_holder?:  string;
  [key: string]: unknown;
}

// ─── Smart Delay ──────────────────────────────────────────────────────────────

const DEFAULT_DELAY: SmartDelayConfig = {
  enabled:      true,
  shortMs:      6000,
  mediumMs:     3000,
  longMs:       1000,
  waitSignalMs: 8000,
  maxDelayMs:   10000,
};

const WAIT_SIGNALS = /\b(bentar|sebentar|tunggu|wait|lagi|masih|cek dulu|cek)\b|\.\.\./i;

function calcDelayMs(body: string, cfg: SmartDelayConfig): number {
  if (!cfg.enabled) return 0;
  let base: number;
  if (WAIT_SIGNALS.test(body))       base = cfg.waitSignalMs;
  else if (body.trim().length < 15)  base = cfg.shortMs;
  else if (body.trim().length <= 80) base = cfg.mediumMs;
  else                               base = cfg.longMs;
  return Math.min(base, cfg.maxDelayMs);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember"];

function fmtDateID(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

function nextDay(d: string): string {
  return new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

function todayWIB(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ─── AI agent config merge ────────────────────────────────────────────────────

const AGENT_KEYS = ["front-office","pricing","housekeeping","maintenance","finance","manager"];
const AGENT_DEFAULTS: Record<string, string> = {
  "front-office": "Anda Front Office Agent Pomah Guesthouse. Tangani reservasi, check-in/check-out, dan pertanyaan umum tamu. Ramah, sapa tamu dengan 'Kak', jawab singkat dan jelas.",
};

interface AgentConfig  { enabled: boolean; autoReply: boolean; instructions: string; }
interface ToolCfg      { enabled: boolean; }
interface AiLabConfig  { agents: Record<string, AgentConfig>; tools: Record<string, ToolCfg>; }

function mergeAiLabConfig(raw: unknown): AiLabConfig {
  const c = (raw ?? {}) as Partial<AiLabConfig>;
  const agents: Record<string, AgentConfig> = {};
  for (const k of AGENT_KEYS) {
    const a = c.agents?.[k];
    agents[k] = {
      enabled:      a?.enabled      ?? true,
      autoReply:    a?.autoReply    ?? false,
      instructions: a?.instructions?.trim() ? a.instructions : (AGENT_DEFAULTS[k] ?? ""),
    };
  }
  const tools: Record<string, ToolCfg> = {};
  for (const k of ["pms-database","room-availability","sop-knowledge","pricing-engine","faq-memory"]) {
    tools[k] = { enabled: c.tools?.[k]?.enabled ?? true };
  }
  return { agents, tools };
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  property:  Property,
  cfg:       AiLabConfig,
  rooms:     RoomType[],
  sopText:   string,
): string {
  const today = todayWIB();

  const agentLines = AGENT_KEYS
    .filter((k) => cfg.agents[k]?.enabled && cfg.agents[k]?.instructions?.trim())
    .map((k) => `• ${k}: ${cfg.agents[k].instructions.trim()}`);

  const roomLines = rooms.map(
    (r) => `• ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam, kapasitas ${r.capacity ?? "-"} tamu${r.bed_type ? `, ${r.bed_type}` : ""}`,
  );

  return [
    `Anda adalah asisten AI untuk ${property.name ?? "Pomah Guesthouse"}, sebuah penginapan. Anda membalas pesan WhatsApp.`,
    "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",
    `Hari ini tanggal ${fmtDateID(today)}.`,
    "FORMAT TANGGAL: selalu tampilkan tanggal ke tamu dalam format Indonesia, contoh '19 Mei 2026'. JANGAN tampilkan format YYYY-MM-DD.",
    agentLines.length ? `Panduan tiap agent:\n${agentLines.join("\n")}` : "",
    roomLines.length  ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}` : "",
    sopText
      ? "Basis Pengetahuan SOP (rujuk untuk menjawab kebijakan, prosedur, lokasi & info lainnya). " +
        "Sebagian entri menyertakan '(Tautan: <url>)'. Bila tamu meminta link, lokasi, peta/Google Maps, " +
        "alamat, atau panduan tertentu, KIRIMKAN URL lengkap dari entri SOP yang relevan. " +
        "Tulis URL-nya POLOS dan UTUH — salin persis, jangan dipotong, jangan dibungkus tanda kurung/markdown, " +
        `dan jangan beri tanda baca menempel di akhir URL. Jangan pernah mengarang URL.\n${sopText}`
      : "",
    "KETERSEDIAAN KAMAR: Anda memiliki tool `check_room_availability`. Setiap kali tamu menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak ketersediaan. Jika tamu tidak menyebut tanggal, anggap untuk hari ini (check-in hari ini, 1 malam).",
    "Saat menyampaikan hasil tool: awali dengan baris 'Ketersediaan kamar untuk <tanggal>'. Lalu tiap tipe kamar satu baris — gunakan ✅ bila ada kamar tersedia atau ❌ bila penuh, diikuti nama kamar, jumlah kamar tersedia, dan harga per malam. Tutup dengan ajakan memilih kamar untuk lanjut booking.",
    "BOOKING VIA CHAT: Anda dapat membuatkan pesanan kamar langsung. Alurnya: (1) cek ketersediaan dengan tool, (2) setelah tamu memilih satu tipe kamar, minta nama lengkap, email, dan nomor HP tamu, (3) setelah SEMUA data lengkap baru panggil tool `create_booking`. JANGAN pernah mengarang data tamu — bila ada yang belum diberikan, tanyakan dulu dan jangan panggil tool.",
    "Setelah `create_booking` berhasil: sampaikan sapaan dengan nama tamu, kode booking, total harga, lalu instruksi transfer ke rekening (bank, nomor rekening, atas nama) bila tersedia, dan minta tamu mengirim bukti pembayaran. Bila info rekening kosong, beritahu tamu bahwa detail pembayaran akan dikirim staf. Bila tool gagal, sampaikan alasannya dengan sopan.",
    "Ini percakapan WhatsApp — gunakan format teks biasa, hindari Markdown (jangan pakai *, _, atau #).",
  ].filter(Boolean).join("\n\n");
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "check_room_availability",
      description: "Cek ketersediaan kamar nyata (jumlah kamar kosong per tipe) untuk rentang tanggal. Gunakan saat tamu menanyakan kamar tersedia/kosong atau ingin booking.",
      parameters: {
        type: "object",
        properties: {
          check_in:  { type: "string", description: "Tanggal check-in format YYYY-MM-DD. Kosongkan untuk hari ini." },
          check_out: { type: "string", description: "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk sehari setelah check-in." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Buat pesanan/booking kamar untuk tamu. Panggil HANYA setelah tamu memilih tipe kamar dan memberikan nama lengkap, email, dan nomor HP. Jangan panggil bila data belum lengkap.",
      parameters: {
        type: "object",
        properties: {
          room_type: { type: "string", description: "Nama tipe kamar yang dipilih tamu." },
          full_name: { type: "string", description: "Nama lengkap tamu." },
          email:     { type: "string", description: "Alamat email tamu." },
          phone:     { type: "string", description: "Nomor HP/WhatsApp tamu." },
          check_in:  { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
          check_out: { type: "string", description: "Tanggal check-out format YYYY-MM-DD." },
          adults:    { type: "number", description: "Jumlah tamu dewasa. Default 1." },
          children:  { type: "number", description: "Jumlah anak. Default 0." },
        },
        required: ["room_type", "full_name", "email", "phone", "check_in", "check_out"],
      },
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  check_room_availability: "Room Availability",
  create_booking:          "Booking Engine",
};

// ─── Tool: check_room_availability ───────────────────────────────────────────

async function runCheckAvailability(
  args:  Record<string, unknown>,
  db:    SupabaseClient,
  rooms: RoomType[],
): Promise<string> {
  const checkIn  = isDate(args.check_in)  ? args.check_in  : todayWIB();
  let   checkOut = isDate(args.check_out) ? args.check_out : nextDay(checkIn);
  if (checkOut <= checkIn) checkOut = nextDay(checkIn);

  const { data: rows } = await (db as any).rpc("room_type_availability_detail", {
    p_check_in: checkIn, p_check_out: checkOut,
  });

  const byId = new Map<string, { available: number; total: number }>(
    ((rows ?? []) as any[]).map((r: any) => [r.room_type_id, r]),
  );

  return JSON.stringify({
    check_in:  checkIn,
    check_out: checkOut,
    tanggal:   fmtDateID(checkIn),
    periode:   `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`,
    kamar: rooms.map((r) => {
      const d = byId.get(r.id);
      return {
        nama:            r.name,
        harga_per_malam: Number(r.base_rate ?? 0),
        kamar_tersedia:  d ? d.available : null,
        total_kamar:     d ? d.total     : null,
        catatan:         d ? undefined   : "jumlah kamar belum diatur di sistem",
      };
    }),
  });
}

// ─── Tool: create_booking ─────────────────────────────────────────────────────

async function runCreateBooking(
  args:     Record<string, unknown>,
  db:       SupabaseClient,
  rooms:    RoomType[],
  property: Property,
): Promise<string> {
  const fullName     = typeof args.full_name === "string" ? args.full_name.trim() : "";
  const email        = typeof args.email     === "string" ? args.email.trim()     : "";
  const phone        = typeof args.phone     === "string" ? args.phone.trim()     : "";
  const roomTypeName = typeof args.room_type === "string" ? args.room_type.toLowerCase().trim() : "";
  const checkIn      = isDate(args.check_in)  ? args.check_in  : "";
  const checkOut     = isDate(args.check_out) ? args.check_out : "";
  const adults       = Math.max(1, Math.min(8, Number(args.adults)   || 1));
  const children     = Math.max(0, Math.min(8, Number(args.children) || 0));

  if (!fullName || !email || !phone)
    return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return JSON.stringify({ ok: false, error: "Format email tidak valid." });
  if (!checkIn || !checkOut || checkOut <= checkIn)
    return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });

  const rt = rooms.find((r) => r.name.toLowerCase() === roomTypeName)
          ?? rooms.find((r) => r.name.toLowerCase().includes(roomTypeName) || roomTypeName.includes(r.name.toLowerCase()));
  if (!rt)
    return JSON.stringify({ ok: false, error: `Tipe kamar "${args.room_type}" tidak ditemukan.` });

  const { data: availRows } = await (db as any).rpc("room_type_availability_detail", { p_check_in: checkIn, p_check_out: checkOut });
  const avail = ((availRows ?? []) as any[]).find((r: any) => r.room_type_id === rt.id);
  if (avail && avail.available < 1)
    return JSON.stringify({ ok: false, error: `${rt.name} sudah penuh untuk tanggal tersebut.` });

  if (!property.id) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
  const rate   = Number(rt.base_rate ?? 0);
  const total  = rate * nights;

  const { data: guest, error: gErr } = await (db as any)
    .from("guests").insert({ full_name: fullName, email, phone }).select("id").single();
  if (gErr || !guest)
    return JSON.stringify({ ok: false, error: `Gagal menyimpan data tamu: ${gErr?.message}` });

  const { data: booking, error: bErr } = await (db as any)
    .from("bookings")
    .insert({ property_id: property.id, guest_id: guest.id, check_in: checkIn, check_out: checkOut, nights, adults, children, total_amount: total, source: "direct", status: "pending" })
    .select("id, reference_code").single();
  if (bErr || !booking)
    return JSON.stringify({ ok: false, error: `Gagal membuat booking: ${bErr?.message}` });

  // Pick an available room
  const { data: roomRows } = await (db as any).from("rooms").select("id, number").eq("room_type_id", rt.id).order("number");
  const { data: actBk }    = await (db as any).from("bookings").select("id").in("status", ["pending","confirmed","checked_in"]).lt("check_in", checkOut).gt("check_out", checkIn);
  const actIds = ((actBk ?? []) as any[]).map((b: any) => b.id);
  let assignedRoom: string | null = (roomRows as any[])[0]?.id ?? null;
  if (actIds.length > 0) {
    const { data: occ } = await (db as any).from("booking_rooms").select("room_id").in("booking_id", actIds);
    const taken = new Set(((occ ?? []) as any[]).map((r: any) => r.room_id));
    assignedRoom = ((roomRows ?? []) as any[]).find((r: any) => !taken.has(r.id))?.id ?? null;
  }

  const { error: brErr } = await (db as any).from("booking_rooms").insert({ booking_id: booking.id, room_id: assignedRoom, room_type_id: rt.id, nightly_rate: rate });
  if (brErr)
    return JSON.stringify({ ok: false, error: `Gagal menyimpan detail kamar: ${brErr.message}` });

  return JSON.stringify({
    ok: true,
    reference_code:   booking.reference_code,
    room_type:        rt.name,
    check_in_tampil:  fmtDateID(checkIn),
    check_out_tampil: fmtDateID(checkOut),
    nights,
    nightly_rate:     rate,
    total,
    guest:            { full_name: fullName, email, phone },
    pembayaran: {
      bank:        property.payment_bank_name       ?? null,
      no_rekening: property.payment_account_number  ?? null,
      atas_nama:   property.payment_account_holder  ?? null,
    },
  });
}

// ─── AI Orchestration loop ────────────────────────────────────────────────────

interface OrchestrationResult {
  reply:     string | null;
  toolsUsed: string[];
}

async function runOrchestration(
  messages:     Array<{ direction: string; body: string }>,
  systemPrompt: string,
  apiKey:       string,
  baseUrl:      string,
  model:        string,
  db:           SupabaseClient,
  rooms:        RoomType[],
  property:     Property,
): Promise<OrchestrationResult> {
  const toolsUsed = new Set<string>();

  const thread: any[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role:    m.direction === "in" ? "user" : "assistant",
      content: m.body,
    })),
  ];

  for (let turn = 0; turn < 4; turn++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model, temperature: 0.6, max_tokens: 600, messages: thread, tools: TOOL_DEFINITIONS, tool_choice: "auto" }),
      });
    } catch (e) {
      console.error("[Worker] LLM fetch error:", e);
      return { reply: null, toolsUsed: [] };
    }

    if (!res.ok) {
      console.error("[Worker] LLM HTTP error:", res.status, await res.text());
      return { reply: null, toolsUsed: [] };
    }

    let json: any;
    try { json = await res.json(); } catch { return { reply: null, toolsUsed: [] }; }

    const msg       = json.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const reply = msg?.content?.trim() ?? null;
      return { reply, toolsUsed: Array.from(toolsUsed) };
    }

    thread.push(msg);
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { args = {}; }

      let output: string;
      if (tc.function?.name === "check_room_availability") {
        output = await runCheckAvailability(args, db, rooms);
        toolsUsed.add(TOOL_LABELS.check_room_availability);
      } else if (tc.function?.name === "create_booking") {
        output = await runCreateBooking(args, db, rooms, property);
        toolsUsed.add(TOOL_LABELS.create_booking);
      } else {
        output = JSON.stringify({ error: `Unknown tool: ${tc.function?.name}` });
      }

      thread.push({ role: "tool", tool_call_id: tc.id, content: output });
    }
  }

  console.error("[Worker] max turns reached");
  return { reply: null, toolsUsed: Array.from(toolsUsed) };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Verify shared secret
  const incomingSecret = req.headers.get("x-worker-secret") ?? "";
  if (WORKER_SECRET && incomingSecret !== WORKER_SECRET) {
    console.warn("[Worker] Unauthorized — secret mismatch");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { queue_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const queueId = body.queue_id;
  if (!queueId) {
    return new Response("queue_id required", { status: 400 });
  }

  // Acknowledge immediately — all processing happens below
  // (Edge Function response can be awaited by pg_net, but we still
  //  want to return quickly to avoid blocking the DB trigger)
  const processAsync = async () => {
    const db = makeAdminClient();

    try {
      // ── Fetch queue entry ────────────────────────────────────────────────
      const { data: entry, error: entryErr } = await db
        .from("wa_processing_queue")
        .select("*")
        .eq("id", queueId)
        .single();

      if (entryErr || !entry) {
        console.error("[Worker] Queue entry not found:", queueId, entryErr);
        return;
      }

      const q = entry as QueueEntry;
      if (q.status !== "pending") {
        console.log("[Worker] Entry already processed:", q.status, queueId);
        return;
      }

      // Mark processing
      await db.from("wa_processing_queue")
        .update({ status: "processing", attempts: q.attempts + 1, updated_at: new Date().toISOString() })
        .eq("id", queueId);

      // ── Load autoreply context ────────────────────────────────────────────
      const { data: ctx, error: ctxErr } = await (db as any).rpc(
        "get_autoreply_context", { p_phone: q.phone },
      );

      if (ctxErr || !ctx) {
        console.error("[Worker] get_autoreply_context error:", ctxErr);
        await db.from("wa_processing_queue")
          .update({ status: "failed", last_error: "get_autoreply_context returned null", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      const c = ctx as AutoreplyContext;

      if (!c.auto_reply_enabled) {
        console.log("[Worker] auto_reply disabled — skipping job", queueId);
        await db.from("wa_processing_queue")
          .update({ status: "skipped", last_error: "auto_reply_enabled=false", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      if (!c.fonnte_token) {
        console.error("[Worker] fonnte_token not configured");
        await db.from("wa_processing_queue")
          .update({ status: "failed", last_error: "fonnte_token missing", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      // ── Smart Delay ───────────────────────────────────────────────────────
      const delayCfg: SmartDelayConfig = { ...DEFAULT_DELAY, ...(c.smart_delay_config ?? {}) };
      const delayMs = calcDelayMs(q.body, delayCfg);

      if (delayMs > 0) {
        console.log("[Worker] smart delay", delayMs, "ms for", q.phone);
        await sleep(delayMs);
      }

      // ── Winner check ──────────────────────────────────────────────────────
      const { data: isWinner } = await (db as any).rpc(
        "is_newest_pending_for_phone",
        { p_queue_id: queueId, p_phone: q.phone },
      );

      // Also check that no other entry is currently processing for this phone
      const { count: processingCount } = await db
        .from("wa_processing_queue")
        .select("id", { count: "exact", head: true })
        .eq("phone", q.phone)
        .eq("status", "processing")
        .neq("id", queueId);

      if (isWinner === false || (processingCount ?? 0) > 0) {
        console.log("[Worker] superseded — skipping AI reply for", q.phone);
        await db.from("wa_processing_queue")
          .update({ status: "skipped", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      // ── Re-fetch fresh messages (accumulate burst) ────────────────────────
      const { data: freshCtx } = await (db as any).rpc(
        "get_autoreply_context", { p_phone: q.phone },
      );
      const freshMessages: Array<{ direction: string; body: string }> =
        (freshCtx as AutoreplyContext | null)?.messages ?? c.messages;
      console.log("[Worker] message context:", freshMessages.length, "messages");

      // ── Load property + rooms ─────────────────────────────────────────────
      const { data: propRow } = await db.from("properties").select("*").limit(1).maybeSingle();
      const property = (propRow ?? {}) as Property;

      const { data: roomRows } = await db
        .from("room_types")
        .select("id, name, base_rate, capacity, bed_type, description")
        .order("base_rate");
      const rooms = (roomRows ?? []) as RoomType[];

      // ── Load SOP ──────────────────────────────────────────────────────────
      const cfg = mergeAiLabConfig(property.ai_lab_config);
      let sopText = "";
      if (cfg.tools["sop-knowledge"]?.enabled) {
        try {
          const { data: sopDocs } = await db
            .from("sop_documents")
            .select("name, content, source_url")
            .order("created_at", { ascending: true })
            .limit(40);
          const parts: string[] = [];
          for (const d of (sopDocs ?? []) as any[]) {
            const content = d.content?.trim();
            const url     = d.source_url?.trim();
            if (!content && !url) continue;
            const head = url ? `### ${d.name} (Tautan: ${url})` : `### ${d.name}`;
            parts.push(content ? `${head}\n${content}` : head);
          }
          sopText = parts.join("\n\n").slice(0, 8000);
        } catch (e) {
          console.warn("[Worker] SOP load error:", e);
        }
      }

      // ── Resolve AI credentials ────────────────────────────────────────────
      const explicitKey = property.ai_api_key?.trim();
      const lovableKey  = LOVABLE_API_KEY;
      const useLovable  = !explicitKey && !!lovableKey;
      const apiKey      = explicitKey || lovableKey;

      if (!apiKey) {
        console.error("[Worker] No AI API key configured");
        await db.from("wa_processing_queue")
          .update({ status: "failed", last_error: "No AI API key", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      const baseUrl = useLovable
        ? "https://ai.gateway.lovable.dev/v1"
        : (property.ai_base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
      const cfgModel = property.ai_model?.trim();
      const model    = useLovable
        ? (cfgModel?.includes("/") ? cfgModel : "google/gemini-2.5-flash")
        : cfgModel || "gpt-4o-mini";

      // ── Build system prompt ───────────────────────────────────────────────
      const systemPrompt = buildSystemPrompt(property, cfg, rooms, sopText);

      // ── Run AI orchestration ──────────────────────────────────────────────
      console.log("[Worker] running orchestration for", q.phone, "| model:", model);
      const { reply, toolsUsed } = await runOrchestration(
        freshMessages, systemPrompt, apiKey, baseUrl, model, db, rooms, property,
      );

      if (!reply) {
        console.error("[Worker] No reply generated");
        await db.from("wa_processing_queue")
          .update({ status: "failed", last_error: "AI returned no reply", updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      // ── Send via Fonnte ───────────────────────────────────────────────────
      const form = new URLSearchParams();
      form.append("target",  q.phone);
      form.append("message", reply);

      const sendRes = await fetch("https://api.fonnte.com/send", {
        method:  "POST",
        headers: { Authorization: c.fonnte_token },
        body:    form,
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.text().catch(() => "");
        console.error("[Worker] Fonnte send error:", sendRes.status, errBody);
        await db.from("wa_processing_queue")
          .update({ status: "failed", last_error: `Fonnte ${sendRes.status}: ${errBody}`, updated_at: new Date().toISOString() })
          .eq("id", queueId);
        return;
      }

      // ── Persist outbound + update thread ─────────────────────────────────
      const agent = toolsUsed.includes("Booking Engine")   ? "Front Office Agent"
                  : toolsUsed.includes("Room Availability") ? "Pricing Agent"
                  : "Front Office Agent";

      await (db as any).rpc("save_outbound_whatsapp", {
        p_thread_id: c.thread_id,
        p_body:      reply,
        p_metadata:  { agent, tools_used: toolsUsed },
      }).catch((e: unknown) => console.error("[Worker] save_outbound error:", e));

      await (db as any).rpc("update_thread_autoreply_meta", {
        p_thread_id:  c.thread_id,
        p_tools_used: toolsUsed,
      }).catch((e: unknown) => console.error("[Worker] update_meta error:", e));

      // ── Mark done ─────────────────────────────────────────────────────────
      await db.from("wa_processing_queue")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", queueId);

      console.log("[Worker] ✓ done | phone:", q.phone, "| agent:", agent, "| tools:", toolsUsed, "| delay:", delayMs, "ms");

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Worker] Unhandled error:", msg);
      await makeAdminClient()
        .from("wa_processing_queue")
        .update({ status: "failed", last_error: msg, updated_at: new Date().toISOString() })
        .eq("id", queueId)
        .catch(() => {});
    }
  };

  // Start async pipeline (non-blocking)
  processAsync();

  return new Response(JSON.stringify({ ok: true, queue_id: queueId }), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
});
