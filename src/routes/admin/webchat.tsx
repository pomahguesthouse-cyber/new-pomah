/**
 * Admin Web Chat — list thread + panel detail untuk kanal cadangan.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquare,
  Loader2,
  UserCog,
  Bot,
  PauseCircle,
  XCircle,
  Send,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

import {
  listWebchatThreads,
  getWebchatThreadDetail,
  sendWebchatAdminReply,
  setWebchatHandoff,
  closeWebchatThreadAdmin,
} from "@/admin/functions/webchat.functions";

export const Route = createFileRoute("/admin/webchat")({
  head: () => ({ meta: [{ title: "Web Chat — Admin Pomah" }] }),
  component: AdminWebchatPage,
});

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open:           { label: "Baru",           cls: "bg-blue-100 text-blue-800" },
  ai_active:      { label: "AI aktif",       cls: "bg-emerald-100 text-emerald-800" },
  waiting_admin:  { label: "Menunggu admin", cls: "bg-amber-100 text-amber-800" },
  closed:         { label: "Selesai",        cls: "bg-stone-200 text-stone-700" },
};

function AdminWebchatPage() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listWebchatThreads);
  const detailFn = useServerFn(getWebchatThreadDetail);
  const replyFn  = useServerFn(sendWebchatAdminReply);
  const handoffFn = useServerFn(setWebchatHandoff);
  const closeFn  = useServerFn(closeWebchatThreadAdmin);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "waiting_admin" | "ai_active" | "open" | "closed">("all");
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");

  const threadsQuery = useQuery({
    queryKey: ["admin-webchat-threads"],
    queryFn:  () => listFn(),
    refetchInterval: 10_000,
  });

  const detailQuery = useQuery({
    queryKey: ["admin-webchat-detail", activeId],
    queryFn:  () => detailFn({ data: { id: activeId! } }),
    enabled:  !!activeId,
    refetchInterval: 5_000,
  });

  const filtered = useMemo(() => {
    const list = (threadsQuery.data?.threads ?? []) as any[];
    const q = search.trim().toLowerCase();
    return list.filter((t) => {
      if (filter !== "all" && t.status !== filter) return false;
      if (!q) return true;
      return (
        (t.guest_name ?? "").toLowerCase().includes(q) ||
        (t.guest_phone ?? "").toLowerCase().includes(q) ||
        (t.booking_code ?? "").toLowerCase().includes(q)
      );
    });
  }, [threadsQuery.data, filter, search]);

  const replyMut = useMutation({
    mutationFn: async () => {
      if (!activeId) throw new Error("Pilih thread");
      return replyFn({ data: { threadId: activeId, body: reply.trim() } });
    },
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["admin-webchat-detail", activeId] });
      qc.invalidateQueries({ queryKey: ["admin-webchat-threads"] });
      toast.success("Pesan terkirim");
    },
    onError: (e: any) => toast.error(e?.message ?? "Gagal mengirim"),
  });

  const handoffMut = useMutation({
    mutationFn: (mode: "ai" | "human" | "paused") => {
      if (!activeId) throw new Error("Pilih thread");
      return handoffFn({
        data: { threadId: activeId, mode, minutes: mode === "human" ? 60 : undefined },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-webchat-detail", activeId] });
      qc.invalidateQueries({ queryKey: ["admin-webchat-threads"] });
      toast.success("Status diperbarui");
    },
  });

  const closeMut = useMutation({
    mutationFn: () => {
      if (!activeId) throw new Error("Pilih thread");
      return closeFn({ data: { threadId: activeId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-webchat-detail", activeId] });
      qc.invalidateQueries({ queryKey: ["admin-webchat-threads"] });
      toast.success("Thread ditutup");
    },
  });

  const detail = detailQuery.data;

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-3 p-3">
      {/* List */}
      <Card className="flex w-80 flex-col overflow-hidden">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-stone-600" />
            <h2 className="font-semibold">Web Chat</h2>
            <Badge variant="outline" className="ml-auto">
              {threadsQuery.data?.threads.length ?? 0}
            </Badge>
          </div>
          <Input
            placeholder="Cari nama / no / kode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
          <div className="flex flex-wrap gap-1">
            {(["all", "waiting_admin", "ai_active", "open", "closed"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
                className="h-6 px-2 text-[11px]"
              >
                {f === "all" ? "Semua" : STATUS_LABEL[f]?.label ?? f}
              </Button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          {threadsQuery.isLoading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-stone-500">Belum ada percakapan.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map((t) => {
                const st = STATUS_LABEL[t.status] ?? { label: t.status, cls: "" };
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(t.id)}
                      className={`block w-full px-3 py-2 text-left transition ${
                        activeId === t.id ? "bg-stone-100" : "hover:bg-stone-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {t.guest_name ?? "(tanpa nama)"}
                        </span>
                        <Badge className={st.cls + " text-[10px]"} variant="outline">
                          {st.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-stone-500">{t.guest_phone}</p>
                      {t.booking_code && (
                        <p className="text-[10px] text-emerald-700">{t.booking_code}</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </Card>

      {/* Detail */}
      <Card className="flex flex-1 flex-col overflow-hidden">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-stone-500">
            Pilih percakapan untuk melihat detail.
          </div>
        ) : !detail ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <div className="flex-1">
                <p className="font-semibold">{detail.thread?.guest_name}</p>
                <p className="text-xs text-stone-500">
                  {detail.thread?.guest_phone}
                  {detail.thread?.booking_code ? ` · ${detail.thread.booking_code}` : ""}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => handoffMut.mutate("human")}>
                <UserCog className="mr-1 h-3 w-3" /> Ambil alih
              </Button>
              <Button size="sm" variant="outline" onClick={() => handoffMut.mutate("ai")}>
                <Bot className="mr-1 h-3 w-3" /> Serahkan ke AI
              </Button>
              <Button size="sm" variant="outline" onClick={() => handoffMut.mutate("paused")}>
                <PauseCircle className="mr-1 h-3 w-3" /> Pause AI
              </Button>
              <Button size="sm" variant="destructive" onClick={() => closeMut.mutate()}>
                <XCircle className="mr-1 h-3 w-3" /> Tutup
              </Button>
            </div>

            {detail.booking && (
              <div className="border-b bg-stone-50 px-3 py-2 text-xs">
                <span className="font-semibold">{(detail.booking as any).reference_code}</span>
                {" · "}
                {(detail.booking as any).booking_rooms?.[0]?.room_types?.name ?? "Kamar"}
                {" · "}
                {(detail.booking as any).check_in} → {(detail.booking as any).check_out}
                {" · "}
                <span className="font-semibold">
                  {(detail.booking as any).payment_status}
                </span>
              </div>
            )}

            {detail.thread?.context_summary && (
              <details className="border-b bg-amber-50 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-semibold">Ringkasan dari WhatsApp</summary>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">
                  {detail.thread.context_summary}
                </p>
              </details>
            )}

            <ScrollArea className="flex-1 p-3">
              <div className="flex flex-col gap-2">
                {detail.messages.map((m: any) => {
                  const isGuest = m.sender_type === "guest";
                  const isSystem = m.sender_type === "system";
                  if (isSystem) {
                    return (
                      <div
                        key={m.id}
                        className="self-center rounded-full bg-stone-200 px-3 py-1 text-center text-[11px] text-stone-600"
                      >
                        {m.body}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={m.id}
                      className={`flex max-w-[80%] flex-col ${isGuest ? "self-start" : "self-end"}`}
                    >
                      <span className="mb-0.5 text-[10px] text-stone-500">
                        {m.sender_name ?? m.sender_type}
                      </span>
                      <div
                        className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                          isGuest
                            ? "bg-white border border-stone-200"
                            : m.sender_type === "admin"
                              ? "bg-amber-100"
                              : "bg-[#1A3620] text-white"
                        }`}
                      >
                        {m.attachment_url && m.attachment_type?.startsWith("image/") && (
                          <a href={m.attachment_url} target="_blank" rel="noreferrer">
                            <img
                              src={m.attachment_url}
                              alt="lampiran"
                              className="mb-1 max-h-40 rounded object-cover"
                            />
                          </a>
                        )}
                        {m.body}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="border-t p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={2}
                  placeholder="Balas sebagai admin…"
                  className="flex-1 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      if (reply.trim()) replyMut.mutate();
                    }
                  }}
                />
                <Button
                  onClick={() => replyMut.mutate()}
                  disabled={!reply.trim() || replyMut.isPending}
                >
                  {replyMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <><Send className="mr-1 h-4 w-4" /> Kirim</>
                  )}
                </Button>
              </div>
              <p className="mt-1 text-[10px] text-stone-400">
                Tekan Cmd/Ctrl + Enter untuk kirim cepat.
              </p>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
