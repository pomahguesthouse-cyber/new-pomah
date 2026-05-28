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
  ListOrdered,
  Navigation
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { MediaPicker } from "@/admin/components/media-picker";
import { updateExploreConfig, getDistanceBetweenPlaces, getAdminExploreData, autoFillFromGoogleMaps } from "@/admin/modules/explore/explore.functions";
import { ExploreConfig, mergeExploreConfig } from "@/admin/modules/explore/explore.config";
import { useRealtimeInvalidate } from "@/admin/hooks/use-realtime-invalidate";
import { AiSidebar } from "@/admin/components/ai-sidebar";
import { syncExploreFromAI } from "@/admin/modules/explore/ai-agent.functions";
import { Sparkles } from "lucide-react";

function getDisplayImageUrl(url: string | undefined | null) {
  if (!url) return "";
  if (url.includes("maps.googleapis.com/maps/api/place/photo")) {
    try {
      const parsedUrl = new URL(url);
      const photoReference = parsedUrl.searchParams.get("photo_reference");
      if (photoReference) {
        return `/api/place-photo?photo_reference=${encodeURIComponent(photoReference)}`;
      }
    } catch (e) {
      // ignore
    }
  }
  return url;
}

const handleImageError = (
  e: React.SyntheticEvent<HTMLImageElement, Event>,
  fallbackType: "dest" | "culinary" | "event" | "news"
) => {
  const target = e.currentTarget;
  target.onerror = null;
  if (fallbackType === "culinary") {
    target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=400";
  } else if (fallbackType === "event") {
    target.src = "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?auto=format&fit=crop&q=80&w=400";
  } else {
    target.src = "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=600";
  }
};

export const Route = createFileRoute("/admin/explore")({
  component: AdminExplorePage,
});

function AdminExplorePage() {
  const getFn = useServerFn(getAdminExploreData);
  const updateFn = useServerFn(updateExploreConfig);
  const fetchDistanceFn = useServerFn(getDistanceBetweenPlaces);
  const autoFillFn = useServerFn(autoFillFromGoogleMaps);
  const syncAIFn = useServerFn(syncExploreFromAI);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-explore"],
    queryFn: () => getFn(),
  });
  useRealtimeInvalidate("admin-explore-stream", ["properties"], [["admin-explore"], ["public-site"]]);

  const mutation = useMutation({
    mutationFn: (v: { id: string; explore_config: any }) => updateFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-explore"] });
      qc.invalidateQueries({ queryKey: ["public-site"] });
      toast.success("Perubahan berhasil disimpan");
      setEditingItem(null); // Close any open edit mode on save
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const syncAIMutation = useMutation({
    mutationFn: () => syncAIFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-explore"] });
      qc.invalidateQueries({ queryKey: ["public-site"] });
      toast.success(res.message);
      
      // Merge new data visually
      if (res.data) {
         setConfig(prev => prev ? {
           ...prev,
           news: res.data.news.length > 0 ? res.data.news : prev.news,
           events: res.data.events.length > 0 ? res.data.events : prev.events,
         } : prev);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [config, setConfig] = useState<ExploreConfig | null>(null);

  // State to handle MediaPicker
  const [pickerState, setPickerState] = useState<{
    open: boolean;
    kind?: "image" | "video" | "any";
    target: "hero" | "hero-video" | { type: "dest" | "culinary" | "event" | "news"; index: number } | null;
  }>({ open: false, target: null });

  // State to handle inline editing
  const [editingItem, setEditingItem] = useState<{ type: string; index: number } | null>(null);
  
  // State for Auto-Fill inputs
  const [autoFillQuery, setAutoFillQuery] = useState<{ [key: string]: string }>({});

  // Sync state on load
  if (data && !config && !isLoading) {
    setConfig(mergeExploreConfig((data as any).explore_config));
  }

  if (isLoading || !config) return <p className="p-6 text-sm text-muted-foreground">Memuat...</p>;

  const id = data?.id;
  const updatedAt = data?.updated_at 
    ? new Date(data.updated_at).toLocaleString("id-ID", {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
      }) 
    : "Belum pernah diperbarui";

  const handleSave = () => {
    if (!id) return;
    mutation.mutate({ id, explore_config: config });
  };

  const fetchDistance = async (destPlaceId: string, index: number, type: "dest" | "culinary" = "dest") => {
    try {
      const res = await fetchDistanceFn({ data: { destPlaceId } });
      if (res && res.text) {
        if (type === "dest") {
           const newDests = [...config.destinations];
           newDests[index].nearby_distance = res.text;
           setConfig({ ...config, destinations: newDests });
        } else {
           const newCul = [...config.culinary];
           newCul[index].nearby_distance = res.text;
           setConfig({ ...config, culinary: newCul });
        }
      } else {
        throw new Error("Respons kosong dari server");
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleAutoFill = async (index: number, type: "dest" | "culinary") => {
    const q = autoFillQuery[`${type}-${index}`];
    if (!q) {
       toast.error("Masukkan URL atau nama tempat terlebih dahulu!");
       return;
    }
    
    try {
      const promise = autoFillFn({ data: { urlOrQuery: q } }).then((res) => {
         if (type === "dest") {
            const newDests = [...config.destinations];
            newDests[index] = { ...newDests[index], ...res };
            setConfig({ ...config, destinations: newDests });
         } else {
            const newCul = [...config.culinary];
            newCul[index] = { ...newCul[index], ...res };
            setConfig({ ...config, culinary: newCul });
         }
      });
      
      toast.promise(promise, {
        loading: "Menarik data dari Google Maps...",
        success: "Data berhasil ditarik!",
        error: (err) => err.message || "Gagal menarik data dari Google Maps",
      });
    } catch(e) {
      console.error(e);
    }
  };

  const handlePickMedia = (url: string) => {
    if (!pickerState.target) return;
    const { target } = pickerState;

    if (target === "hero") {
      setConfig({ ...config, hero: { ...config.hero, bgImageUrl: url } });
    } else if (target === "hero-video") {
      setConfig({ ...config, hero: { ...config.hero, videoUrl: url } });
    } else {
      const t = target as { type: "dest" | "culinary" | "event" | "news"; index: number };
      if (t.type === "dest") {
        const newDests = [...config.destinations];
        newDests[t.index].image = url;
        setConfig({ ...config, destinations: newDests });
      } else if (t.type === "culinary") {
        const newCul = [...config.culinary];
        newCul[t.index].image = url;
        setConfig({ ...config, culinary: newCul });
      } else if (t.type === "event") {
        const newEv = [...config.events];
        newEv[t.index].image = url;
        setConfig({ ...config, events: newEv });
      } else if (t.type === "news") {
        const newNw = [...config.news];
        newNw[t.index].image = url;
        setConfig({ ...config, news: newNw });
      }
    }
  };

  const isEditing = (type: string, index: number) => editingItem?.type === type && editingItem?.index === index;

  return (
    <div className="flex p-6 md:p-10 gap-8 h-full bg-stone-50/50 min-h-screen">
      
      <MediaPicker
        open={pickerState.open}
        kind={pickerState.kind || "image"}
        onPick={handlePickMedia}
        onClose={() => setPickerState({ open: false, target: null })}
      />

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
            <p className="text-[11px] text-stone-500 mb-2">Terakhir diperbarui: {updatedAt}</p>
            <Button 
              onClick={handleSave} 
              disabled={mutation.isPending}
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-2 h-9"
            >
              {mutation.isPending ? "Menyimpan..." : "Simpan Semua Perubahan"}
              {!mutation.isPending && <Check className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Hero Banner Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-stone-900">Hero Banner</h2>
          <Card className="p-4 border-stone-200 shadow-sm flex flex-col md:flex-row gap-6">
            <div className="md:w-[40%] shrink-0 space-y-3">
              <div className="aspect-video bg-stone-100 rounded-lg border border-stone-200 overflow-hidden relative group">
                {config.hero.videoUrl ? (
                  <video src={config.hero.videoUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
                ) : config.hero.bgImageUrl ? (
                  <img src={config.hero.bgImageUrl} alt="Hero Banner" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-stone-400 text-xs">
                    No Image / Video
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
            
            <div className="flex-1 space-y-3 relative">
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
                  className="h-16 text-sm resize-none"
                  value={config.hero.subheading}
                  onChange={(e) => setConfig({ ...config, hero: { ...config.hero, subheading: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-stone-700">Video Latar Belakang (Opsional)</label>
                <div className="flex gap-2">
                  <Input
                    className="h-9 text-sm bg-stone-50/50"
                    placeholder="Belum ada video terpilih..."
                    value={config.hero.videoUrl || ""}
                    readOnly
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0 gap-1.5"
                    onClick={() => setPickerState({ open: true, kind: "video", target: "hero-video" })}
                  >
                    <Pencil className="h-3 w-3" />
                    Pilih Video
                  </Button>
                  {config.hero.videoUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-9 shrink-0 text-red-500 hover:text-red-650 hover:bg-red-50"
                      onClick={() => setConfig({ ...config, hero: { ...config.hero, videoUrl: "" } })}
                    >
                      Hapus
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
        {/* Gemini API Key Section */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600" />
            Konfigurasi AI Agent
          </h2>
          <Card className="p-4 border-stone-200 shadow-sm">
            <div className="space-y-1.5 max-w-xl">
              <label className="text-xs font-semibold text-stone-700">Google Gemini API Key</label>
              <Input
                type="password"
                className="h-9 text-sm"
                placeholder="AIzaSy..."
                value={config.gemini_api_key || ""}
                onChange={(e) => setConfig({ ...config, gemini_api_key: e.target.value })}
              />
              <p className="text-[10px] text-stone-500">
                API Key dari Google AI Studio untuk digunakan fitur Tarik Data via AI. Wajib diisi agar AI bisa memfilter berita.
              </p>
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
              onClick={() => {
                setConfig({
                  ...config,
                  destinations: [...config.destinations, { name: "Destinasi Baru", desc: "", image: "", rating: "5.0" }],
                });
                setEditingItem({ type: "dest", index: config.destinations.length });
              }}
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
                    <img src={getDisplayImageUrl(dest.image)} alt={dest.name} onError={(e) => handleImageError(e, "dest")} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">Pilih Gambar</div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Pencil className="h-4 w-4 text-white" />
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    {isEditing("dest", i) ? (
                      <Input 
                        className="h-7 text-sm font-bold px-2 py-0"
                        value={dest.name}
                        onChange={(e) => {
                          const newDests = [...config.destinations];
                          newDests[i].name = e.target.value;
                          setConfig({ ...config, destinations: newDests });
                        }}
                      />
                    ) : (
                      <h3 className="text-sm font-bold text-stone-900 truncate">{dest.name}</h3>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mr-2 -mt-1 text-stone-400">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {isEditing("dest", i) ? (
                    <div className="space-y-1.5 mt-1.5 flex-1 flex flex-col">
                      <div className="flex gap-1.5 p-1.5 bg-emerald-50 rounded border border-emerald-100">
                        <Input
                          className="h-6 text-[10px] px-2 py-0 bg-white"
                          placeholder="Paste Link Share / Ketik Nama Tempat..."
                          value={autoFillQuery[`dest-${i}`] || ""}
                          onChange={(e) => setAutoFillQuery(prev => ({ ...prev, [`dest-${i}`]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          type="button"
                          className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 font-bold"
                          onClick={() => handleAutoFill(i, "dest")}
                        >
                          Tarik Otomatis
                        </Button>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          className="h-6 text-[10px] px-2 py-0"
                          placeholder="Alamat/Lokasi"
                          value={dest.address || ""}
                          onChange={(e) => {
                            const newDests = [...config.destinations];
                            newDests[i].address = e.target.value;
                            setConfig({ ...config, destinations: newDests });
                          }}
                        />
                        <Input 
                          className="h-6 text-[10px] px-2 py-0"
                          placeholder="Ulasan (e.g. 128)"
                          value={dest.reviewCount || ""}
                          onChange={(e) => {
                            const newDests = [...config.destinations];
                            newDests[i].reviewCount = e.target.value;
                            setConfig({ ...config, destinations: newDests });
                          }}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          className="h-6 text-[10px] px-2 py-0"
                          placeholder="Google Place ID"
                          value={dest.google_place_id || ""}
                          onChange={(e) => {
                            const newDests = [...config.destinations];
                            newDests[i].google_place_id = e.target.value;
                            setConfig({ ...config, destinations: newDests });
                          }}
                        />
                        <div className="flex gap-1">
                          <Input 
                            className="h-6 text-[10px] px-2 py-0 flex-1"
                            placeholder="Jarak Pomah (e.g. 3 km)"
                            value={dest.nearby_distance || ""}
                            onChange={(e) => {
                              const newDests = [...config.destinations];
                              newDests[i].nearby_distance = e.target.value;
                              setConfig({ ...config, destinations: newDests });
                            }}
                          />
                          <Button
                            size="sm"
                            type="button"
                            variant="secondary"
                            className="h-6 text-[9px] px-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 shrink-0 font-bold"
                            onClick={async () => {
                              if (!dest.google_place_id) {
                                toast.error("Isi Google Place ID destinasi terlebih dahulu!");
                                return;
                              }
                              const promise = fetchDistance(dest.google_place_id, i);
                              toast.promise(promise, {
                                loading: "Menghitung jarak dari Pomah...",
                                success: "Jarak berhasil diperbarui!",
                                error: (err) => err.message || "Gagal menarik jarak",
                              });
                            }}
                          >
                            Tarik
                          </Button>
                        </div>
                      </div>

                      <Textarea 
                        className="h-12 text-[10px] text-stone-500 mt-1 resize-none p-1.5"
                        placeholder="Deskripsi..."
                        value={dest.desc}
                        onChange={(e) => {
                          const newDests = [...config.destinations];
                          newDests[i].desc = e.target.value;
                          setConfig({ ...config, destinations: newDests });
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="space-y-0.5 mt-1">
                        {dest.address && (
                          <p className="text-[10px] text-stone-400 flex items-start gap-1">
                            <MapPin className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                            <span className="truncate">{dest.address}</span>
                          </p>
                        )}
                        {dest.nearby_distance && (
                          <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                            <Navigation className="h-2.5 w-2.5 shrink-0" />
                            <span>Nearby: {dest.nearby_distance}</span>
                          </p>
                        )}
                      </div>
                      <p className="flex-1 text-[11px] text-stone-500 mt-1 line-clamp-2 leading-relaxed">
                        {dest.desc || "Tidak ada deskripsi."}
                      </p>
                    </>
                  )}
                  
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100">
                    <div className="flex items-center gap-1.5 text-xs text-stone-600 font-medium">
                      <span>Rating</span>
                      <span className="text-amber-400">★</span>
                      {isEditing("dest", i) ? (
                        <Input 
                          className="h-6 w-12 text-xs px-1 py-0 text-center font-semibold"
                          value={dest.rating}
                          onChange={(e) => {
                            const newDests = [...config.destinations];
                            newDests[i].rating = e.target.value;
                            setConfig({ ...config, destinations: newDests });
                          }}
                        />
                      ) : (
                        <span className="font-semibold text-stone-900">{dest.rating}</span>
                      )}
                      {!isEditing("dest", i) && dest.reviewCount && (
                        <span className="text-stone-400 font-normal">({dest.reviewCount} ulasan)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditing("dest", i) ? (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => setEditingItem(null)}>
                          <Check className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400 hover:text-stone-600" onClick={() => setEditingItem({ type: "dest", index: i })}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
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
              onClick={() => {
                setConfig({
                  ...config,
                  culinary: [...config.culinary, { name: "Kuliner Baru", desc: "", image: "", category: "Cemilan" }],
                });
                setEditingItem({ type: "culinary", index: config.culinary.length });
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Kuliner
            </Button>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 snap-x">
            {config.culinary.map((cul, i) => (
              <Card key={i} className="w-64 shrink-0 border-stone-200 shadow-sm overflow-hidden flex flex-col snap-start relative group bg-white">
                <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6 text-white bg-black/20 rounded-full hover:bg-black/40 z-10">
                  <MoreVertical className="h-3 w-3" />
                </Button>
                
                <div 
                  className="h-32 bg-stone-100 relative cursor-pointer group/img"
                  onClick={() => setPickerState({ open: true, target: { type: "culinary", index: i } })}
                >
                  {cul.image ? (
                    <img src={getDisplayImageUrl(cul.image)} alt={cul.name} onError={(e) => handleImageError(e, "culinary")} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-stone-400">Pilih Gambar</div>
                  )}
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <Pencil className="h-5 w-5 text-white" />
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col p-4 gap-2">
                  {isEditing("culinary", i) ? (
                    <div className="space-y-2 flex-1 flex flex-col">
                      <div className="flex gap-1.5 p-1.5 bg-emerald-50 rounded border border-emerald-100">
                        <Input
                          className="h-6 text-[10px] px-2 py-0 bg-white"
                          placeholder="Paste Link Share Google Maps..."
                          value={autoFillQuery[`culinary-${i}`] || ""}
                          onChange={(e) => setAutoFillQuery(prev => ({ ...prev, [`culinary-${i}`]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          type="button"
                          className="h-6 text-[10px] px-2 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 font-bold"
                          onClick={() => handleAutoFill(i, "culinary")}
                        >
                          Tarik Data
                        </Button>
                      </div>

                      <Input 
                        className="h-7 text-sm font-bold px-2 py-0"
                        placeholder="Nama Kuliner"
                        value={cul.name}
                        onChange={(e) => {
                          const newCul = [...config.culinary];
                          newCul[i].name = e.target.value;
                          setConfig({ ...config, culinary: newCul });
                        }}
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          className="h-6 text-[10px] text-stone-500 px-2 py-0"
                          placeholder="Kategori (e.g. Cemilan)"
                          value={cul.category}
                          onChange={(e) => {
                            const newCul = [...config.culinary];
                            newCul[i].category = e.target.value;
                            setConfig({ ...config, culinary: newCul });
                          }}
                        />
                        <Input 
                          className="h-6 text-[10px] text-stone-500 px-2 py-0"
                          placeholder="Rating (e.g. 4.7)"
                          value={cul.rating || ""}
                          onChange={(e) => {
                            const newCul = [...config.culinary];
                            newCul[i].rating = e.target.value;
                            setConfig({ ...config, culinary: newCul });
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          className="h-6 text-[10px] text-stone-500 px-2 py-0"
                          placeholder="Alamat"
                          value={cul.address || ""}
                          onChange={(e) => {
                            const newCul = [...config.culinary];
                            newCul[i].address = e.target.value;
                            setConfig({ ...config, culinary: newCul });
                          }}
                        />
                        <Input 
                          className="h-6 text-[10px] text-stone-500 px-2 py-0"
                          placeholder="Ulasan"
                          value={cul.reviewCount || ""}
                          onChange={(e) => {
                            const newCul = [...config.culinary];
                            newCul[i].reviewCount = e.target.value;
                            setConfig({ ...config, culinary: newCul });
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input 
                          className="h-6 text-[10px] text-stone-500 px-2 py-0"
                          placeholder="Google Place ID"
                          value={cul.google_place_id || ""}
                          onChange={(e) => {
                            const newCul = [...config.culinary];
                            newCul[i].google_place_id = e.target.value;
                            setConfig({ ...config, culinary: newCul });
                          }}
                        />
                        <div className="flex gap-1">
                          <Input 
                            className="h-6 text-[10px] text-stone-500 px-2 py-0"
                            placeholder="Jarak Pomah (e.g. 3 km)"
                            value={cul.nearby_distance || ""}
                            onChange={(e) => {
                              const newCul = [...config.culinary];
                              newCul[i].nearby_distance = e.target.value;
                              setConfig({ ...config, culinary: newCul });
                            }}
                          />
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="h-6 text-[10px] px-2"
                            disabled={!cul.google_place_id}
                            onClick={() => {
                               if (cul.google_place_id) fetchDistance(cul.google_place_id, i, "culinary");
                            }}
                          >
                            Tarik
                          </Button>
                        </div>
                      </div>
                      <Textarea 
                        className="h-14 text-xs text-stone-650 resize-none p-2 mt-1"
                        placeholder="Deskripsi..."
                        value={cul.desc}
                        onChange={(e) => {
                          const newCul = [...config.culinary];
                          newCul[i].desc = e.target.value;
                          setConfig({ ...config, culinary: newCul });
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-stone-900 text-sm truncate">{cul.name}</h3>
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-semibold rounded">
                          {cul.category}
                        </span>
                      </div>
                      
                      {cul.address && (
                        <p className="text-[10px] text-stone-400 flex items-start gap-1">
                          <MapPin className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                          <span className="truncate">{cul.address}</span>
                        </p>
                      )}
                      {cul.nearby_distance && (
                        <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-0.5">
                          <Navigation className="h-2.5 w-2.5 shrink-0" />
                          <span>Nearby: {cul.nearby_distance}</span>
                        </p>
                      )}
                      
                      <p className="flex-1 text-[11px] text-stone-500 mt-2 line-clamp-2 leading-relaxed">
                        {cul.desc || "Tidak ada deskripsi."}
                      </p>

                      <div className="flex items-center gap-1 text-[10px] text-stone-500 mt-2 border-t border-stone-100 pt-1.5 font-medium">
                        <span className="text-amber-400">★</span>
                        <span className="font-semibold text-stone-900">{cul.rating || "—"}</span>
                        {cul.reviewCount && <span>({cul.reviewCount} ulasan)</span>}
                      </div>
                    </>
                  )}
                </div>
                
                <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  {isEditing("culinary", i) ? (
                    <Button variant="secondary" size="icon" className="h-7 w-7 shadow-sm text-emerald-600" onClick={() => setEditingItem(null)}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button variant="secondary" size="icon" className="h-7 w-7 shadow-sm text-stone-600" onClick={() => setEditingItem({ type: "culinary", index: i })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button 
                    variant="destructive" 
                    size="icon" 
                    className="h-7 w-7 shadow-sm"
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
        <div className="grid lg:grid-cols-2 gap-8">
          
          {/* Event Mendatang */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-stone-200 pb-2">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-stone-900">Event Mendatang</h2>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-6 text-[10px] px-2 gap-1 text-emerald-700 hover:text-emerald-800"
                  disabled={syncAIMutation.isPending}
                  onClick={() => syncAIMutation.mutate()}
                >
                  <Sparkles className="h-3 w-3" />
                  {syncAIMutation.isPending ? "Sedang Menarik AI..." : "Tarik Data via AI"}
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-stone-400 hover:text-stone-900"
                onClick={() => {
                  setConfig({
                    ...config,
                    events: [...config.events, { title: "Event Baru", date: "", location: "", desc: "", image: "" }],
                  });
                  setEditingItem({ type: "event", index: config.events.length });
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {config.events.map((ev, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  <div 
                    className="h-16 w-16 bg-stone-100 rounded overflow-hidden shrink-0 border border-stone-200 cursor-pointer relative"
                    onClick={() => setPickerState({ open: true, target: { type: "event", index: i } })}
                  >
                    {ev.image ? (
                      <img src={getDisplayImageUrl(ev.image)} alt={ev.title} onError={(e) => handleImageError(e, "event")} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[8px] text-stone-400">Img</div>
                    )}
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Pencil className="h-3 w-3 text-white" />
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      {isEditing("event", i) ? (
                        <div className="flex gap-1.5 w-full">
                          <Input 
                            className="h-6 flex-1 text-xs font-bold text-stone-900 px-1.5 py-0"
                            placeholder="Judul Event"
                            value={ev.title}
                            onChange={(e) => {
                              const newEv = [...config.events];
                              newEv[i].title = e.target.value;
                              setConfig({ ...config, events: newEv });
                            }}
                          />
                          <Input 
                            className="h-6 w-20 text-[10px] text-stone-500 px-1 py-0 shrink-0"
                            placeholder="Label (e.g. EVENT)"
                            value={ev.label || ""}
                            onChange={(e) => {
                              const newEv = [...config.events];
                              newEv[i].label = e.target.value;
                              setConfig({ ...config, events: newEv });
                            }}
                          />
                          <Input 
                            className="h-6 w-20 text-[10px] text-stone-500 px-1 py-0 shrink-0"
                            placeholder="Tanggal"
                            value={ev.date}
                            onChange={(e) => {
                              const newEv = [...config.events];
                              newEv[i].date = e.target.value;
                              setConfig({ ...config, events: newEv });
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-[8px] font-bold bg-emerald-50 text-emerald-700 px-1 py-0.5 rounded border border-emerald-100 shrink-0">
                              {ev.label || "EVENT"}
                            </span>
                            <h3 className="text-xs font-bold text-stone-900 truncate">{ev.title}</h3>
                          </div>
                          <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded shrink-0">{ev.date}</span>
                        </>
                      )}
                    </div>
                    
                    {isEditing("event", i) ? (
                      <div className="flex items-center gap-1 text-[10px] text-stone-400 px-1">
                        <MapPin className="h-3 w-3 text-stone-450 shrink-0" />
                        <Input 
                          className="h-5 flex-1 text-[10px] px-1 py-0"
                          placeholder="Lokasi"
                          value={ev.location}
                          onChange={(e) => {
                            const newEv = [...config.events];
                            newEv[i].location = e.target.value;
                            setConfig({ ...config, events: newEv });
                          }}
                        />
                      </div>
                    ) : (
                      <p className="text-[10px] text-stone-500 flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-stone-400 shrink-0" /> {ev.location}
                      </p>
                    )}
                    
                    {isEditing("event", i) ? (
                      <Textarea 
                        className="h-12 text-[10px] text-stone-500 resize-none p-1 leading-snug mt-1"
                        placeholder="Deskripsi..."
                        value={ev.desc}
                        onChange={(e) => {
                          const newEv = [...config.events];
                          newEv[i].desc = e.target.value;
                          setConfig({ ...config, events: newEv });
                        }}
                      />
                    ) : (
                      <p className="text-[11px] text-stone-600 line-clamp-2 leading-snug mt-1">
                        {ev.desc || "Tidak ada deskripsi."}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isEditing("event", i) ? (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => setEditingItem(null)}>
                        <Check className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400 hover:text-stone-600" onClick={() => setEditingItem({ type: "event", index: i })}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
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
                onClick={() => {
                  setConfig({
                    ...config,
                    news: [...config.news, { title: "Berita Baru", date: "", url: "", desc: "", image: "" }],
                  });
                  setEditingItem({ type: "news", index: config.news.length });
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-3">
              {config.news.map((nw, i) => (
                <div key={i} className="flex gap-4 items-start group">
                  <div 
                    className="h-16 w-16 bg-stone-100 rounded overflow-hidden shrink-0 border border-stone-200 cursor-pointer relative"
                    onClick={() => setPickerState({ open: true, target: { type: "news", index: i } })}
                  >
                    {nw.image ? (
                      <img src={getDisplayImageUrl(nw.image)} alt={nw.title} onError={(e) => handleImageError(e, "news")} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[8px] text-stone-400">Img</div>
                    )}
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Pencil className="h-3 w-3 text-white" />
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      {isEditing("news", i) ? (
                        <div className="flex gap-1.5 w-full">
                          <Input 
                            className="h-6 flex-1 text-xs font-bold text-stone-900 px-1 py-0"
                            placeholder="Judul Berita"
                            value={nw.title}
                            onChange={(e) => {
                              const newNw = [...config.news];
                              newNw[i].title = e.target.value;
                              setConfig({ ...config, news: newNw });
                            }}
                          />
                          <Input 
                            className="h-6 w-20 text-[10px] text-stone-500 px-1 py-0 shrink-0"
                            placeholder="Label (e.g. BERITA)"
                            value={nw.label || ""}
                            onChange={(e) => {
                              const newNw = [...config.news];
                              newNw[i].label = e.target.value;
                              setConfig({ ...config, news: newNw });
                            }}
                          />
                          <Input 
                            className="h-6 w-20 text-[10px] text-stone-500 px-1 py-0 shrink-0"
                            placeholder="Tanggal"
                            value={nw.date}
                            onChange={(e) => {
                              const newNw = [...config.news];
                              newNw[i].date = e.target.value;
                              setConfig({ ...config, news: newNw });
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-[8px] font-bold bg-purple-50 text-purple-700 px-1 py-0.5 rounded border border-purple-100 shrink-0">
                              {nw.label || "BERITA"}
                            </span>
                            <h3 className="text-xs font-bold text-stone-900 truncate">{nw.title}</h3>
                          </div>
                          <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded shrink-0">{nw.date}</span>
                        </>
                      )}
                    </div>
                    
                    {isEditing("news", i) ? (
                      <div className="grid grid-cols-2 gap-1.5 mt-1">
                        <Input 
                          className="h-5 text-[10px] px-1 py-0"
                          placeholder="Lokasi"
                          value={nw.location || ""}
                          onChange={(e) => {
                            const newNw = [...config.news];
                            newNw[i].location = e.target.value;
                            setConfig({ ...config, news: newNw });
                          }}
                        />
                        <Input 
                          className="h-5 text-[10px] px-1 py-0"
                          placeholder="URL Artikel"
                          value={nw.url}
                          onChange={(e) => {
                            const newNw = [...config.news];
                            newNw[i].url = e.target.value;
                            setConfig({ ...config, news: newNw });
                          }}
                        />
                      </div>
                    ) : (
                      nw.location && (
                        <p className="text-[10px] text-stone-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-stone-400 shrink-0" /> {nw.location}
                        </p>
                      )
                    )}
                    
                    {isEditing("news", i) ? (
                      <Textarea 
                        className="h-12 text-[10px] text-stone-500 resize-none p-1 leading-snug mt-1"
                        placeholder="Deskripsi..."
                        value={nw.desc}
                        onChange={(e) => {
                          const newNw = [...config.news];
                          newNw[i].desc = e.target.value;
                          setConfig({ ...config, news: newNw });
                        }}
                      />
                    ) : (
                      <p className="text-[11px] text-stone-600 line-clamp-2 leading-snug mt-1">
                        {nw.desc || "Tidak ada deskripsi."}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isEditing("news", i) ? (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => setEditingItem(null)}>
                        <Check className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-stone-400 hover:text-stone-600" onClick={() => setEditingItem({ type: "news", index: i })}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
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
