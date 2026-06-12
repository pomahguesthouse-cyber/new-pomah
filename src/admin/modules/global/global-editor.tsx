import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { getGlobalConfig, updateGlobalConfig } from "./global.functions";
import { GlobalConfig, DEFAULT_GLOBAL_CONFIG } from "./global.config";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border"
      />
      <Input
        value={value}
        className="font-mono text-sm"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function GlobalSettingsEditor({ activeId }: { activeId: string }) {
  const getFn = useServerFn(getGlobalConfig);
  const updateFn = useServerFn(updateGlobalConfig);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["global-config"],
    queryFn: () => getFn(),
    refetchOnWindowFocus: false,
  });

  const [cfg, setCfg] = useState<GlobalConfig>(DEFAULT_GLOBAL_CONFIG);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.config) setCfg(data.config);
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      if (!data?.id) {
        toast.error("Properti belum tersedia.");
        return;
      }
      await updateFn({ data: cfg as any });
      toast.success("Konfigurasi global tersimpan");
      await refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground flex items-center justify-center"><Loader2 className="animate-spin h-5 w-5 mr-2" /> Memuat...</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card shrink-0">
        <p className="truncate text-sm font-semibold">
          Edit — {activeId === "global-header" ? "Header" : activeId === "global-footer" ? "Footer" : activeId === "global-whatsapp" ? "WhatsApp" : "Cookie Banner"}
        </p>
        <Button size="sm" className="h-7 gap-1.5 text-xs bg-teal-700 hover:bg-teal-800 text-white" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Simpan
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeId === "global-header" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tampilan Header</Label>
              <select
                value={cfg.header.style}
                onChange={(e) => setCfg({ ...cfg, header: { ...cfg.header, style: e.target.value as any } })}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="pill">Pill (Melayang)</option>
                <option value="transparent">Transparan (Diatas Hero)</option>
                <option value="solid">Solid Berwarna</option>
                <option value="minimal">Minimalis Putih</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Warna Background</Label>
              <ColorField value={cfg.header.bgColor} onChange={(c) => setCfg({ ...cfg, header: { ...cfg.header, bgColor: c } })} />
            </div>

            <div className="flex items-center justify-between">
              <Label>Blur Efek (Glassmorphism)</Label>
              <Switch checked={cfg.header.blur} onCheckedChange={(c) => setCfg({ ...cfg, header: { ...cfg.header, blur: c } })} />
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label>Label Tombol Booking</Label>
              <Input value={cfg.header.bookLabel} onChange={(e) => setCfg({ ...cfg, header: { ...cfg.header, bookLabel: e.target.value } })} />
            </div>
          </div>
        )}

        {activeId === "global-footer" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Aktifkan Footer</Label>
              <Switch checked={cfg.footer.enabled} onCheckedChange={(c) => setCfg({ ...cfg, footer: { ...cfg.footer, enabled: c } })} />
            </div>

            {cfg.footer.enabled && (
              <>
                <div className="space-y-2">
                  <Label>Warna Background</Label>
                  <ColorField value={cfg.footer.bgColor} onChange={(c) => setCfg({ ...cfg, footer: { ...cfg.footer, bgColor: c } })} />
                </div>
                <div className="space-y-2">
                  <Label>Warna Teks</Label>
                  <ColorField value={cfg.footer.textColor} onChange={(c) => setCfg({ ...cfg, footer: { ...cfg.footer, textColor: c } })} />
                </div>
                <div className="space-y-2">
                  <Label>Teks Footer</Label>
                  <Textarea value={cfg.footer.text} onChange={(e) => setCfg({ ...cfg, footer: { ...cfg.footer, text: e.target.value } })} />
                </div>
              </>
            )}
          </div>
        )}

        {activeId === "global-whatsapp" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Aktifkan Floating WhatsApp</Label>
              <Switch checked={cfg.whatsapp.enabled} onCheckedChange={(c) => setCfg({ ...cfg, whatsapp: { ...cfg.whatsapp, enabled: c } })} />
            </div>
            
            {cfg.whatsapp.enabled && (
              <>
                <div className="space-y-2">
                  <Label>Nomor WhatsApp</Label>
                  <Input placeholder="628..." value={cfg.whatsapp.phoneNumber} onChange={(e) => setCfg({ ...cfg, whatsapp: { ...cfg.whatsapp, phoneNumber: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label>Pesan Default</Label>
                  <Textarea value={cfg.whatsapp.message} onChange={(e) => setCfg({ ...cfg, whatsapp: { ...cfg.whatsapp, message: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label>Posisi Widget</Label>
                  <select
                    value={cfg.whatsapp.position}
                    onChange={(e) => setCfg({ ...cfg, whatsapp: { ...cfg.whatsapp, position: e.target.value as any } })}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="bottom-right">Kanan Bawah</option>
                    <option value="bottom-left">Kiri Bawah</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        {activeId === "global-cookie" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Aktifkan Cookie Banner</Label>
              <Switch checked={cfg.cookieBanner.enabled} onCheckedChange={(c) => setCfg({ ...cfg, cookieBanner: { ...cfg.cookieBanner, enabled: c } })} />
            </div>

            {cfg.cookieBanner.enabled && (
              <>
                <div className="space-y-2">
                  <Label>Teks Banner</Label>
                  <Textarea value={cfg.cookieBanner.text} onChange={(e) => setCfg({ ...cfg, cookieBanner: { ...cfg.cookieBanner, text: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label>Teks Tombol</Label>
                  <Input value={cfg.cookieBanner.buttonText} onChange={(e) => setCfg({ ...cfg, cookieBanner: { ...cfg.cookieBanner, buttonText: e.target.value } })} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
