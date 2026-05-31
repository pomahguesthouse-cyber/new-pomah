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
} from "@/admin/functions/telegram.functions";
import { toast } from "sonner";
import { Send, Link2, Copy, Trash2, RefreshCw, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/admin/telegram")({
  component: TelegramPage,
});

function TelegramPage() {
  const listFn = useServerFn(listTelegramStatus);
  const genFn = useServerFn(generateTelegramLinkToken);
  const unlinkFn = useServerFn(unlinkTelegram);
  const setupFn = useServerFn(setupTelegramWebhook);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["telegram-status"],
    queryFn: () => listFn(),
  });
  const [generatedLink, setGeneratedLink] = useState<{ id: string; link: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSetup() {
    try {
      const origin = window.location.origin;
      const res: any = await setupFn({ data: { origin } });
      toast.success(`Webhook diset: ${res.webhook_url} (bot @${res.bot_username})`);
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    } catch (e: any) {
      toast.error(e.message ?? "Setup gagal");
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => handleUnlink(m.id)}
                          disabled={busyId === m.id}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Putuskan
                        </Button>
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
