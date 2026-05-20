/**
 * AI LAB → Training.
 *
 * A conversation simulator: type a guest (or manager) message, the AI
 * orchestration flow lights up, and a draft response is generated from
 * live room data. Promoting a result stores it as a training example
 * the chatbot uses as a basis for future answers.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Loader2, Send, Trash2 } from "lucide-react";
import { listRoomTypes } from "@/admin/functions/bookings.functions";
import { chatWithAI } from "@/public/functions/public.functions";
import { saveTrainingExample } from "@/admin/modules/training/training.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type RoomTypeRow = { id: string; name: string; base_rate?: number | string | null };

/** Build a draft chatbot reply — guest- or manager-oriented by role. */
function composeResponse(rooms: RoomTypeRow[], role: "tamu" | "manager"): string {
  if (rooms.length === 0) {
    return role === "manager"
      ? "Halo, Pak/Bu Manager. Belum ada data kamar terdaftar untuk ditinjau."
      : "Halo, Kak 😊 Mohon maaf, untuk saat ini belum ada data kamar yang bisa kami tampilkan.";
  }
  if (role === "manager") {
    const lines = rooms.map(
      (r, i) =>
        `${i + 1}. ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam`,
    );
    return [
      "Baik, Pak/Bu Manager. Berikut ringkasan inventori kamar:",
      ...lines,
      "",
      `Total ${rooms.length} tipe kamar aktif. Beri tahu bila ingin menyesuaikan tarif atau promo.`,
    ].join("\n");
  }
  const lines = rooms.map(
    (r, i) =>
      `${i + 1}. Kamar ${r.name} di Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")},-/malam`,
  );
  return [
    "Halo, Kak 😊 Kamar yang tersedia hari ini:",
    ...lines,
    "",
    "Oh ya, hari ini ada PROMO DISKON 20% untuk pemesanan kamar. Tertarik pesan kamar yang mana, Kak?",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Orchestration flow diagram                                          */
/* ------------------------------------------------------------------ */

/** The 6 specialized agents, in routing order. */
const FLOW_AGENTS: { key: string; label: string; roles: ("tamu" | "manager")[] }[] = [
  { key: "front-office", label: "Front Office", roles: ["tamu"] },
  { key: "pricing", label: "Pricing", roles: ["tamu", "manager"] },
  { key: "customer-care", label: "Customer Care", roles: ["tamu"] },
  { key: "maintenance", label: "Maintenance", roles: ["tamu"] },
  { key: "finance", label: "Finance", roles: ["tamu", "manager"] },
  { key: "manager", label: "Manager", roles: ["manager"] },
];

/** The knowledge/tool sources agents can call. */
const FLOW_TOOLS = ["PMS Database", "Room Availability", "SOP", "Pricing Engine", "FAQ Memory"];

/** A labelled stage box in the vertical flow. */
function FlowStage({
  label,
  sub,
  active,
  tone = "dark",
}: {
  label: string;
  sub?: string;
  active: boolean;
  tone?: "dark" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-1.5 text-center transition",
        tone === "dark"
          ? "bg-teal-800 text-white border-teal-800"
          : "bg-blue-600 text-white border-blue-600",
        active ? "ring-2 ring-emerald-400 ring-offset-1" : "opacity-90",
      )}
    >
      <p className="text-xs font-semibold">{label}</p>
      {sub ? <p className="text-[9px] font-medium text-white/70">{sub}</p> : null}
    </div>
  );
}

/** Vertical connector between stages — glows emerald once a reply exists. */
function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center">
      <div className={cn("h-2.5 w-0.5", active ? "bg-emerald-500" : "bg-stone-300")} />
    </div>
  );
}

/**
 * Full orchestration map: an inbound message is classified by the
 * orchestrator, routed to one or more specialized agents, those agents
 * pull from shared knowledge/tools, and a composer returns the reply.
 */
function FlowDiagram({ role, responded }: { role: "tamu" | "manager"; responded: boolean }) {
  const a = responded;
  return (
    <div className="mx-auto max-w-[240px]">
      {/* Inbound */}
      <FlowStage
        label="Pesan Masuk"
        sub={role === "manager" ? "Saluran: Manager" : "Saluran: Tamu / Webchat"}
        active={a}
      />
      <FlowArrow active={a} />

      {/* Classifier */}
      <FlowStage label="Classifier" sub="Deteksi intent pesan" active={a} />
      <FlowArrow active={a} />

      {/* Router */}
      <FlowStage label="Router" sub="Tentukan agent tujuan" active={a} />
      <FlowArrow active={a} />

      {/* Specialized Prompt */}
      <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        Specialized Prompt
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {FLOW_AGENTS.map((ag) => {
          const routed = a && ag.roles.includes(role);
          return (
            <div
              key={ag.key}
              className={cn(
                "rounded-md border px-1.5 py-1.5 text-center text-[10px] font-semibold transition",
                routed
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300"
                  : "border-stone-200 bg-stone-50 text-stone-400",
              )}
            >
              {ag.label}
            </div>
          );
        })}
      </div>
      <FlowArrow active={a} />

      {/* Specialized Tools */}
      <div
        className={cn(
          "rounded-lg border px-3 py-2.5 transition",
          a ? "border-sky-300 bg-sky-50" : "border-stone-200 bg-stone-50 opacity-90",
        )}
      >
        <p
          className={cn(
            "mb-1.5 text-center text-[11px] font-semibold",
            a ? "text-sky-800" : "text-stone-500",
          )}
        >
          Specialized Tools
        </p>
        <div className="flex flex-wrap justify-center gap-1">
          {FLOW_TOOLS.map((t) => (
            <span
              key={t}
              className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-medium",
                a ? "bg-white text-sky-700" : "bg-white text-stone-400",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <FlowArrow active={a} />

      {/* Composer */}
      <FlowStage
        label="Response Composer"
        sub="Gabung jawaban & nada bicara"
        tone="accent"
        active={a}
      />
      <FlowArrow active={a} />

      {/* Outbound */}
      <FlowStage label={role === "manager" ? "Balasan ke Manager" : "Balasan ke Tamu"} active={a} />
    </div>
  );
}

/* ================================================================== */
/* Training view                                                       */
/* ================================================================== */

export function TrainingView() {
  const fnRooms = useServerFn(listRoomTypes);
  const { data: roomData } = useQuery({ queryKey: ["room-types"], queryFn: () => fnRooms() });
  const rooms = (roomData?.roomTypes ?? []) as RoomTypeRow[];

  const fnSave = useServerFn(saveTrainingExample);
  const fnChat = useServerFn(chatWithAI);

  const [role, setRole] = useState<"tamu" | "manager">("tamu");
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Live: run the real LLM, falling back to the templated reply.
  const send = async () => {
    const text = input.trim();
    if (!text) {
      toast.error("Tulis pesan dulu");
      return;
    }
    if (sending) return;
    setSending(true);
    setResponse("");
    try {
      const content = role === "manager" ? `[Pesan dari Manager] ${text}` : text;
      const res = await fnChat({ data: { messages: [{ role: "user", content }] } });
      if (res.error) console.warn("[Training AI] LLM error:", res.error);
      setResponse(res.reply || composeResponse(rooms, role));
    } catch (e) {
      console.warn("[Training AI] gagal:", (e as Error).message);
      setResponse(composeResponse(rooms, role));
    } finally {
      setSending(false);
    }
  };

  const persist = async (accepted: boolean) => {
    if (!input.trim() || !response) {
      toast.error("Belum ada percakapan untuk disimpan");
      return;
    }
    setSaving(true);
    try {
      await fnSave({ data: { userMessage: input.trim(), aiResponse: response, accepted } });
      toast.success(
        accepted ? "Disimpan sebagai dasar jawaban AI" : "Ditandai sebagai contoh ditolak",
      );
      setInput("");
      setResponse("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main area — orchestration diagram */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight">Training — Simulasi Percakapan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Uji percakapan dan promosikan hasil terbaik. Yang dipromosikan dipakai AI chatbot
              sebagai dasar jawaban.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-white p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Alur Orkestrasi AI
            </p>
            <FlowDiagram role={role} responded={!!response} />
          </div>
        </div>
      </div>

      {/* Right sidebar — simulation panel */}
      <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-white p-5">
        <div>
          <p className="mb-2 text-sm font-semibold">Simulasi Chat</p>
          <div className="flex gap-4">
            {(["tamu", "manager"] as const).map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="accent-teal-700"
                />
                <span className="capitalize">{r}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Input */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-stone-600">Input</p>
          <div className="rounded-lg border border-border p-2">
            <Textarea
              rows={3}
              value={input}
              placeholder={
                role === "tamu"
                  ? "Halo, mau tanya hari ini kamar ready apa ya?"
                  : "Pesan dari manager…"
              }
              className="border-0 p-1 shadow-none focus-visible:ring-0"
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                className="h-8 bg-orange-500 text-white hover:bg-orange-600"
                onClick={() => {
                  setInput("");
                  setResponse("");
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Hapus
              </Button>
              <Button
                size="sm"
                disabled={sending}
                className="h-8 bg-teal-700 text-white hover:bg-teal-800"
                onClick={send}
              >
                {sending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1 h-3.5 w-3.5" />
                )}
                {sending ? "Mengirim…" : "Kirim"}
              </Button>
            </div>
          </div>
        </div>

        {/* Response */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-stone-600">Response</p>
          <div className="min-h-[160px] whitespace-pre-line rounded-lg border border-border bg-stone-50 p-3 text-sm text-stone-700">
            {sending ? (
              <span className="flex items-center gap-2 text-stone-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Menghubungi AI…
              </span>
            ) : (
              response || (
                <span className="text-stone-400">
                  Tekan “Kirim” untuk menjalankan AI secara live.
                </span>
              )
            )}
          </div>
        </div>

        {/* Promote / reject */}
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            disabled={saving || !response}
            className="h-8 bg-orange-500 text-white hover:bg-orange-600"
            onClick={() => persist(false)}
          >
            Tolak
          </Button>
          <Button
            size="sm"
            disabled={saving || !response}
            className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => persist(true)}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="h-3.5 w-3.5" />
            )}
            Promote
          </Button>
        </div>
      </aside>
    </div>
  );
}
