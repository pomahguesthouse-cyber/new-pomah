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
  setupTelegramWebhook,
  getTelegramWebhookDiagnostics,
  sendTelegramTestMessage,
  resetTelegramWebhook,
  listAgentChannels,
  upsertAgentChannel,
  deleteAgentChannel,
} from "@/admin/functions/telegram.functions";
import { toast } from "sonner";
import { Send, Link2, Copy, Trash2, RefreshCw, AlertTriangle, Activity, Zap, Users, Plus } from "lucide-react";

export const Route = createFileRoute("/admin/telegram")({
  component: TelegramPage,
});

function TelegramPage() {
  const listFn = useServerFn(listTelegramStatus);
  const genFn = useServerFn(generateTelegramLinkToken);
  const unlinkFn = useServerFn(unlinkTelegram);
  const setupFn = useServerFn(setupTelegramWebhook);
  const diagFn = useServerFn(getTelegramWebhookDiagnostics);
  const testFn = useServerFn(sendTelegramTestMessage);
  const resetWebhookFn = useServerFn(resetTelegramWebhook);
  const listChFn = useServerFn(listAgentChannels);
  const upsertChFn = useServerFn(upsertAgentChannel);
  const deleteChFn = useServerFn(deleteAgentChannel);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => listFn(),
  });
  const { data: diag, refetch: refetchDiag } = useQuery({
    queryKey: ["telegram-diagnostics"],
    queryFn: () => diagFn(),
  });
  const { data: channelsData } = useQuery({
    queryKey: ["telegram-agent-channels"],
    queryFn: () => listChFn(),
  });

  const [newChannelChatId, setNewChannelChatId] = useState("");
  const [newChannelAgent, setNewChannelAgent] = useState<string>("front-office");
  const [newChannelLabel, setNewChannelLabel] = useState("");

  async function handleAddChannel() {
    try {
      await upsertChFn({ data: { chat_id: newChannelChatId.trim(), agent_key: newChannelAgent as any, label: newChannelLabel.trim() || undefined } });
      setNewChannelChatId(""); setNewChannelLabel("");
      qc.invalidateQueries({ queryKey: ["telegram-agent-channels"] });
      toast.success("Channel ditambahkan");
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }
  async function handleDeleteChannel(id: string) {
    if (!window.confirm("Hapus channel ini?")) return;
    try {
      await deleteChFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["telegram-agent-channels"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }
  const [generatedLink, setGeneratedLink] = useState<{ id: string; link: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSetup() {
    try {
      const origin = window.location.origin;
      const res: any = await setupFn({ data: { origin } });
      toast.success(`Webhook diset: ${res.webhook_url} (bot @${res.bot_username})`);
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
      qc.invalidateQueries({ queryKey: ["telegram-diagnostics"] });
    } catch (e: any) {
      toast.error(e.message ?? "Setup gagal");
    }
  }

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

  async function handleResetWebhook() {
    if (!window.confirm("Hapus webhook + pending updates? Setelah ini klik 'Setup webhook' lagi.")) return;
    try {
      await resetWebhookFn();
      toast.success("Webhook dihapus");
      refetchDiag();
    } catch (e: any) {
      toast.error(e.message ?? "Gagal");
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
        <div className="text-sm font-semibold">Konfigurasi Bot</div>
        {!data?.botConfigured && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <div className="font-medium">Token bot belum di-set.</div>
              <div>
                Buat bot via{" "}
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">
                  @BotFather
                </a>
                , salin token-nya, lalu paste ke kolom <code>telegram_bot_token</code> di Properties (Settings).
              </div>
            </div>
          </div>
        )}
        {data?.botConfigured && (
          <div className="text-xs text-muted-foreground">
            Bot: {data.botUsername ? <code className="text-foreground">@{data.botUsername}</code> : <span className="italic">username belum di-resolve</span>}
            <Button size="sm" variant="outline" className="ml-3 h-7" onClick={handleSetup}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Setup webhook
            </Button>
          </div>
        )}
      </Card>

      {/* Diagnostics panel */}
      {data?.botConfigured && diag?.ok && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-indigo-600" /> Diagnostik Webhook
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4 text-xs">
            <div><span className="text-muted-foreground">Bot dari getMe:</span> {diag.bot_username ? <code>@{diag.bot_username}</code> : <span className="text-red-600">{diag.me_error ?? "—"}</span>}</div>
            <div><span className="text-muted-foreground">Bot username di DB:</span> {diag.bot_username_in_db ? <code>@{diag.bot_username_in_db}</code> : <span className="text-amber-700">belum</span>}</div>
            <div><span className="text-muted-foreground">Webhook secret di DB:</span> {diag.secret_set_in_db ? "✅ ada" : <span className="text-amber-700">belum</span>}</div>
            <div><span className="text-muted-foreground">Webhook URL:</span> {diag.webhook?.url ? <code className="break-all">{diag.webhook.url}</code> : <span className="text-red-600">BELUM DI-SET</span>}</div>
            <div><span className="text-muted-foreground">Pending updates:</span> {diag.webhook?.pending_update_count ?? 0}</div>
            <div><span className="text-muted-foreground">Allowed updates:</span> {diag.webhook?.allowed_updates?.join(", ") ?? "—"}</div>
            {diag.webhook?.last_error_message && (
              <div className="col-span-full text-red-700">
                <span className="text-muted-foreground">Last error:</span> {diag.webhook.last_error_message}
                {diag.webhook.last_error_date && (
                  <span className="ml-1 text-muted-foreground">
                    ({new Date(diag.webhook.last_error_date * 1000).toLocaleString("id-ID")})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7" onClick={() => refetchDiag()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-red-700" onClick={handleResetWebhook}>
              <Trash2 className="h-3 w-3 mr-1" /> Hapus webhook
            </Button>
          </div>
          {!diag.webhook?.url && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Webhook URL kosong. Pesan ke bot tidak akan diterima sistem. Klik <b>Setup webhook</b> di atas.
            </div>
          )}
          {diag.webhook?.url && data.botConfigured && !diag.webhook.url.includes(window.location.host) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Webhook URL <code>{diag.webhook.url}</code> menunjuk ke host lain (bukan {window.location.host}).
              Bila ini bukan endpoint aktif Anda, klik <b>Setup webhook</b> untuk redirect ke domain ini.
            </div>
          )}
        </Card>
      )}

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
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Users className="h-4 w-4 text-sky-600" /> Channel per Agent (Group)
        </div>
        <p className="text-xs text-muted-foreground">
          Ikat satu Telegram group ke satu agent (Front Office, Pricing, Customer Care, Finance,
          Content, Manager). Notifikasi event yang relevan akan mendarat di group itu, dan pesan
          di group akan dijawab langsung oleh agent tersebut.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>Cara mendapatkan chat_id group:</strong> tambahkan bot ke group → kirim
          <code className="mx-1 px-1 bg-stone-100 rounded">/start agent &lt;agent_key&gt;</code> di group itu →
          bot akan otomatis terdaftar. Atau isi manual di form di bawah.
        </p>
        <div className="flex flex-wrap gap-2 items-center bg-stone-50 p-2 rounded border">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={newChannelAgent}
            onChange={(e) => setNewChannelAgent(e.target.value)}
          >
            <option value="front-office">Front Office</option>
            <option value="pricing">Pricing</option>
            <option value="customer-care">Customer Care</option>
            <option value="finance">Finance</option>
            <option value="content">Content Manager</option>
            <option value="manager">Manager</option>
          </select>
          <input
            className="h-9 rounded-md border bg-background px-2 text-sm w-44"
            placeholder="chat_id (mis. -100123…)"
            value={newChannelChatId}
            onChange={(e) => setNewChannelChatId(e.target.value)}
          />
          <input
            className="h-9 rounded-md border bg-background px-2 text-sm flex-1 min-w-[150px]"
            placeholder="Label (opsional)"
            value={newChannelLabel}
            onChange={(e) => setNewChannelLabel(e.target.value)}
          />
          <Button size="sm" onClick={handleAddChannel} disabled={!newChannelChatId.trim()}>
            <Plus className="h-3 w-3 mr-1" /> Tambah
          </Button>
        </div>
        {(channelsData?.channels ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">Belum ada channel terdaftar.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Agent</th>
                <th className="text-left">Chat ID</th>
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
