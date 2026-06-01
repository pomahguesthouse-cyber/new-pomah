/**
 * Admin → Competitor Prices
 *
 * Dashboard untuk Pricing Agent: trigger scraping harga hotel kompetitor
 * di Semarang, review history scrape, hapus outlier.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  TrendingUp, Loader2, Search, Trash2, ExternalLink, RefreshCw,
} from "lucide-react";
import {
  runCompetitorScrape,
  listCompetitorPrices,
  deleteCompetitorPrice,
} from "@/admin/functions/competitor.functions";

export const Route = createFileRoute("/admin/competitor-prices")({
  component: CompetitorPricesPage,
});

function fmtRp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

function CompetitorPricesPage() {
  const runFn = useServerFn(runCompetitorScrape);
  const listFn = useServerFn(listCompetitorPrices);
  const delFn = useServerFn(deleteCompetitorPrice);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["competitor-prices"],
    queryFn: () => listFn(),
  });

  const [city, setCity] = useState("Semarang");
  const [extra, setExtra] = useState("");
  const [limit, setLimit] = useState(8);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    setRunning(true);
    try {
      const res: any = await runFn({ data: { city, extra_keywords: extra || undefined, limit } });
      if (res?.ok) {
        toast.success(`${res.inserted_count} harga ditambahkan (provider: ${res.provider ?? "-"})`);
      } else {
        toast.error(res?.error ?? "Gagal");
      }
      qc.invalidateQueries({ queryKey: ["competitor-prices"] });
    } catch (e: any) {
      toast.error(e.message ?? "Error");
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Hapus baris ini?")) return;
    try {
      await delFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["competitor-prices"] });
    } catch (e: any) { toast.error(e.message ?? "Gagal"); }
  }

  // Quick stats from current rows
  const stats = (() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) return null;
    const prices = rows.map((r: any) => Number(r.price_min)).filter((n: number) => Number.isFinite(n));
    if (prices.length === 0) return null;
    prices.sort((a: number, b: number) => a - b);
    const avg = Math.round(prices.reduce((s: number, n: number) => s + n, 0) / prices.length);
    return {
      count: rows.length,
      min:   prices[0],
      max:   prices[prices.length - 1],
      avg,
      median: prices[Math.floor(prices.length / 2)],
    };
  })();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-violet-700" />
        <h1 className="text-lg font-semibold">Competitor Prices — Benchmark</h1>
      </div>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Search className="h-4 w-4 text-violet-600" /> Scrape Harga Baru
        </div>
        <p className="text-xs text-muted-foreground">
          Pricing Agent akan cari listing hotel di OTA (Traveloka, Tiket, Booking, Agoda),
          ekstrak rentang harga per malam, dan simpan ke tabel sebagai snapshot.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Kota"
            className="w-32"
            disabled={running}
          />
          <Input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="Filter (mis. 'budget', 'dekat tugu muda', 'bintang 3')"
            className="flex-1 min-w-[200px]"
            disabled={running}
          />
          <Input
            type="number" min={1} max={20}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 8)}
            className="w-20"
            disabled={running}
          />
          <Button onClick={handleRun} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
            Run Scrape
          </Button>
        </div>
      </Card>

      {stats && (
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div><div className="text-[10px] uppercase text-muted-foreground">Sample</div><div className="font-bold">{stats.count}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Min</div><div className="font-bold text-emerald-700">{fmtRp(stats.min)}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Median</div><div className="font-bold">{fmtRp(stats.median)}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Avg</div><div className="font-bold">{fmtRp(stats.avg)}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Max</div><div className="font-bold text-rose-700">{fmtRp(stats.max)}</div></div>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">History</div>
          <Button size="sm" variant="outline" className="h-7"
            onClick={() => qc.invalidateQueries({ queryKey: ["competitor-prices"] })}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : (data?.rows?.length ?? 0) === 0 ? (
          <div className="text-sm text-muted-foreground">Belum ada data — klik "Run Scrape" untuk mulai.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Hotel</th>
                <th className="text-right">Harga Min</th>
                <th className="text-right">Harga Max</th>
                <th className="text-left pl-2">★</th>
                <th className="text-left">Sumber</th>
                <th className="text-left">Waktu</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-1.5 max-w-[300px] truncate" title={r.hotel_name}>{r.hotel_name}</td>
                  <td className="text-right text-emerald-700 font-medium">{fmtRp(r.price_min)}</td>
                  <td className="text-right text-stone-600">{fmtRp(r.price_max)}</td>
                  <td className="pl-2">{r.star_rating ? "★".repeat(r.star_rating) : "—"}</td>
                  <td>
                    {r.source_url ? (
                      <a href={r.source_url} target="_blank" rel="noreferrer"
                        className="text-sky-600 hover:underline text-xs inline-flex items-center gap-0.5">
                        <ExternalLink className="h-3 w-3" /> link
                      </a>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="text-xs text-stone-600">{relativeTime(r.fetched_at)}</td>
                  <td>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600"
                      onClick={() => handleDelete(r.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
