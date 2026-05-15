import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import {
  listPricing,
  updateBaseRate,
  upsertSeasonalRate,
  deleteSeasonalRate,
} from "@/admin/modules/pricing/pricing.functions";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pricing")({
  component: PricingPage,
});

function PricingPage() {
  const fn = useServerFn(listPricing);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pricing"], queryFn: () => fn() });
  useRealtimeInvalidate("admin-pricing-stream", ["room_types", "seasonal_rates"], [["pricing"]]);

  const updateBase = useServerFn(updateBaseRate);
  const upsert = useServerFn(upsertSeasonalRate);
  const remove = useServerFn(deleteSeasonalRate);

  type SeasonalInput = {
    id?: string;
    room_type_id: string;
    name: string;
    start_date: string;
    end_date: string;
    multiplier: number;
    nightly_rate?: number | null;
    min_stay: number;
  };
  const baseM = useMutation({
    mutationFn: (v: { id: string; base_rate: number }) => updateBase({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing"] });
      toast.success("Base rate updated");
    },
  });
  const upsertM = useMutation({
    mutationFn: (v: SeasonalInput) => upsert({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pricing"] });
      toast.success("Seasonal rate saved");
    },
  });
  const delM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pricing"] }),
  });

  const [newRate, setNewRate] = useState({
    room_type_id: "",
    name: "",
    start_date: "",
    end_date: "",
    multiplier: 1.2,
    min_stay: 1,
  });

  if (!data) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-8 p-6 md:p-10">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Pricing
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Rates &amp; seasons</h1>
      </header>

      <Card className="p-5">
        <h2 className="font-semibold">Base rates</h2>
        <div className="mt-4 divide-y divide-border">
          {data.roomTypes.map((rt) => (
            <BaseRateRow
              key={rt.id}
              id={rt.id}
              name={rt.name}
              base_rate={Number(rt.base_rate)}
              onSave={(v) => baseM.mutate({ id: rt.id, base_rate: v })}
            />
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Seasonal rates</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="pb-2">Name</th>
                <th>Room</th>
                <th>From</th>
                <th>To</th>
                <th>×</th>
                <th>Min stay</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.seasonal.map((s) => {
                const rt = data.roomTypes.find((r) => r.id === s.room_type_id);
                return (
                  <tr key={s.id}>
                    <td className="py-2">{s.name}</td>
                    <td>{rt?.name ?? "—"}</td>
                    <td className="font-mono text-xs">{s.start_date}</td>
                    <td className="font-mono text-xs">{s.end_date}</td>
                    <td className="font-mono">{Number(s.multiplier).toFixed(2)}</td>
                    <td>{s.min_stay}</td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => delM.mutate(s.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {data.seasonal.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No seasonal rates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 grid gap-3 border-t border-border pt-6 md:grid-cols-7">
          <div className="md:col-span-2">
            <Label className="text-xs">Name</Label>
            <Input
              value={newRate.name}
              onChange={(e) => setNewRate({ ...newRate, name: e.target.value })}
              placeholder="High season"
            />
          </div>
          <div>
            <Label className="text-xs">Room</Label>
            <Select
              value={newRate.room_type_id}
              onValueChange={(v) => setNewRate({ ...newRate, room_type_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick…" />
              </SelectTrigger>
              <SelectContent>
                {data.roomTypes.map((rt) => (
                  <SelectItem key={rt.id} value={rt.id}>
                    {rt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Start</Label>
            <Input
              type="date"
              value={newRate.start_date}
              onChange={(e) => setNewRate({ ...newRate, start_date: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">End</Label>
            <Input
              type="date"
              value={newRate.end_date}
              onChange={(e) => setNewRate({ ...newRate, end_date: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Multiplier</Label>
            <Input
              type="number"
              step="0.05"
              value={newRate.multiplier}
              onChange={(e) => setNewRate({ ...newRate, multiplier: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs">Min stay</Label>
            <Input
              type="number"
              min={1}
              value={newRate.min_stay}
              onChange={(e) => setNewRate({ ...newRate, min_stay: Number(e.target.value) })}
            />
          </div>
          <div className="md:col-span-7">
            <Button
              onClick={() => {
                if (
                  !newRate.name ||
                  !newRate.room_type_id ||
                  !newRate.start_date ||
                  !newRate.end_date
                ) {
                  toast.error("Fill all fields");
                  return;
                }
                upsertM.mutate(newRate);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add seasonal rate
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BaseRateRow({
  id,
  name,
  base_rate,
  onSave,
}: {
  id: string;
  name: string;
  base_rate: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(base_rate);
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="font-medium">{name}</p>
        <p className="font-mono text-xs text-muted-foreground">{id.slice(0, 8)}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">$</span>
        <Input
          type="number"
          step="1"
          value={v}
          onChange={(e) => setV(Number(e.target.value))}
          className="w-28"
        />
        <Button size="sm" disabled={v === base_rate} onClick={() => onSave(v)}>
          Save
        </Button>
      </div>
    </div>
  );
}
