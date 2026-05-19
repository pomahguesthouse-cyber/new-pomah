import { createFileRoute } from "@tanstack/react-router";
import { supabasePublic, supabaseAdmin } from "@/integrations/supabase/client.server";

// Inlined from ai-lab.functions to avoid importing createServerFn in a route file.
const AGENT_KEYS = [
  "front-office",
  "pricing",
  "housekeeping",
  "maintenance",
  "finance",
  "manager",
] as const;

const AGENT_DEFAULTS: Record<string, string> = {
  "front-office":
    "Anda Front Office Agent Pomah Guesthouse. Tangani reservasi, check-in/check-out, dan pertanyaan umum tamu. Ramah, sapa tamu dengan 'Kak', jawab singkat dan jelas. Bantu cek ketersediaan kamar dan arahkan tamu untuk memesan.",
};

interface AgentConfig { enabled: boolean; autoReply: boolean; instructions: string; }
interface ToolConfig { enabled: boolean; note: string; }
interface AiLabConfig { agents: Record<string, AgentConfig>; tools: Record<string, ToolConfig>; }

function mergeAiLabConfig(raw: unknown): AiLabConfig {
  const c = (raw ?? {}) as Partial<AiLabConfig>;
  const agents: Record<string, AgentConfig> = {};
  for (const k of AGENT_KEYS) {
    const a = c.agents?.[k];
    agents[k] = {
      enabled: a?.enabled ?? true,
      autoReply: a?.autoReply ?? false,
      instructions: a?.instructions?.trim() ? a.instructions : (AGENT_DEFAULTS[k] ?? ""),
    };
  }
  const TOOL_KEYS = ["pms-database", "room-availability", "sop-knowledge", "pricing-engine", "faq-memory"] as const;
  const tools: Record<string, ToolConfig> = {};
  for (const k of TOOL_KEYS) {
    const t = c.tools?.[k];
    tools[k] = { enabled: t?.enabled ?? true, note: t?.note ?? "" };
  }
  return { agents, tools };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client;
}

const MONTHS_ID = [
  "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
];
function fmtDateID(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_ID[m - 1]} ${y}`;
}

async function pickAvailableRoom(roomTypeId: string, checkIn: string, checkOut: string): Promise<string | null> {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id, number")
    .eq("room_type_id", roomTypeId)
    .order("number");
  const roomRows = (rooms ?? []) as Record<string, unknown>[];
  if (roomRows.length === 0) return null;

  const { data: activeBookings } = await supabaseAdmin
    .from("bookings")
    .select("id")
    .in("status", ["pending", "confirmed", "checked_in"])
    .lt("check_in", checkOut)
    .gt("check_out", checkIn);
  const activeIds = (activeBookings ?? []).map((b) => (b as Record<string, unknown>).id as string);
  if (activeIds.length === 0) return roomRows[0].id as string;

  const { data: occ } = await supabaseAdmin
    .from("booking_rooms")
    .select("room_id")
    .not("room_id", "is", null)
    .in("booking_id", activeIds);
  const taken = new Set((occ ?? []).map((r) => (r as Record<string, unknown>).room_id));
  const free = roomRows.find((r) => !taken.has(r.id));
  return free ? (free.id as string) : null;
}

/**
 * Full AI reply engine — mirrors the webchat `chatWithAI` logic exactly.
 * Accepts the WhatsApp message history and returns the bot's next reply.
 */
async function generateAiReply(
  waMessages: Array<{ direction: string; body: string }>,
): Promise<{ reply: string | null; toolsUsed: string[] }> {
  const { data: prop } = await supabasePublic
    .from("properties")
    .select("*")
    .limit(1)
    .maybeSingle();
  const p = (prop ?? {}) as Record<string, unknown>;

  const explicitKey = (p.ai_api_key as string | undefined)?.trim();
  const lovableKey = process.env.LOVABLE_API_KEY?.trim();
  const useLovable = !explicitKey && !!lovableKey;
  const key = explicitKey || lovableKey;
  if (!key) {
    console.error("[AutoReply] No AI key configured");
    return { reply: null, toolsUsed: [] };
  }

  const configuredModel = (p.ai_model as string | undefined)?.trim();
  const baseUrl = useLovable
    ? "https://ai.gateway.lovable.dev/v1"
    : ((p.ai_base_url as string | undefined) || "https://api.openai.com/v1")
        .trim()
        .replace(/\/+$/, "");
  const model = useLovable
    ? configuredModel && configuredModel.includes("/")
      ? configuredModel
      : "google/gemini-2.5-flash"
    : configuredModel || "gpt-4o-mini";

  const cfg = mergeAiLabConfig(p.ai_lab_config);

  const { data: rooms } = await supabasePublic
    .from("room_types")
    .select("id, name, base_rate, capacity, bed_type, description")
    .order("base_rate");
  const roomRows = (rooms ?? []) as Record<string, unknown>[];

  const agentLines = AGENT_KEYS.filter(
    (k) => cfg.agents[k]?.enabled && cfg.agents[k]?.instructions?.trim(),
  ).map((k) => `• ${k}: ${cfg.agents[k].instructions.trim()}`);

  const roomLines = roomRows.map(
    (rr) =>
      `• ${rr.name} — Rp ${Number(rr.base_rate ?? 0).toLocaleString("id-ID")}/malam, kapasitas ${
        rr.capacity ?? "-"
      } tamu${rr.bed_type ? `, ${rr.bed_type}` : ""}`,
  );

  let sopText = "";
  if (cfg.tools["sop-knowledge"]?.enabled) {
    const { data: sopDocs } = await db(supabaseAdmin)
      .from("sop_documents")
      .select("name, content, source_url")
      .order("created_at", { ascending: true })
      .limit(40);
    const parts: string[] = [];
    for (const d of sopDocs ?? []) {
      const dd = d as Record<string, unknown>;
      const c = (dd.content as string | undefined)?.trim();
      const url = (dd.source_url as string | undefined)?.trim();
      if (!c && !url) continue;
      const head = url ? `### ${dd.name as string} (Tautan: ${url})` : `### ${dd.name as string}`;
      parts.push(c ? `${head}\n${c}` : head);
    }
    sopText = parts.join("\n\n").slice(0, 8000);
  }

  const todayStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const nextDay = (d: string) =>
    new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

  const system = [
    `Anda adalah asisten AI untuk ${(p.name as string) ?? "Pomah Guesthouse"}, sebuah penginapan. Anda membalas pesan WhatsApp.`,
    "Jawab ramah, singkat dan jelas dalam Bahasa Indonesia. Sapa tamu dengan 'Kak'.",
    `Hari ini tanggal ${fmtDateID(todayStr)}.`,
    "FORMAT TANGGAL: selalu tampilkan tanggal ke tamu dalam format Indonesia, " +
      "contoh '19 Mei 2026'. JANGAN tampilkan format YYYY-MM-DD.",
    agentLines.length ? `Panduan tiap agent:\n${agentLines.join("\n")}` : "",
    roomLines.length
      ? `Data kamar (tarif & kapasitas — jangan mengarang):\n${roomLines.join("\n")}`
      : "",
    sopText
      ? "Basis Pengetahuan SOP (rujuk untuk menjawab kebijakan, prosedur, lokasi & info " +
        "lainnya). Sebagian entri menyertakan '(Tautan: <url>)'. Bila tamu meminta link, " +
        "lokasi, peta/Google Maps, alamat, atau panduan tertentu, KIRIMKAN URL lengkap dari " +
        "entri SOP yang relevan. Tulis URL-nya POLOS dan UTUH — salin persis, jangan " +
        "dipotong, jangan dibungkus tanda kurung/markdown, dan jangan beri tanda baca " +
        `menempel di akhir URL. Jangan pernah mengarang URL.\n${sopText}`
      : "",
    "KETERSEDIAAN KAMAR: Anda memiliki tool `check_room_availability`. Setiap kali tamu " +
      "menanyakan kamar yang tersedia/kosong (hari ini atau tanggal tertentu) atau ingin " +
      "booking, WAJIB panggil tool ini lebih dulu — jangan pernah menebak ketersediaan. " +
      "Jika tamu tidak menyebut tanggal, anggap untuk hari ini (check-in hari ini, 1 malam).",
    "Saat menyampaikan hasil tool: awali dengan baris 'Ketersediaan kamar untuk <tanggal>'. " +
      "Lalu tiap tipe kamar satu baris — gunakan ✅ bila ada kamar tersedia atau ❌ bila penuh, " +
      "diikuti nama kamar, jumlah kamar tersedia, dan harga per malam. " +
      "Tutup dengan ajakan memilih kamar untuk lanjut booking.",
    "BOOKING VIA CHAT: Anda dapat membuatkan pesanan kamar langsung. Alurnya: (1) cek " +
      "ketersediaan dengan tool, (2) setelah tamu memilih satu tipe kamar, minta nama " +
      "lengkap, email, dan nomor HP tamu, (3) setelah SEMUA data lengkap baru panggil tool " +
      "`create_booking`. JANGAN pernah mengarang data tamu — bila ada yang belum diberikan, " +
      "tanyakan dulu dan jangan panggil tool.",
    "Setelah `create_booking` berhasil: sampaikan sapaan dengan nama tamu, kode booking, " +
      "total harga, lalu instruksi transfer ke rekening (bank, nomor rekening, atas nama) " +
      "bila tersedia, dan minta tamu mengirim bukti pembayaran. Bila info rekening kosong, " +
      "beritahu tamu bahwa detail pembayaran akan dikirim staf. Bila tool gagal, sampaikan " +
      "alasannya dengan sopan.",
    "Ini percakapan WhatsApp — gunakan format teks biasa, hindari Markdown (jangan pakai *, _, atau #).",
  ]
    .filter(Boolean)
    .join("\n\n");

  const rpcClient = supabasePublic as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: { room_type_id: string; total: number; taken: number; available: number }[] | null;
      error: { message: string } | null;
    }>;
  };

  const runAvailability = async (rawArgs: Record<string, unknown>): Promise<string> => {
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const checkIn = isDate(rawArgs.check_in) ? rawArgs.check_in : todayStr;
    let checkOut = isDate(rawArgs.check_out) ? rawArgs.check_out : nextDay(checkIn);
    if (checkOut <= checkIn) checkOut = nextDay(checkIn);
    const { data: rows } = await rpcClient.rpc("room_type_availability_detail", {
      p_check_in: checkIn,
      p_check_out: checkOut,
    });
    const byId = new Map((rows ?? []).map((r) => [r.room_type_id, r]));
    const kamar = roomRows.map((rr) => {
      const d = byId.get(rr.id as string);
      return {
        nama: rr.name,
        harga_per_malam: Number(rr.base_rate ?? 0),
        kamar_tersedia: d ? d.available : null,
        total_kamar: d ? d.total : null,
        catatan: d ? undefined : "jumlah kamar belum diatur di sistem",
      };
    });
    return JSON.stringify({
      check_in: checkIn,
      check_out: checkOut,
      tanggal: fmtDateID(checkIn),
      periode: `${fmtDateID(checkIn)} – ${fmtDateID(checkOut)}`,
      kamar,
    });
  };

  const runCreateBooking = async (raw: Record<string, unknown>): Promise<string> => {
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const fullName = str(raw.full_name);
    const email = str(raw.email);
    const phone = str(raw.phone);
    const roomTypeName = str(raw.room_type).toLowerCase();
    const checkIn = isDate(raw.check_in) ? raw.check_in : "";
    const checkOut = isDate(raw.check_out) ? raw.check_out : "";
    const adults = Math.max(1, Math.min(8, Number(raw.adults) || 1));
    const children = Math.max(0, Math.min(8, Number(raw.children) || 0));

    if (!fullName || !email || !phone)
      return JSON.stringify({ ok: false, error: "Data tamu belum lengkap (nama, email, HP)." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return JSON.stringify({ ok: false, error: "Format email tidak valid." });
    if (!checkIn || !checkOut || checkOut <= checkIn)
      return JSON.stringify({ ok: false, error: "Tanggal check-in/check-out tidak valid." });

    const rt =
      roomRows.find((r) => String(r.name).toLowerCase() === roomTypeName) ??
      roomRows.find((r) => {
        const n = String(r.name).toLowerCase();
        return n.includes(roomTypeName) || roomTypeName.includes(n);
      });
    if (!rt)
      return JSON.stringify({
        ok: false,
        error: `Tipe kamar "${str(raw.room_type)}" tidak ditemukan.`,
      });

    const { data: availRows } = await rpcClient.rpc("room_type_availability_detail", {
      p_check_in: checkIn,
      p_check_out: checkOut,
    });
    const detail = (availRows ?? []).find((r) => r.room_type_id === (rt.id as string));
    if (detail && detail.available < 1)
      return JSON.stringify({
        ok: false,
        error: `${rt.name} sudah penuh untuk tanggal tersebut.`,
      });

    const propId = p.id as string | undefined;
    if (!propId) return JSON.stringify({ ok: false, error: "Properti belum dikonfigurasi." });

    const nights = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
    );
    const rate = Number(rt.base_rate ?? 0);
    const total = rate * nights;

    const { data: guest, error: gerr } = await supabaseAdmin
      .from("guests")
      .insert({ full_name: fullName, email, phone })
      .select("id")
      .single();
    if (gerr || !guest)
      return JSON.stringify({
        ok: false,
        error: `Gagal menyimpan data tamu: ${gerr?.message ?? "tidak diketahui"}`,
      });

    const { data: booking, error: berr } = await supabaseAdmin
      .from("bookings")
      .insert({
        property_id: propId,
        guest_id: guest.id,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        adults,
        children,
        total_amount: total,
        source: "direct",
        status: "pending",
      })
      .select("id, reference_code")
      .single();
    if (berr || !booking)
      return JSON.stringify({
        ok: false,
        error: `Gagal membuat booking: ${berr?.message ?? "tidak diketahui"}`,
      });

    const assignedRoomId = await pickAvailableRoom(rt.id as string, checkIn, checkOut);
    const { error: brErr } = await supabaseAdmin.from("booking_rooms").insert({
      booking_id: booking.id,
      room_id: assignedRoomId,
      room_type_id: rt.id as string,
      nightly_rate: rate,
    });
    if (brErr)
      return JSON.stringify({
        ok: false,
        error: `Gagal menyimpan detail kamar: ${brErr.message}`,
      });

    return JSON.stringify({
      ok: true,
      reference_code: booking.reference_code,
      room_type: rt.name,
      check_in: checkIn,
      check_out: checkOut,
      check_in_tampil: fmtDateID(checkIn),
      check_out_tampil: fmtDateID(checkOut),
      nights,
      nightly_rate: rate,
      total,
      guest: { full_name: fullName, email, phone },
      pembayaran: {
        bank: (p.payment_bank_name as string | undefined) || null,
        no_rekening: (p.payment_account_number as string | undefined) || null,
        atas_nama: (p.payment_account_holder as string | undefined) || null,
      },
    });
  };

  const tools = [
    {
      type: "function",
      function: {
        name: "check_room_availability",
        description:
          "Cek ketersediaan kamar nyata (jumlah kamar kosong per tipe) untuk rentang tanggal. Gunakan saat tamu menanyakan kamar tersedia/kosong atau ingin booking.",
        parameters: {
          type: "object",
          properties: {
            check_in: {
              type: "string",
              description: "Tanggal check-in format YYYY-MM-DD. Kosongkan untuk hari ini.",
            },
            check_out: {
              type: "string",
              description:
                "Tanggal check-out format YYYY-MM-DD. Kosongkan untuk sehari setelah check-in.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_booking",
        description:
          "Buat pesanan/booking kamar untuk tamu. Panggil HANYA setelah tamu memilih tipe kamar dan memberikan nama lengkap, email, dan nomor HP. Jangan panggil bila data belum lengkap.",
        parameters: {
          type: "object",
          properties: {
            room_type: { type: "string", description: "Nama tipe kamar yang dipilih tamu." },
            full_name: { type: "string", description: "Nama lengkap tamu." },
            email: { type: "string", description: "Alamat email tamu." },
            phone: { type: "string", description: "Nomor HP/WhatsApp tamu." },
            check_in: { type: "string", description: "Tanggal check-in format YYYY-MM-DD." },
            check_out: { type: "string", description: "Tanggal check-out format YYYY-MM-DD." },
            adults: { type: "number", description: "Jumlah tamu dewasa. Default 1." },
            children: { type: "number", description: "Jumlah anak. Default 0." },
          },
          required: ["room_type", "full_name", "email", "phone", "check_in", "check_out"],
        },
      },
    },
  ];

  // Convert WhatsApp message history to OpenAI format (newest last for proper context).
  // The RPC returns messages in ascending order already.
  const TOOL_LABELS: Record<string, string> = {
    check_room_availability: "Room Availability",
    create_booking: "Booking Engine",
  };

  const openAiMessages: Record<string, unknown>[] = [
    { role: "system", content: system },
    ...waMessages.map((m) => ({
      role: m.direction === "in" ? "user" : "assistant",
      content: m.body,
    })),
  ];

  const toolsUsed = new Set<string>();

  try {
    for (let turn = 0; turn < 4; turn++) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.6,
          max_tokens: 600,
          messages: openAiMessages,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!res.ok) {
        console.error("[AutoReply] AI gateway error", res.status, await res.text());
        return { reply: null, toolsUsed: [] };
      }

      let json: {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: {
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
        error?: { message?: string };
      };
      try {
        json = await res.json();
      } catch {
        return { reply: null, toolsUsed: [] };
      }

      const msg = json.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls ?? [];

      if (toolCalls.length) {
        openAiMessages.push(msg as Record<string, unknown>);
        for (const tc of toolCalls) {
          let out = JSON.stringify({ error: "unknown tool" });
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            args = {};
          }
          if (tc.function?.name === "check_room_availability") {
            out = await runAvailability(args);
            toolsUsed.add(TOOL_LABELS.check_room_availability);
          } else if (tc.function?.name === "create_booking") {
            out = await runCreateBooking(args);
            toolsUsed.add(TOOL_LABELS.create_booking);
          }
          openAiMessages.push({ role: "tool", tool_call_id: tc.id, content: out });
        }
        continue;
      }

      const reply = msg?.content?.trim();
      if (reply) return { reply, toolsUsed: Array.from(toolsUsed) };

      const detail = json.error?.message ?? `HTTP ${res.status}`;
      console.error("[AutoReply] LLM error:", detail);
      return { reply: null, toolsUsed: [] };
    }
    console.error("[AutoReply] tool loop limit reached");
    return { reply: null, toolsUsed: [] };
  } catch (e) {
    console.error("[AutoReply] fetch error", e);
    return { reply: null, toolsUsed: [] };
  }
}

async function sendViaFonnte(token: string, phone: string, message: string): Promise<boolean> {
  try {
    const form = new URLSearchParams();
    form.append("target", phone);
    form.append("message", message);
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token },
      body: form,
    });
    if (!res.ok) console.error("[AutoReply] Fonnte send error", await res.text());
    return res.ok;
  } catch (e) {
    console.error("[AutoReply] Fonnte fetch error", e);
    return false;
  }
}

function verifyToken(request: Request): boolean {
  const expected = process.env.FONNTE_WEBHOOK_TOKEN;
  if (!expected) return true;

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === expected) {
    return true;
  }

  const url = new URL(request.url);
  if (url.searchParams.get("token") === expected) {
    return true;
  }

  return false;
}

export const Route = createFileRoute("/api/fonnte")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        const challenge = url.searchParams.get("challenge");
        if (challenge && verifyToken(request)) {
          return new Response(challenge, { status: 200 });
        }

        if (url.searchParams.get("debug") === "1") {
          const report: Record<string, unknown> = {
            env_token_set: !!process.env.FONNTE_WEBHOOK_TOKEN,
            env_supabase_url_set: !!process.env.SUPABASE_URL,
            env_supabase_key_set: !!process.env.SUPABASE_PUBLISHABLE_KEY,
            env_lovable_api_key_set: !!process.env.LOVABLE_API_KEY,
          };

          try {
            const { error } = await supabasePublic.rpc("receive_whatsapp_message", {
              p_phone: "debug_test_000",
              p_name: "Debug Test",
              p_body: "[DEBUG] Webhook test message — safe to delete",
            });
            report.rpc_receive_ok = !error;
            report.rpc_receive_error = error ? { code: error.code, message: error.message } : null;
          } catch (e) {
            report.rpc_receive_ok = false;
            report.rpc_receive_error = String(e);
          }

          try {
            const { data: ctx, error } = await supabasePublic.rpc("get_autoreply_context", {
              p_phone: "debug_test_000",
            });
            report.rpc_autoreply_ok = !error;
            report.rpc_autoreply_error = error ? { code: error.code, message: error.message } : null;
            if (ctx) {
              const c = ctx as Record<string, unknown>;
              report.auto_reply_enabled = c.auto_reply_enabled;
              report.fonnte_token_set = !!c.fonnte_token;
              report.instructions_set = !!(c.instructions as string)?.length;
              report.message_count = Array.isArray(c.messages) ? c.messages.length : 0;
            }
          } catch (e) {
            report.rpc_autoreply_ok = false;
            report.rpc_autoreply_error = String(e);
          }

          return new Response(JSON.stringify(report, null, 2), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response("Webhook is active", { status: 200 });
      },
      POST: async ({ request }) => {
        const reqUrl = new URL(request.url);
        const tokenInUrl = reqUrl.searchParams.get("token");
        const envToken = process.env.FONNTE_WEBHOOK_TOKEN;
        console.log("[Fonnte Webhook] POST received", {
          token_in_url: tokenInUrl ? tokenInUrl.slice(0, 8) + "..." : null,
          env_token_set: !!envToken,
          token_match: !envToken || tokenInUrl === envToken,
          content_type: request.headers.get("content-type"),
        });

        if (!verifyToken(request)) {
          console.warn("[Fonnte Webhook] token mismatch — processing anyway");
        }

        try {
          const rawText = await request.text();
          console.log("[Fonnte Webhook] raw body:", rawText.slice(0, 300));

          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(rawText);
          } catch {
            const params = new URLSearchParams(rawText);
            for (const [k, v] of params.entries()) {
              body[k] = v;
            }
          }

          const sender =
            (body.sender as string) || (body.pengirim as string) || undefined;
          const message =
            (body.message as string) || (body.pesan as string) || undefined;
          const name =
            (body.name as string) || (body.pushname as string) || sender;

          console.log("[Fonnte Webhook] parsed fields", {
            sender,
            message: message?.slice(0, 50),
            name,
          });

          if (!sender || !message) {
            console.log("[Fonnte Webhook] missing sender or message, ignoring");
            return new Response("OK", { status: 200 });
          }

          const { error } = await supabasePublic.rpc("receive_whatsapp_message", {
            p_phone: sender,
            p_name: name ?? sender,
            p_body: message,
          });

          if (error) {
            console.error("[Fonnte Webhook] RPC error:", error);
            return new Response("Error", { status: 500 });
          }

          // Auto-reply using the full AI chat engine
          try {
            const { data: ctx } = await supabasePublic.rpc("get_autoreply_context", {
              p_phone: sender,
            });

            if (ctx && (ctx as Record<string, unknown>).auto_reply_enabled) {
              const c = ctx as {
                thread_id: string;
                fonnte_token: string;
                messages: Array<{ direction: string; body: string }>;
              };

              const { reply, toolsUsed } = await generateAiReply(c.messages);
              if (reply) {
                const sent = await sendViaFonnte(c.fonnte_token, sender, reply);
                if (sent) {
                  await supabasePublic.rpc("save_outbound_whatsapp", {
                    p_thread_id: c.thread_id,
                    p_body: reply,
                  });
                  // Persist which tools were actually called so the sidebar can show them.
                  await (supabasePublic as unknown as {
                    rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
                  }).rpc("update_thread_autoreply_meta", {
                    p_thread_id: c.thread_id,
                    p_tools_used: toolsUsed,
                  });
                  console.log("[AutoReply] sent to", sender, "tools:", toolsUsed, "reply:", reply.slice(0, 60));
                }
              }
            }
          } catch (autoErr) {
            console.error("[AutoReply] error", autoErr);
          }

          return new Response("OK", { status: 200 });
        } catch (e) {
          console.error("[Fonnte Webhook Error]", e);
          return new Response("Error", { status: 500 });
        }
      },
    },
  },
});
