/**
 * Komponen reusable untuk Web Chat Backup (kanal cadangan WA/Fonnte).
 * Mobile-first, polling-based untuk pesan baru.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Paperclip, Loader2, AlertCircle, CheckCircle2, Home, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  getChannelStatus,
  startWebchatSession,
  sendWebchatMessage,
  uploadWebchatAttachment,
  getWebchatMessages,
  type WebchatThreadRow,
  type WebchatMessageRow,
  type BookingSummary,
} from "@/public/functions/webchat.functions";

const LS_THREAD_KEY = "pomah:webchat:threadId";

type ThreadState = {
  thread: WebchatThreadRow;
  messages: WebchatMessageRow[];
  booking: BookingSummary | null;
} | null;

interface Props {
  initialBookingCode?: string | null;
  initialGuestName?: string | null;
  initialGuestPhone?: string | null;
  /** Kalau true, langsung start session tanpa form onboarding (untuk halaman post-booking). */
  autoStart?: boolean;
  className?: string;
}

export function WebchatWindow({
  initialBookingCode,
  initialGuestName,
  initialGuestPhone,
  autoStart,
  className,
}: Props) {
  const qc = useQueryClient();
  const getStatus  = useServerFn(getChannelStatus);
  const startFn    = useServerFn(startWebchatSession);
  const sendFn     = useServerFn(sendWebchatMessage);
  const uploadFn   = useServerFn(uploadWebchatAttachment);
  const refreshFn  = useServerFn(getWebchatMessages);

  const [session, setSession] = useState<ThreadState>(null);
  const [name, setName]       = useState(initialGuestName ?? "");
  const [phone, setPhone]     = useState(initialGuestPhone ?? "");
  const [bookingCode, setBookingCode] = useState(initialBookingCode ?? "");
  const [composer, setComposer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  // Channel status banner.
  const statusQuery = useQuery({
    queryKey: ["webchat-channel-status"],
    queryFn:  () => getStatus(),
    refetchInterval: 60_000,
  });

  // Resume thread dari localStorage atau auto-start.
  useEffect(() => {
    if (session) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(LS_THREAD_KEY) : null;
    if (!saved && autoStart && initialGuestName && initialGuestPhone) {
      void doStart(initialGuestName, initialGuestPhone, initialBookingCode ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling pesan baru setiap 6 detik.
  useEffect(() => {
    if (!session?.thread.id) return;
    const id = setInterval(async () => {
      try {
        const fresh = await refreshFn({ data: { threadId: session.thread.id } });
        if (fresh.thread) {
          setSession((s) => s ? { ...s, thread: fresh.thread!, messages: fresh.messages } : s);
        }
      } catch { /* ignore */ }
    }, 6_000);
    return () => clearInterval(id);
  }, [session?.thread.id, refreshFn]);

  // Auto-scroll ke bawah.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.messages.length]);

  const doStart = useCallback(async (gName: string, gPhone: string, code?: string) => {
    setError(null);
    try {
      const res = await startFn({
        data: { guestName: gName, guestPhone: gPhone, bookingCode: code || undefined },
      });
      setSession(res);
      localStorage.setItem(LS_THREAD_KEY, res.thread.id);
    } catch (e: any) {
      setError(e?.message ?? "Gagal memulai sesi");
    }
  }, [startFn]);

  const startMut = useMutation({
    mutationFn: () => doStart(name.trim(), phone.trim(), bookingCode.trim()),
  });

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      if (!session) throw new Error("Sesi belum siap");
      return sendFn({ data: { threadId: session.thread.id, body } });
    },
    onSuccess: async () => {
      if (!session) return;
      const fresh = await refreshFn({ data: { threadId: session.thread.id } });
      if (fresh.thread) {
        setSession({ ...session, thread: fresh.thread, messages: fresh.messages });
      }
    },
    onError: (e: any) => setError(e?.message ?? "Gagal mengirim pesan"),
  });

  const onSend = () => {
    const body = composer.trim();
    if (!body || sendMut.isPending) return;
    setComposer("");
    // Optimistic message.
    if (session) {
      const optimistic: WebchatMessageRow = {
        id: `local-${Date.now()}`,
        thread_id: session.thread.id,
        sender_type: "guest",
        sender_name: session.thread.guest_name,
        body,
        attachment_url: null,
        attachment_type: null,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      setSession({ ...session, messages: [...session.messages, optimistic] });
    }
    sendMut.mutate(body);
  };

  const onFile = async (file: File) => {
    if (!session) return;
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      await uploadFn({
        data: {
          threadId: session.thread.id,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          base64: b64,
          note: "(bukti transfer)",
        },
      });
      const fresh = await refreshFn({ data: { threadId: session.thread.id } });
      if (fresh.thread) {
        setSession({ ...session, thread: fresh.thread, messages: fresh.messages });
      }
    } catch (e: any) {
      setError(e?.message ?? "Upload gagal");
    }
  };

  const quickActions = useMemo(
    () => [
      "Kamar masih tersedia tanggal berapa?",
      "Saya mau lanjut booking",
      "Saya sudah transfer, ini buktinya",
      "Bagaimana cara ke Pomah Guesthouse?",
      "Saya mau bicara dengan admin",
    ],
    [],
  );

  const channelStatus = statusQuery.data?.channels ?? [];
  const waChannel = channelStatus.find((c: any) => c.channel === "whatsapp_fonnte");
  const isWaDown  = waChannel && waChannel.status !== "online";

  // ─── Onboarding form ──────────────────────────────────────────────
  if (!session) {
    return (
      <div className={"flex min-h-[100dvh] flex-col bg-stone-50 " + (className ?? "")}>
        <ChatHeader compact />
        <div className="mx-auto w-full max-w-md flex-1 px-4 py-6">
          {isWaDown ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                WhatsApp kami sedang ada gangguan. Gunakan Web Chat ini untuk
                tetap terhubung dengan Pomah Guesthouse.
              </span>
            </div>
          ) : (
            <p className="mb-4 text-sm text-stone-600">
              Web Chat resmi Pomah Guesthouse. Gunakan ini sebagai cadangan kalau
              WhatsApp Anda bermasalah.
            </p>
          )}

          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="space-y-2">
                <Label htmlFor="wc-name">Nama Anda</Label>
                <Input
                  id="wc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap"
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wc-phone">Nomor WhatsApp</Label>
                <Input
                  id="wc-phone"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08xx atau 62xx"
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wc-code">Kode booking (opsional : isi jika anda sudah memiliki kode booking)</Label>
                <Input
                  id="wc-code"
                  value={bookingCode}
                  onChange={(e) => setBookingCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: PG-XXXX"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
              <Button
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending || name.trim().length < 2 || phone.trim().length < 8}
                className="w-full bg-[#1A3620] hover:bg-[#0f2415]"
              >
                {startMut.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memulai...</>
                ) : "Mulai chat"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── Chat surface ─────────────────────────────────────────────────
  return (
    <div className={"flex min-h-[100dvh] flex-col bg-stone-50 " + (className ?? "")}>
      <ChatHeader />

      {isWaDown && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900">
          WhatsApp sedang gangguan — Anda terhubung via Web Chat cadangan.
        </div>
      )}

      {session.booking && (
        <BookingMiniCard booking={session.booking} />
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {session.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {sendMut.isPending && (
            <div className="self-start rounded-2xl bg-stone-200 px-4 py-2 text-sm text-stone-600">
              Pomah sedang mengetik…
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-2xl px-3 py-2">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {quickActions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setComposer(q)}
                className="whitespace-nowrap rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs text-stone-700 hover:bg-stone-100"
              >
                {q}
              </button>
            ))}
          </div>
          {error && (
            <p className="mb-2 flex items-center gap-1 text-xs text-red-600">
              <X className="h-3 w-3" /> {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileRef.current?.click()}
              title="Lampirkan bukti transfer"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              placeholder="Ketik pesan…"
              className="min-h-[40px] flex-1 resize-none"
            />
            <Button
              type="button"
              onClick={onSend}
              disabled={!composer.trim() || sendMut.isPending}
              className="bg-[#1A3620] hover:bg-[#0f2415]"
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-stone-400">
            Web Chat resmi Pomah Guesthouse · ID sesi: {session.thread.id.slice(0, 8)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatHeader({ compact }: { compact?: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1A3620] text-white">
            <Home className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-900">Pomah Guesthouse</p>
            <p className="text-xs text-stone-500">
              {compact ? "Web Chat resmi" : "Online · biasanya balas dalam menit"}
            </p>
          </div>
        </div>
        <a href="/" className="text-xs text-stone-500 hover:text-stone-700">
          Beranda
        </a>
      </div>
    </header>
  );
}

function BookingMiniCard({ booking }: { booking: BookingSummary }) {
  const paid = booking.paymentStatus === "paid";
  return (
    <div className="border-b border-stone-200 bg-stone-100 px-4 py-2">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 text-xs">
        <div>
          <p className="font-semibold text-stone-800">
            {booking.referenceCode} · {booking.roomName ?? "Kamar"}
          </p>
          <p className="text-stone-600">
            {booking.checkIn} → {booking.checkOut}
            {booking.nights ? ` · ${booking.nights} malam` : ""}
          </p>
        </div>
        <Badge variant={paid ? "default" : "secondary"} className={paid ? "bg-emerald-600" : ""}>
          {paid ? (
            <><CheckCircle2 className="mr-1 h-3 w-3" /> Lunas</>
          ) : booking.paymentStatus}
        </Badge>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: WebchatMessageRow }) {
  const role = message.sender_type;
  if (role === "system") {
    return (
      <div className="self-center rounded-full bg-stone-200 px-3 py-1 text-center text-xs text-stone-600">
        {message.body}
      </div>
    );
  }
  const isGuest = role === "guest";
  const align = isGuest ? "self-end" : "self-start";
  const bubble = isGuest
    ? "bg-[#1A3620] text-white"
    : role === "admin"
      ? "bg-amber-100 text-stone-900"
      : "bg-white text-stone-900 border border-stone-200";
  return (
    <div className={`flex max-w-[85%] flex-col ${align}`}>
      {!isGuest && message.sender_name && (
        <span className="mb-0.5 text-[10px] text-stone-500">{message.sender_name}</span>
      )}
      <div className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${bubble}`}>
        {message.attachment_url ? (
          message.attachment_type?.startsWith("image/") ? (
            <a href={message.attachment_url} target="_blank" rel="noreferrer">
              <img
                src={message.attachment_url}
                alt="lampiran"
                className="mb-1 max-h-56 rounded-lg object-cover"
              />
            </a>
          ) : (
            <a
              href={message.attachment_url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Lampiran
            </a>
          )
        ) : null}
        {message.body && <span>{message.body}</span>}
      </div>
    </div>
  );
}
