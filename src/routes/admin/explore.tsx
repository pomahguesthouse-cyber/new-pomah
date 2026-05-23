import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { 
  Plus, 
  Trash2, 
  Pencil, 
  Check, 
  MoreVertical, 
  MapPin, 
  ListOrdered
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MediaPicker } from "@/admin/components/media-picker";
import { getPropertySettings, updatePropertySettings } from "@/admin/modules/settings/settings.functions";
import { ExploreConfig, mergeExploreConfig } from "@/admin/modules/explore/explore.config";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { AiSidebar } from "@/admin/components/ai-sidebar";

export const Route = createFileRoute("/admin/explore")({
  component: AdminExplorePage,
});

function AdminExplorePage() {
  const getFn = useServerFn(getPropertySettings);
  const updateFn = useServerFn(updatePropertySettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["property-settings"],
    queryFn: () => getFn(),
  });
  useRealtimeInvalidate("admin-explore-stream", ["properties"], [["property-settings"], ["public-site"]]);

  const mutation = useMutation({
    mutationFn: (v: { id: string; explore_config: any }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["property-settings"] });
      qc.invalidateQueries({ queryKey: ["public-site"] });
      toast.success("Perubahan berhasil disimpan");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [config, setConfig] = useState<ExploreConfig | null>(null);

  // State to handle MediaPicker
  const [pickerState, setPickerState] = useState<{
    open: boolean;
    target: "hero" | { type: "dest" | "culinary" | "event" | "news"; index: number } | null;
  }>({ open: false, target: null });

  // Sync state on load
  if (data && !config && !isLoading) {
    setConfig(mergeExploreConfig((data as any).explore_config));
  }

  if (isLoading || !config) return <p className="p-6 text-sm text-muted-foreground">Memuat...</p>;

  const id = data?.id;

  const handleSave = () => {
    if (!id) return;
    mutation.mutate({ id, explore_config: config });
  };

  const handlePickMedia = (url: string) => {
    if (!pickerState.target) return;
    const { target } = pickerState;

    if (target === "hero") {
      setConfig({ ...config, hero: { ...config.hero, bgImageUrl: url } });
    } else if (target.type === "dest") {
      const newDests = [...config.destinations];
      newDests[target.index].image = url;
      setConfig({ ...config, destinations: newDests });
    } else if (target.type === "culinary") {
      const newCul = [...config.culinary];
      newCul[target.index].image = url;
      setConfig({ ...config, culinary: newCul });
    }
    // Event/News image integration is possible if the schema supports it.
    // The current explore.config.ts might not have images for events/news, but we can add them later.
  };

  return (
    <div className="flex p-6 md:p-10 gap-8 h-full bg-stone-50/50">
      
      {/* Media Picker Dialog */}
      <MediaPicker
        open={pickerState.open}
        kind="image"
        onPick={handlePickMedia}
        onClose={() => setPickerState({ open: false, target: null })}
      />

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 space-y-8">
        
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-bold text-[10px] tracking-widest text-emerald-600 uppercase mb-1">
              City Guide
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900">Jelajahi Semarang</h1>
            <p className="text-sm text-stone-500 mt-1">
              Kelola konten destinasi, kuliner, event dan informasi seputar Semarang.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-stone-500 mb-2">Terakhir diperbarui: 12 Mei 2026 09:15</p>
            <Button 
              onClick={handleSave} 
              disabled={mutation.isPending}
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2 h-9"
            >
              Simpan Semua Perubahan
              <Check className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Hero Banner Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-stone-900">Hero Banner</h2>
          <Card className="p-4 border-stone-200 shadow-sm flex flex-col md:flex-row gap-6">
            <div className="md:w-[40%] shrink-0 space-y-3">
              <div className="aspect-video bg-stone-100 rounded-lg border border-stone-200 overflow-hidden relative group">
                {config.hero.bgImageUrl ? (
                  <img src={config.hero.bgImageUrl} alt="Hero Banner" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                    No Image
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <Button 
                     size="sm" 
                     variant="secondary" 
                     onClick={() => setPickerState({ open: true, target: "hero" })}
                   >
                     Ubah Gambar
                   </Button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="gap-2 h-8 text-xs font-medium"
                  onClick={() => setPickerState({ open: true, target: "hero" })}
                >
                  <Pencil className="h-3 w-3" />
                  Ubah Gambar
                </Button>
                <span className="text-[10px] text-stone-400">Rekomendasi ukuran: 1920x800px</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-4 relative">
              <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 h-8 w-8 text-stone-400">
                <MoreVertical className="h-4 w-4" />
              </Button>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700">Judul</label>
                <Input
                  className="h-9 text-sm"
                  value={config.hero.heading}
                  onChange={(e) => setConfig({ ...config, hero: { ...config.hero, heading: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700">Sub-judul</label>
                <Textarea
                  className="h-20 text-sm resize-none"
                  value={config.hero.subheading}
                  onChange={(e) => setConfig({ ...config, hero: { ...config.hero, subheading: e.target.value } })}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Destinasi Wisata */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-emerald-600" />
              Destinasi Wisata
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              onClick={() =>
                setConfig({
                  ...config,
                  destinations: [...config.destinations, { name: "Destinasi Baru", desc: "", image: "", rating: "5.0" }],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Destinasi
            </Button>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
            {config.destinations.map((dest, i) => (
              <Card key={i} className="flex flex-col sm:flex-row w-[400px] shrink-0 border-stone-200 shadow-sm p-3 gap-4 snap-start relative">
                <div 
                  className="w-32 h-24 shrink-0 rounded-md bg-stone-100 overflow-hidden relative cursor-pointer group"
                  onClick={() => setPickerState({ open: true, target: { type: "dest", index: i } })}
                >
                  {dest.image ? (
                    <img src={dest.image} alt={dest.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">Pilih Gambar</div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Pencil className="h-4 w-4 text-white" />
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <Input 
                      className="h-7 text-sm font-bold px-2 py-0"
                      value={dest.name}
                      onChange={(e) => {
                        const newDests = [...config.destinations];
                        newDests[i].name = e.target.value;
                        setConfig({ ...config, destinations: newDests });
                      }}
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mr-2 -mt-1 text-stone-400">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <Textarea 
                    className="flex-1 min-h-0 text-[11px] text-stone-500 mt-1 resize-none p-2"
                    value={dest.desc}
                    onChange={(e) => {
                      const newDests = [...config.destinations];
                      newDests[i].desc = e.target.value;
                      setConfig({ ...config, destinations: newDests });
                    }}
                  />
                  
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100">
                    <div className="flex items-center gap-1.5 text-xs text-stone-600">
                      <span>Rating</span>
                      <span className="text-amber-400">★</span>
                      <Input 
                        className="h-6 w-12 text-xs px-1 py-0 text-center font-semibold"
                        value={dest.rating}
                        onChange={(e) => {
                          const newDests = [...config.destinations];
                          newDests[i].rating = e.target.value;
                          setConfig({ ...config, destinations: newDests });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400 hover:text-stone-600">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() =>
                          setConfig({ ...config, destinations: config.destinations.filter((_, idx) => idx !== i) })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Kuliner Terbaik */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-emerald-600" />
              Kuliner Terbaik
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              onClick={() =>
                setConfig({
                  ...config,
                  culinary: [...config.culinary, { name: "Kuliner Baru", desc: "", image: "", category: "Cemilan" }],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Kuliner
            </Button>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
            {config.culinary.map((cul, i) => (
              <Card key={i} className="w-64 shrink-0 border-stone-200 shadow-sm overflow-hidden flex flex-col snap-start relative group">
                <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6 text-white bg-black/20 rounded-full hover:bg-black/40 z-10">
                  <MoreVertical className="h-3 w-3" />
                </Button>
                
                <div 
                  className="h-32 bg-stone-100 relative cursor-pointer group/img"
                  onClick={() => setPickerState({ open: true, target: { type: "culinary", index: i } })}
                >
                  {cul.image ? (
                    <img src={cul.image} alt={cul.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">Pilih Gambar</div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <Pencil className="h-5 w-5 text-white" />
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col p-4 gap-2">
                  <Input 
                    className="h-7 text-sm font-bold px-2 py-0"
                    value={cul.name}
                    onChange={(e) => {
                      const newCul = [...config.culinary];
                      newCul[i].name = e.target.value;
                      setConfig({ ...config, culinary: newCul });
                    }}
                  />
                  <Input 
                    className="h-6 text-[10px] text-stone-500 px-2 py-0 border-transparent hover:border-stone-200 bg-stone-50"
                    value={cul.category}
                    onChange={(e) => {
                      const newCul = [...config.culinary];
                      newCul[i].category = e.target.value;
                      setConfig({ ...config, culinary: newCul });
                    }}
                  />
                  <Textarea 
                    className="flex-1 text-xs text-stone-600 resize-none p-2 border-transparent hover:border-stone-200"
                    value={cul.desc}
                    onChange={(e) => {
                      const newCul = [...config.culinary];
                      newCul[i].desc = e.target.value;
                      setConfig({ ...config, culinary: newCul });
                    }}
                  />
                </div>
                
                <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="h-6 w-6 shadow-sm"
                    onClick={() =>
                      setConfig({ ...config, culinary: config.culinary.filter((_, idx) => idx !== i) })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Events & News Container */}
        <div className="grid md:grid-cols-2 gap-6">
          
          {/* Event Mendatang */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2">
              <h2 className="text-sm font-bold text-stone-900">Event Mendatang</h2>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-stone-400 hover:text-stone-900"
                onClick={() =>
                  setConfig({
                    ...config,
                    events: [...config.events, { title: "Event Baru", date: "", location: "", desc: "" }],
                  })
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {config.events.map((ev, i) => (
                <div key={i} className="flex gap-3 items-start group">
                  <div className="h-16 w-16 bg-stone-200 rounded overflow-hidden shrink-0">
                    <div className="w-full h-full flex items-center justify-center text-[8px] text-stone-400">Img</div>
                  </div>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Input 
                        className="h-6 text-xs font-bold text-stone-900 px-1 py-0 bg-transparent border-transparent hover:border-stone-200 focus:bg-white"
                        value={ev.title}
                        onChange={(e) => {
                          const newEv = [...config.events];
                          newEv[i].title = e.target.value;
                          setConfig({ ...config, events: newEv });
                        }}
                      />
                      <Input 
                        className="h-5 w-24 text-[10px] text-stone-500 bg-stone-100 px-1.5 border-transparent text-right shrink-0"
                        placeholder="Tanggal"
                        value={ev.date}
                        onChange={(e) => {
                          const newEv = [...config.events];
                          newEv[i].date = e.target.value;
                          setConfig({ ...config, events: newEv });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-stone-400 px-1">
                      <MapPin className="h-3 w-3" />
                      <Input 
                        className="h-5 flex-1 text-[10px] px-1 py-0 bg-transparent border-transparent hover:border-stone-200"
                        placeholder="Lokasi"
                        value={ev.location}
                        onChange={(e) => {
                          const newEv = [...config.events];
                          newEv[i].location = e.target.value;
                          setConfig({ ...config, events: newEv });
                        }}
                      />
                    </div>
                    <Textarea 
                      className="h-12 text-[10px] text-stone-500 resize-none p-1 border-transparent hover:border-stone-200 leading-snug"
                      placeholder="Deskripsi..."
                      value={ev.desc}
                      onChange={(e) => {
                        const newEv = [...config.events];
                        newEv[i].desc = e.target.value;
                        setConfig({ ...config, events: newEv });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-red-400"
                      onClick={() => setConfig({ ...config, events: config.events.filter((_, idx) => idx !== i) })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Berita Lainnya */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2">
              <h2 className="text-sm font-bold text-stone-900">Berita Lainnya</h2>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-stone-400 hover:text-stone-900"
                onClick={() =>
                  setConfig({
                    ...config,
                    news: [...config.news, { title: "Berita Baru", date: "", url: "", desc: "" }],
                  })
                }
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {config.news.map((nw, i) => (
                <div key={i} className="flex gap-3 items-start group">
                  <div className="h-16 w-16 bg-stone-200 rounded overflow-hidden shrink-0">
                    <div className="w-full h-full flex items-center justify-center text-[8px] text-stone-400">Img</div>
                  </div>
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Input 
                        className="h-6 text-xs font-bold text-stone-900 px-1 py-0 bg-transparent border-transparent hover:border-stone-200 focus:bg-white"
                        value={nw.title}
                        onChange={(e) => {
                          const newNw = [...config.news];
                          newNw[i].title = e.target.value;
                          setConfig({ ...config, news: newNw });
                        }}
                      />
                      <Input 
                        className="h-5 w-24 text-[10px] text-stone-500 bg-stone-100 px-1.5 border-transparent text-right shrink-0"
                        placeholder="Tanggal"
                        value={nw.date}
                        onChange={(e) => {
                          const newNw = [...config.news];
                          newNw[i].date = e.target.value;
                          setConfig({ ...config, news: newNw });
                        }}
                      />
                    </div>
                    <Textarea 
                      className="h-14 text-[10px] text-stone-500 resize-none p-1 border-transparent hover:border-stone-200 leading-snug"
                      placeholder="Deskripsi..."
                      value={nw.desc}
                      onChange={(e) => {
                        const newNw = [...config.news];
                        newNw[i].desc = e.target.value;
                        setConfig({ ...config, news: newNw });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-red-400"
                      onClick={() => setConfig({ ...config, news: config.news.filter((_, idx) => idx !== i) })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </div>
      
      {/* Right Sidebar (AI Assistant) */}
      <AiSidebar />
      
    </div>
  );
}
