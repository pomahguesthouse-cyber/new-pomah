import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { runWppDiagnostics } from "@/admin/functions/wpp-diagnostics.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/admin/wpp-diagnostics")({
  component: WppDiagnosticsPage,
});

type ProbeResult = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  bodyPreview: string;
  error: string | null;
} | null;

function WppDiagnosticsPage() {
  const fn = useServerFn(runWppDiagnostics);
  const [testPhone, setTestPhone] = useState("");

  const mutation = useMutation({
    mutationFn: (phone: string) => fn({ data: { testPhone: phone || undefined } }),
  });

  const data = mutation.data;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl">
      <header className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">WPPConnect Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            Uji koneksi gateway WhatsApp: env Cloudflare, reverse proxy VPS, dan Bearer token.
          </p>
        </div>
      </header>

      <Card className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label htmlFor="testPhone">Nomor uji (opsional, untuk send-seen & typing)</Label>
            <Input
              id="testPhone"
              placeholder="628xxxxxxxxxx"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Kosongkan agar hanya cek koneksi (tidak mengirim event ke nomor manapun).
            </p>
          </div>
          <Button
            onClick={() => mutation.mutate(testPhone)}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Jalankan uji
          </Button>
        </div>
      </Card>

      {mutation.isError && (
        <Card className="p-4 text-sm text-destructive">
          Gagal menjalankan uji: {(mutation.error as Error).message}
        </Card>
      )}

      {data && (
        <>
          <Card className="p-4 space-y-2">
            <h2 className="text-sm font-semibold">Environment (Cloudflare)</h2>
            <EnvRow label="WPP_BASE_URL" ok={data.env.hasBaseUrl} value={data.env.baseUrl} />
            <EnvRow label="WPP_SESSION" ok={data.env.hasSession} value={data.env.session} />
            <EnvRow label="WPP_WEBHOOK_TOKEN" ok={data.env.hasWebhookToken} value={data.env.hasWebhookToken ? "(diset)" : null} />
            <EnvRow
              label="properties.wpp_token"
              ok={data.token.present}
              value={data.token.present ? `${data.token.length} karakter` : "(kosong — isi di Settings)"}
            />
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold">Probes gateway</h2>
            <ProbeRow name="GET check-connection-session" result={data.probes.connection} />
            <ProbeRow name="POST send-seen" result={data.probes.sendSeen} skipHint="Isi nomor uji untuk menjalankan probe ini." />
            <ProbeRow name="POST typing (off)" result={data.probes.typing} skipHint="Isi nomor uji untuk menjalankan probe ini." />
          </Card>

          <p className="text-xs text-muted-foreground">
            Snapshot: {new Date(data.generatedAt).toLocaleString("id-ID")}
          </p>

          <Card className="p-4 space-y-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Panduan cepat</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="font-mono">401</span> → Bearer token salah / kadaluarsa. Perbarui <span className="font-mono">wpp_token</span> di Settings.</li>
              <li><span className="font-mono">404</span> → nama session salah (<span className="font-mono">WPP_SESSION</span>).</li>
              <li><span className="font-mono">Timeout</span> / DNS error → reverse proxy / SSL / DNS VPS belum siap.</li>
              <li>ENV kosong → tambahkan di Cloudflare Worker Secrets.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function EnvRow({ label, ok, value }: { label: string; ok: boolean; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm border-b last:border-b-0 py-1.5">
      <span className="font-mono text-xs">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{value ?? "(kosong)"}</span>
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : (
          <XCircle className="w-4 h-4 text-rose-500" />
        )}
      </div>
    </div>
  );
}

function ProbeRow({ name, result, skipHint }: { name: string; result: ProbeResult; skipHint?: string }) {
  if (!result) {
    return (
      <div className="border rounded-md p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs">{name}</span>
          <Badge variant="outline">Dilewati</Badge>
        </div>
        {skipHint && <p className="text-xs text-muted-foreground">{skipHint}</p>}
      </div>
    );
  }
  const tone = result.ok ? "border-emerald-500/40" : "border-rose-500/40";
  return (
    <div className={`border rounded-md p-3 space-y-1 ${tone}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs">{name}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{result.durationMs} ms</span>
          {result.status !== null && (
            <Badge variant={result.ok ? "default" : "destructive"}>HTTP {result.status}</Badge>
          )}
          {result.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <XCircle className="w-4 h-4 text-rose-500" />
          )}
        </div>
      </div>
      {result.error && <p className="text-xs text-rose-500">{result.error}</p>}
      {result.bodyPreview && (
        <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {result.bodyPreview}
        </pre>
      )}
    </div>
  );
}
