import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wifi } from "lucide-react";

import { listFacilityKb, saveFacilityKb } from "@/admin/modules/facility-kb/facility-kb.functions";
import { FACILITY_FIELDS, FACILITY_FIELD_LABEL, type FacilityField } from "@/services/room-facility-kb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/facility-kb")({
  component: FacilityKbPage,
});

const ALL = "__all__";
const SHORT_FIELDS = new Set<FacilityField>(["wifi_password", "maps_url"]);
const HINT: Partial<Record<FacilityField, string>> = {
  wifi_password_location: "Mis. stiker di dinding dekat TV. Kosongkan bila belum pasti.",
  cooking_tools: "Mis. kompor gas, panci, penggorengan.",
  checkin_point: "Tempat tamu lapor/ambil kunci saat datang.",
};

type Values = Partial<Record<FacilityField | "notes", string>>;

function FacilityKbPage() {
  const listFn = useServerFn(listFacilityKb);
  const saveFn = useServerFn(saveFacilityKb);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["facility-kb"], queryFn: () => listFn() });
  const [scope, setScope] = useState<string>(ALL);
  const [values, setValues] = useState<Values>({});

  const rows = data?.rows ?? [];
  const rooms = data?.rooms ?? [];
  const general = useMemo(() => rows.find((r) => r.room_type_id === null) ?? null, [rows]);
  const current = useMemo(
    () => rows.find((r) => (scope === ALL ? r.room_type_id === null : r.room_type_id === scope)) ?? null,
    [rows, scope],
  );

  useEffect(() => {
    const v: Values = {};
    for (const f of [...FACILITY_FIELDS, "notes"] as const) v[f] = (current?.[f] as string | null) ?? "";
    setValues(v);
  }, [current, scope]);

  const mut = useMutation({
    mutationFn: () =>
      saveFn({ data: { roomTypeId: scope === ALL ? null : scope, values: values as Record<string, string> } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facility-kb"] });
      toast.success("Info fasilitas disimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const emptyCount = FACILITY_FIELDS.filter((f) => !(general?.[f] ?? "").trim()).length;

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Wifi className="h-5 w-5 shrink-0 text-sky-600" />
          Info fasilitas
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jawaban bot WhatsApp untuk WiFi, dapur, handuk, hairdryer, dan titik check-in. Kolom kosong: bot mencari di
          SOP/pelatihan, lalu meneruskan ke admin — tidak menebak.
        </p>
      </div>

      <Card className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua kamar (umum)</SelectItem>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {scope === ALL ? (
            <Badge variant="outline" className="w-fit">
              {emptyCount} kolom umum kosong
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">Isi hanya yang berbeda dari info umum.</span>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {FACILITY_FIELDS.map((f) => {
              const inherited = scope !== ALL ? ((general?.[f] as string | null) ?? "").trim() : "";
              const id = `fkb-${f}`;
              return (
                <div key={f} className="min-w-0 space-y-1.5">
                  <Label htmlFor={id}>{FACILITY_FIELD_LABEL[f]}</Label>
                  {SHORT_FIELDS.has(f) ? (
                    <Input
                      id={id}
                      value={values[f] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                      placeholder={inherited ? `Ikut umum: ${inherited}` : "Belum diketahui"}
                    />
                  ) : (
                    <Textarea
                      id={id}
                      rows={2}
                      value={values[f] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                      placeholder={inherited ? `Ikut umum: ${inherited}` : "Belum diketahui"}
                    />
                  )}
                  {HINT[f] ? <p className="text-xs text-muted-foreground">{HINT[f]}</p> : null}
                </div>
              );
            })}
            <div className="min-w-0 space-y-1.5 lg:col-span-2">
              <Label htmlFor="fkb-notes">Catatan internal (tidak dikirim ke tamu)</Label>
              <Textarea
                id="fkb-notes"
                rows={2}
                value={values.notes ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {current?.updated_at ? `Terakhir diubah ${new Date(current.updated_at).toLocaleString("id-ID")}` : "Belum ada data"}
          </span>
          <Button className="w-full sm:w-auto" disabled={mut.isPending || isLoading} onClick={() => mut.mutate()}>
            {mut.isPending ? "Menyimpan…" : "Simpan"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
