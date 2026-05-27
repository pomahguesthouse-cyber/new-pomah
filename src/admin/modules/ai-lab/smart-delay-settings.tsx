/**
 * Smart Response Delay Engine — Admin Settings Panel
 *
 * Allows admins to configure per-property debounce timing for the WhatsApp
 * AI chatbot. When a guest sends multiple messages in quick succession the
 * engine waits for the configured window before generating a reply, so the
 * AI sees the complete thought rather than replying to each partial message.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Timer,
  Zap,
  MessageSquare,
  FileText,
  Clock,
  ShieldCheck,
  BarChart3,
  RefreshCw,
  RotateCcw,
  Info,
} from "lucide-react";
import {
  getSmartDelayConfig,
  saveSmartDelayConfig,
  getQueueStats,
  DEFAULT_SMART_DELAY,
  type SmartDelayConfig,
} from "./smart-delay.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms === 0) return "Instan";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} detik`;
}

/** Preview: what delay would fire for a given sample message? */
const WAIT_SIGNALS = /\b(bentar|sebentar|tunggu|wait|lagi|masih|cek dulu|cek)\b|\.\.\./i;
function previewDelay(body: string, cfg: SmartDelayConfig): number {
  if (!cfg.enabled) return 0;
  if (WAIT_SIGNALS.test(body)) return Math.min(cfg.waitSignalMs, cfg.maxDelayMs);
  const len = body.trim().length;
  if (len < 15)  return Math.min(cfg.shortMs,    cfg.maxDelayMs);
  if (len <= 80) return Math.min(cfg.mediumMs,   cfg.maxDelayMs);
  return Math.min(cfg.longMs, cfg.maxDelayMs);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DelaySlider({
  label,
  description,
  icon: Icon,
  value,
  onChange,
  max = 15000,
  step = 500,
}: {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  step?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">{label}</Label>
        </div>
        <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 tabular-nums">
          {fmtMs(value)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Slider
        min={0}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Instan</span>
        <span>{fmtMs(max)}</span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color = "stone",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "stone" | "teal" | "amber" | "sky";
}) {
  const accent: Record<string, string> = {
    stone: "text-stone-700",
    teal:  "text-teal-700",
    amber: "text-amber-700",
    sky:   "text-sky-700",
  };
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", accent[color])}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Live preview simulator ───────────────────────────────────────────────────

const PREVIEW_SAMPLES = [
  { label: "Singkat", text: "ok" },
  { label: "Nunggu lagi", text: "bentar" },
  { label: "Pertanyaan", text: "Kamar masih ada ngga untuk besok?" },
  { label: "Panjang", text: "Halo kak, saya mau tanya soal kamar superior untuk tanggal 25-28 Mei, ada yang kosong nggak? Kalau ada berapa harganya termasuk sarapan?" },
];

function LivePreview({ cfg }: { cfg: SmartDelayConfig }) {
  const [custom, setCustom] = useState("");
  const previewText = custom.trim() || "";

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Simulasi delay
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PREVIEW_SAMPLES.map((s) => {
          const ms = previewDelay(s.text, cfg);
          return (
            <div key={s.label} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
              <p className="text-[10px] font-medium text-muted-foreground">{s.label}</p>
              <p className="mt-0.5 text-xs text-stone-600 truncate" title={s.text}>
                "{s.text.slice(0, 20)}{s.text.length > 20 ? "…" : ""}"
              </p>
              <p className="mt-1 text-sm font-semibold text-teal-700 tabular-nums">{fmtMs(ms)}</p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Ketik pesan tamu untuk cek delay-nya…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-teal-500"
        />
        {custom.trim() && (
          <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 tabular-nums">
            {fmtMs(previewDelay(custom, cfg))}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SmartDelaySettings() {
  const qc = useQueryClient();

  const getCfgFn  = useServerFn(getSmartDelayConfig);
  const saveCfgFn = useServerFn(saveSmartDelayConfig);
  const getStatsFn = useServerFn(getQueueStats);

  const { data: cfgData, isLoading: cfgLoading } = useQuery({
    queryKey: ["smart-delay-config"],
    queryFn:  () => getCfgFn(),
  });

  const { data: statsData, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ["smart-delay-stats"],
    queryFn:  () => getStatsFn(),
    refetchInterval: 30_000,
  });

  const [cfg, setCfg] = useState<SmartDelayConfig>(DEFAULT_SMART_DELAY);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cfgData?.config) {
      setCfg(cfgData.config);
      setDirty(false);
    }
  }, [cfgData]);

  const update = (patch: Partial<SmartDelayConfig>) => {
    setCfg((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  // Fill the recommended default timings (keeps the current enable toggle).
  const resetToDefaults = () => {
    update({
      shortMs:      DEFAULT_SMART_DELAY.shortMs,
      mediumMs:     DEFAULT_SMART_DELAY.mediumMs,
      longMs:       DEFAULT_SMART_DELAY.longMs,
      waitSignalMs: DEFAULT_SMART_DELAY.waitSignalMs,
      maxDelayMs:   DEFAULT_SMART_DELAY.maxDelayMs,
    });
    toast.info("Nilai default diisi — klik Simpan untuk menyimpan.");
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cfgData?.id) throw new Error("Properti belum tersedia.");
      await saveCfgFn({ data: { id: cfgData.id, config: cfg } });
    },
    onSuccess: () => {
      toast.success("Pengaturan Smart Delay tersimpan");
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ["smart-delay-config"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const t = statsData?.totals;
  const supersededPct =
    t && t.total > 0 ? Math.round((t.superseded / t.total) * 100) : 0;
  const repliedPct =
    t && t.total > 0 ? Math.round((t.replied / t.total) * 100) : 0;

  if (cfgLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Memuat konfigurasi…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-teal-600" />
            <h2 className="text-lg font-semibold">Smart Response Delay Engine</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Tunda balasan AI beberapa detik agar chatbot menunggu apabila tamu masih mengetik,
            sehingga AI merespons keseluruhan pesan—bukan potongannya.
          </p>
        </div>
        <Button
          disabled={!dirty || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          className="shrink-0 bg-teal-700 text-white hover:bg-teal-800"
        >
          {saveMut.isPending ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>

      {/* Enable toggle */}
      <Card className="flex items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
            <Zap className="h-5 w-5" />
          </span>
          <div>
            <p className="font-medium">Aktifkan Smart Delay</p>
            <p className="text-xs text-muted-foreground">
              Jika dimatikan, AI akan langsung membalas tanpa jeda.
            </p>
          </div>
        </div>
        <Switch
          checked={cfg.enabled}
          onCheckedChange={(v) => update({ enabled: v })}
        />
      </Card>

      {/* Delay sliders */}
      <Card className={cn("space-y-6 p-5", !cfg.enabled && "pointer-events-none opacity-50")}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Waktu Tunggu per Jenis Pesan</p>
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefaults}
            className="h-8 gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Atur ke Default
          </Button>
        </div>
        <p className="-mt-3 text-[11px] text-muted-foreground">
          Default: Pendek {fmtMs(DEFAULT_SMART_DELAY.shortMs)} · Sedang{" "}
          {fmtMs(DEFAULT_SMART_DELAY.mediumMs)} · Panjang {fmtMs(DEFAULT_SMART_DELAY.longMs)} ·
          Sinyal Tunggu {fmtMs(DEFAULT_SMART_DELAY.waitSignalMs)} · Maksimum{" "}
          {fmtMs(DEFAULT_SMART_DELAY.maxDelayMs)}
        </p>

        <DelaySlider
          label="Pesan Sangat Pendek  (< 15 karakter)"
          description='Contoh: "ok", "ya", "oke". Tamu mungkin masih akan menambah pesan berikutnya.'
          icon={MessageSquare}
          value={cfg.shortMs}
          onChange={(v) => update({ shortMs: v })}
        />

        <DelaySlider
          label="Pesan Sedang  (15 – 80 karakter)"
          description='Contoh: "Kamar masih ada untuk besok?". Pertanyaan singkat yang lengkap.'
          icon={MessageSquare}
          value={cfg.mediumMs}
          onChange={(v) => update({ mediumMs: v })}
        />

        <DelaySlider
          label="Pesan Panjang  (> 80 karakter)"
          description="Pesan detail — tamu sudah menjelaskan kebutuhannya secara lengkap."
          icon={FileText}
          value={cfg.longMs}
          onChange={(v) => update({ longMs: v })}
        />

        <DelaySlider
          label={'Sinyal Tunggu  ("bentar", "sebentar", "wait"…)'}
          description="Tamu minta tunggu atau masih mencari info. Beri jeda ekstra sebelum bot membalas."
          icon={Clock}
          value={cfg.waitSignalMs}
          onChange={(v) => update({ waitSignalMs: v })}
          max={20000}
        />

        <DelaySlider
          label="Batas Maksimum Delay"
          description="Tidak ada jeda yang melebihi batas ini, apa pun kategori pesannya."
          icon={ShieldCheck}
          value={cfg.maxDelayMs}
          onChange={(v) => update({ maxDelayMs: v })}
          max={30000}
        />
      </Card>

      {/* Live preview */}
      <Card className="p-5">
        <LivePreview cfg={cfg} />
      </Card>

      {/* How it works */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Info className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Cara Kerja</p>
        </div>
        <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
          <li>Webhook Fonnte masuk → pesan disimpan ke database.</li>
          <li>Engine menghitung jeda berdasarkan panjang & isi pesan.</li>
          <li>Entry baru ditandai sebagai "winner" — entry lama untuk nomor yang sama otomatis dibatalkan.</li>
          <li>Server tidur selama jeda yang dihitung (maks 30 detik wall-clock).</li>
          <li>Setelah bangun, cek apakah entry ini masih winner (belum disupersede pesan baru).</li>
          <li>Jika masih winner → AI membaca seluruh percakapan terbaru → kirim balasan.</li>
          <li>Jika sudah disupersede → skip. Pesan yang lebih baru akan menangani balasannya.</li>
        </ol>
      </Card>

      {/* Today's stats */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Statistik Hari Ini</p>
          </div>
          <button
            onClick={() => refetchStats()}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className={cn("h-3 w-3", statsLoading && "animate-spin")} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total Pesan Masuk"
            value={t?.total ?? 0}
            color="stone"
          />
          <StatCard
            label="Berhasil Dibalas"
            value={t?.replied ?? 0}
            sub={`${repliedPct}% dari total`}
            color="teal"
          />
          <StatCard
            label="Digabung (Debounced)"
            value={t?.superseded ?? 0}
            sub={`${supersededPct}% dari total`}
            color="amber"
          />
          <StatCard
            label="Rata-rata Jeda"
            value={t?.avgDelayMs != null ? fmtMs(t.avgDelayMs) : "—"}
            color="sky"
          />
        </div>

        {/* Hourly breakdown */}
        {(statsData?.rows?.length ?? 0) > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-1.5 pr-4">Jam (WIB)</th>
                  <th className="pb-1.5 pr-4 text-right">Masuk</th>
                  <th className="pb-1.5 pr-4 text-right">Dibalas</th>
                  <th className="pb-1.5 pr-4 text-right">Digabung</th>
                  <th className="pb-1.5 text-right">Avg Delay</th>
                </tr>
              </thead>
              <tbody>
                {statsData!.rows.map((r) => (
                  <tr key={r.hour_wib} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-4 font-medium">
                      {new Date(r.hour_wib).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-1.5 pr-4 text-right">{r.total}</td>
                    <td className="py-1.5 pr-4 text-right text-teal-700">{r.replied}</td>
                    <td className="py-1.5 pr-4 text-right text-amber-700">{r.superseded}</td>
                    <td className="py-1.5 text-right">
                      {r.avg_delay_ms != null ? fmtMs(r.avg_delay_ms) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
