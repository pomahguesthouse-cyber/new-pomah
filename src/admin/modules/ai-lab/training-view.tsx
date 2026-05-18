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
import { saveTrainingExample } from "@/admin/modules/training/training.functions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type RoomTypeRow = { id: string; name: string; base_rate?: number | string | null };

/** Build a draft chatbot reply from the room types. */
function composeResponse(rooms: RoomTypeRow[]): string {
  if (rooms.length === 0) {
    return "Halo, Kak 😊 Mohon maaf, untuk saat ini belum ada data kamar yang bisa kami tampilkan.";
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
/* Flow diagram                                                        */
/* ------------------------------------------------------------------ */

const FLOW_TONES: Record<string, string> = {
  dark: "bg-teal-800 text-white border-teal-800",
  blue: "bg-blue-600 text-white border-blue-600",
  light: "bg-sky-100 text-sky-800 border-sky-300",
};

function FlowBox({
  label,
  tone,
  active,
}: {
  label: string;
  tone: keyof typeof FLOW_TONES;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-center text-sm font-semibold transition",
        FLOW_TONES[tone],
        active ? "ring-2 ring-emerald-400 ring-offset-2" : "opacity-90",
      )}
    >
      {label}
    </div>
  );
}

function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-1">
      <div className={cn("h-5 w-0.5", active ? "bg-emerald-500" : "bg-stone-300")} />
    </div>
  );
}

function FlowDiagram({ active, intent }: { active: boolean; intent: string }) {
  return (
    <div className="mx-auto max-w-xs">
      <div className="flex items-start gap-3">
        <FlowBox label="ORCHESTRATOR" tone="dark" active={active} />
        <div className="pt-1 text-xs">
          <p className="font-semibold text-stone-500">Intent :</p>
          <p className="text-teal-700">{intent || "—"}</p>
        </div>
      </div>
      <FlowArrow active={active} />
      <FlowBox label="Front Office Agent" tone="dark" active={active} />
      <FlowArrow active={active} />
      <FlowBox label="Pricing Agent" tone="blue" active={active} />
      <FlowArrow active={active} />
      <div className="grid grid-cols-2 gap-3">
        <FlowBox label="Promo" tone="light" active={active} />
        <FlowBox label="Room Availability" tone="light" active={active} />
      </div>
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

  const [role, setRole] = useState<"tamu" | "manager">("tamu");
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);

  const intent = response ? "Kamar, ready, hari ini" : input.trim() ? "Menganalisa…" : "";

  const send = () => {
    if (!input.trim()) {
      toast.error("Tulis pesan dulu");
      return;
    }
    setResponse(composeResponse(rooms));
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
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold tracking-tight">Training — Simulasi Percakapan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Uji percakapan dan promosikan hasil terbaik. Yang dipromosikan dipakai AI chatbot
            sebagai dasar jawaban.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Flow diagram */}
          <div className="rounded-xl border border-border bg-white p-6">
            <p className="mb-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Alur Orkestrasi AI
            </p>
            <FlowDiagram active={!!response} intent={intent} />
          </div>

          {/* Simulation panel */}
          <div className="space-y-4 rounded-xl border border-border bg-white p-6">
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
                    className="h-8 bg-teal-700 text-white hover:bg-teal-800"
                    onClick={send}
                  >
                    <Send className="mr-1 h-3.5 w-3.5" />
                    Kirim
                  </Button>
                </div>
              </div>
            </div>

            {/* Response */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-stone-600">Response</p>
              <div className="min-h-[160px] whitespace-pre-line rounded-lg border border-border bg-stone-50 p-3 text-sm text-stone-700">
                {response || (
                  <span className="text-stone-400">
                    Tekan “Kirim” untuk membuat draft jawaban AI.
                  </span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
