/**
 * Admin → Telegram: per-manager linking + one-shot webhook setup.
 *
 * Workflow expected:
 *   1. Property owner creates a bot via @BotFather, pastes the token into
 *      Properties.telegram_bot_token (via Settings page or DB).
 *   2. Opens this page → clicks "Setup webhook" once. We call setWebhook
 *      with a fresh secret and resolve the bot username.
 *   3. For each manager, clicks "Generate link" → admin shares the
 *      t.me/<bot>?start=<token> URL (or QR) with that manager → manager
 *      opens it in Telegram → bot fires /start <token> → server links
 *      their chat_id.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listTelegramStatus,
  generateTelegramLinkToken,
  unlinkTelegram,
  sendTelegramTestMessage,
  listAgentChannels,
  upsertAgentChannel,
  deleteAgentChannel,
  listAgentBots,
  saveAgentBotToken,
  setupAgentBotWebhook,
  deleteAgentBot,
} from "@/admin/functions/telegram.functions";
import { toast } from "sonner";
import { Send, Link2, Copy, Trash2, RefreshCw, Zap, Users, Bot, Key } from "lucide-react";

export const Route = createFileRoute("/admin/telegram")({
  component: TelegramPage,
});

function TelegramPage() {
  const listFn = useServerFn(listTelegramStatus);
  const genFn = useServerFn(generateTelegramLinkToken);
  const unlinkFn = useServerFn(unlinkTelegram);
  const testFn = useServerFn(sendTelegramTestMessage);
  const listChFn = useServerFn(listAgentChannels);
  const deleteChFn = useServerFn(deleteAgentChannel);
  // upsertAgentChannel still exposed in server fns (kept for API extensibility),
  // but the manual add form is removed — channels are populated automatically
  // when an agent bot is /start'd in a Telegram group/topic.
  void upsertAgentChannel;
  const listBotsFn = useServerFn(listAgentBots);
  const saveBotFn = useServerFn(saveAgentBotToken);
  const setupBotFn = useServerFn(setupAgentBotWebhook);
  const deleteBotFn = useServerFn(deleteAgentBot);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => listFn(),
  });
  const { data: channelsData } = useQuery({
    queryKey: ["telegram-agent-channels"],
    queryFn: () => listChFn(),
  });
  const { data: botsData } = useQuery({
    queryKey: ["telegram-agent-bots"],
    queryFn: () => listBotsFn(),
  });

  async function handleDeleteChannel(id: string) {
    if (!window.confirm("Hapus channel ini?")) return;
    try {
      await deleteChFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["telegram-agent-channels"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }

  const [botDrafts, setBotDrafts] = useState<Record<string, string>>({});
  async function handleSaveBot(agent_key: string) {
    const token = (botDrafts[agent_key] ?? "").trim();
    if (!token) return;
    try {
      const r: any = await saveBotFn({ data: { agent_key: agent_key as any, bot_token: token } });
      setBotDrafts((d) => ({ ...d, [agent_key]: "" }));
      qc.invalidateQueries({ queryKey: ["telegram-agent-bots"] });
      toast.success(`Token tersimpan${r?.bot_username ? ` (@${r.bot_username})` : ""}`);
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }
  async function handleSetupBotWebhook(agent_key: string) {
    try {
      const origin = window.location.origin;
      const r: any = await setupBotFn({ data: { agent_key: agent_key as any, origin } });
      qc.invalidateQueries({ queryKey: ["telegram-agent-bots"] });
      toast.success(`Webhook di-set: ${r.webhook_url}`);
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }
  async function handleDeleteBot(agent_key: string) {
    if (!window.confirm(`Hapus bot untuk ${agent_key}?`)) return;
    try {
      await deleteBotFn({ data: { agent_key: agent_key as any } });
      qc.invalidateQueries({ queryKey: ["telegram-agent-bots"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }

  const AGENT_LIST = [
    { key: "front-office", label: "Front Office", persona: "Rania" },
    { key: "pricing", label: "Pricing", persona: "Julia" },
    { key: "customer-care", label: "Customer Care", persona: "Dewi" },
    { key: "finance", label: "Finance", persona: "Santi" },
    { key: "content", label: "Content", persona: "Rara" },
    { key: "manager", label: "Manager", persona: "Alexandria" },
  ];
  const botsByKey = new Map<string, any>(
    (botsData?.bots ?? []).map((b: any) => [b.agent_key, b]),
  );
  const [generatedLink, setGeneratedLink] = useState<{ id: string; link: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSendTest(id: string) {
    setBusyId(id);
    try {
      await testFn({ data: { managerId: id } });
      toast.success("Test message terkirim. Cek Telegram Anda.");
    } catch (e: any) {
      toast.error(e.message ?? "Gagal");
    } finally {
      setBusyId(null);
    }
  }


  async function handleGenerate(id: string) {
    setBusyId(id);
    try {
      const res: any = await genFn({ data: { managerId: id } });
      setGeneratedLink({ id, link: res.deep_link });
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    } catch (e: any) {
      toast.error(e.message ?? "Gagal generate link");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnlink(id: string) {
    if (!window.confirm("Putuskan koneksi Telegram untuk manager ini?")) return;
    setBusyId(id);
    try {
      await unlinkFn({ data: { managerId: id } });
      toast.success("Koneksi diputus");
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    } catch (e: any) {
      toast.error(e.message ?? "Gagal");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Send className="h-5 w-5 text-sky-600" />
        <h1 className="text-lg font-semibold">Telegram Integration</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-rose-600" /> Bot per Agent
        </div>
        <p className="text-xs text-muted-foreground">
          Tiap agent punya bot Telegram sendiri (nama + avatar berbeda). Buat bot di
          {" "}<a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">@BotFather</a>{" "}
          (mis. "Rania Pomah", "Santi Pomah"), paste token-nya di sini, lalu klik
          <b> Setup webhook</b>. Tambahkan semua bot ke satu Telegram group — anggota akan melihat
          tiap agent sebagai "speaker" terpisah.
        </p>
        <div className="space-y-2">
          {AGENT_LIST.map((a) => {
            const bot = botsByKey.get(a.key);
            const draft = botDrafts[a.key] ?? "";
            return (
              <div key={a.key} className="flex flex-wrap items-center gap-2 border rounded-md p-2 bg-white">
                <div className="min-w-[150px]">
                  <div className="text-sm font-medium">{a.label}</div>
                  <div className="text-[10px] text-muted-foreground">Persona: {a.persona}</div>
                </div>
                {bot ? (
                  <>
                    <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">
                      {bot.bot_username ? `@${bot.bot_username}` : "Token tersimpan"}
                    </Badge>
                    <code className="text-[10px] bg-stone-100 px-1.5 py-0.5 rounded">
                      {bot.bot_token_masked}
                    </code>
                    {bot.webhook_set_at ? (
                      <Badge className="bg-sky-100 text-sky-700 text-[10px]">webhook ✓</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-300">webhook ✗</Badge>
                    )}
                    <Button size="sm" variant="outline" className="h-7"
                      onClick={() => handleSetupBotWebhook(a.key)}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Setup webhook
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-600"
                      onClick={() => handleDeleteBot(a.key)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      placeholder="Bot token dari @BotFather"
                      className="h-8 rounded-md border bg-background px-2 text-xs flex-1 min-w-[200px]"
                      value={draft}
                      onChange={(e) => setBotDrafts((d) => ({ ...d, [a.key]: e.target.value }))}
                    />
                    <Button size="sm" className="h-8" onClick={() => handleSaveBot(a.key)}
                      disabled={!draft.trim()}>
                      <Key className="h-3 w-3 mr-1" /> Simpan
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold">Per-Manager Linking</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Nama</th>
                <th className="text-left">Role</th>
                <th className="text-left">Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(data?.managers ?? []).map((m: any) => {
                const linked = !!m.telegram_chat_id;
                const hasPendingToken = !!m.telegram_link_token;
                return (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="py-2">{m.name}</td>
                    <td>
                      <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                    </td>
                    <td>
                      {linked ? (
                        <Badge className="bg-emerald-100 text-emerald-700">
                          Terhubung
                        </Badge>
                      ) : hasPendingToken ? (
                        <Badge className="bg-amber-100 text-amber-700">
                          Token aktif
                        </Badge>
                      ) : (
                        <Badge variant="outline">Belum terhubung</Badge>
                      )}
                    </td>
                    <td className="text-right space-x-1">
                      {linked ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => handleSendTest(m.id)}
                            disabled={busyId === m.id}
                            title="Kirim pesan test ke chat Telegram manager"
                          >
                            <Zap className="h-3 w-3 mr-1" /> Test
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => handleUnlink(m.id)}
                            disabled={busyId === m.id}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Putuskan
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => handleGenerate(m.id)}
                          disabled={busyId === m.id || !data?.botConfigured || !data.botUsername}
                        >
                          <Link2 className="h-3 w-3 mr-1" /> Generate link
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <Users className="h-4 w-4 text-sky-600" /> Channel per Agent (Group / Topic)
            <Badge variant="outline" className="ml-2 text-[10px] border-emerald-300 text-emerald-700">
              Auto-managed
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Daftar group / topic Telegram tempat tiap agent kirim notifikasi (booking, bukti
          transfer, komplain). Diisi otomatis ketika bot agent di-add ke group dan diaktifkan
          dengan{" "}
          <code className="mx-1 px-1 bg-stone-100 rounded">/start agent &lt;agent_key&gt;</code>
          di group atau topic itu. Hapus row untuk unbind.
        </p>
        {(channelsData?.channels ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">Belum ada channel terdaftar.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Agent</th>
                <th className="text-left">Chat ID</th>
                <th className="text-left">Topic</th>
                <th className="text-left">Label</th>
                <th className="text-left">Type</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {channelsData!.channels.map((c: any) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-1.5"><Badge variant="outline" className="text-[10px]">{c.agent_key}</Badge></td>
                  <td><code className="text-xs">{c.chat_id}</code></td>
                  <td>
                    {c.message_thread_id
                      ? <code className="text-xs bg-violet-50 text-violet-700 px-1 rounded">#{c.message_thread_id}</code>
                      : <span className="text-xs text-muted-foreground">whole group</span>}
                  </td>
                  <td>{c.label ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-xs text-muted-foreground">{c.chat_type ?? "—"}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-red-600"
                      onClick={() => handleDeleteChannel(c.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {generatedLink && (
        <Card className="p-4 border-emerald-300 bg-emerald-50 space-y-2">
          <div className="text-sm font-semibold text-emerald-900">Link aktivasi (berlaku 15 menit)</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border px-2 py-1.5 rounded break-all">
              {generatedLink.link}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                navigator.clipboard.writeText(generatedLink.link);
                toast.success("Link disalin");
              }}
            >
              <Copy className="h-3 w-3 mr-1" /> Salin
            </Button>
          </div>
          <div className="text-xs text-emerald-800">
            Kirim ke manager via chat lain. Manager klik link → buka di Telegram → bot otomatis link chat_id-nya.
          </div>
        </Card>
      )}
    </div>
  );
}
