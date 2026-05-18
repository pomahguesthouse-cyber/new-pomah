/**
 * Public AI webchat widget.
 *
 * A floating chat bubble on the homepage. Guests can ask about rooms,
 * prices, availability, facilities and location; the assistant answers
 * from live room data — the same response engine the AI LAB Training
 * simulator uses.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, X, Send } from "lucide-react";
import { chatWithAI } from "@/public/functions/public.functions";
import { cn } from "@/lib/utils";

type ChatMsg = { who: "bot" | "user"; text: string };
type Room = { name: string; base_rate?: number | string | null };

/** Rule-based reply engine driven by the property's live room data. */
function botReply(input: string, rooms: Room[]): string {
  const t = input.toLowerCase();
  const roomList = rooms.length
    ? rooms
        .map((r) => `• ${r.name} — Rp ${Number(r.base_rate ?? 0).toLocaleString("id-ID")}/malam`)
        .join("\n")
    : "Maaf, data kamar belum tersedia.";

  if (/\b(halo|hai|hi|pagi|siang|sore|malam|assalam)/.test(t)) {
    return "Halo, Kak! 😊 Ada yang bisa kami bantu? Silakan tanya soal kamar, harga, ketersediaan, fasilitas, atau lokasi.";
  }
  if (/(kamar|room|harga|tarif|price|biaya)/.test(t)) {
    return `Berikut tipe kamar kami:\n${roomList}\n\nUntuk memesan, klik tombol "Pesan Kamar" di halaman ini ya, Kak.`;
  }
  if (/(tersedia|available|kosong|booking|pesan|cek|reservasi)/.test(t)) {
    return `Untuk mengecek ketersediaan, pilih tanggal check-in & check-out di widget pemesanan lalu klik "Cek Ketersediaan".\n\nTipe kamar kami:\n${roomList}`;
  }
  if (/(fasilitas|wifi|sarapan|parkir|cafe|balkon)/.test(t)) {
    return "Fasilitas kami: Free WiFi, Parkir gratis, Mini Cafe, dan Balkon. 😊";
  }
  if (/(lokasi|alamat|dimana|map|peta|arah)/.test(t)) {
    return 'Kami berada di Kota Semarang. Lihat peta lengkap di bagian "Lokasi Kami" pada halaman ini.';
  }
  if (/(terima kasih|makasih|thanks|thank you)/.test(t)) {
    return "Sama-sama, Kak! 🙏 Senang bisa membantu. Selamat datang di Pomah Guesthouse.";
  }
  return "Maaf, saya belum sepenuhnya paham 🙏. Anda bisa bertanya soal kamar, harga, ketersediaan, fasilitas, atau lokasi. Untuk bantuan langsung, silakan hubungi kami via WhatsApp.";
}

export function Webchat({ rooms }: { rooms: Room[] }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([
    {
      who: "bot",
      text: "Halo! 👋 Saya asisten AI Pomah Guesthouse. Ada yang bisa dibantu?",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Stable per-session id so the whole webchat is logged as one thread.
  const threadId = useRef<string>(crypto.randomUUID());
  const chatFn = useServerFn(chatWithAI);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, open, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMsg[] = [...msgs, { who: "user", text }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      // Try the real LLM; fall back to the rule-based engine on failure.
      const history = next.map((m) => ({
        role: m.who === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }));
      const res = await chatFn({ data: { messages: history, threadId: threadId.current } });
      if (res.error) console.warn("[Webchat AI] LLM tidak dipakai — error:", res.error);
      else console.log("[Webchat AI] balasan dari LLM ✓");
      const reply = res.reply || botReply(text, rooms);
      setMsgs((m) => [...m, { who: "bot", text: reply }]);
    } catch (e) {
      console.warn("[Webchat AI] panggilan gagal:", (e as Error).message);
      setMsgs((m) => [...m, { who: "bot", text: botReply(text, rooms) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[460px] w-[340px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-teal-700 px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">Asisten AI</p>
              <p className="text-[10px] text-white/70">Pomah Guesthouse</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Tutup">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto bg-stone-50 p-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.who === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[82%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm",
                    m.who === "user"
                      ? "bg-teal-600 text-white"
                      : "border border-stone-200 bg-white text-stone-700",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-400">
                  Mengetik…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="flex items-center gap-2 border-t border-stone-200 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Tulis pesan…"
              className="flex-1 rounded-full border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
            />
            <button
              onClick={send}
              aria-label="Kirim"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white transition hover:bg-teal-800"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Chat dengan asisten AI"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg transition hover:bg-teal-800"
      >
        {open ? <X className="h-7 w-7" /> : <MessageSquare className="h-7 w-7" />}
      </button>
    </>
  );
}
