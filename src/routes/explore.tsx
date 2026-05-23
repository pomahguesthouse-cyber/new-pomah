import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicSiteData } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import {
  MapPin,
  Calendar,
  Search,
  Star,
  ArrowRight,
  Bookmark,
  ChevronRight,
  ChevronLeft,
  Utensils,
  TreePine,
  ShoppingBag,
  Drama,
  Bus,
  LayoutGrid,
  Droplets,
  Wind,
  Eye,
  CloudSun,
  BookOpen,
  RefreshCw,
  ThumbsUp,
  Navigation,
} from "lucide-react";
import { mergeExploreConfig } from "@/admin/modules/explore/explore.config";

export const Route = createFileRoute("/explore")({
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => ({
    meta: [
      { title: "Jelajahi Semarang — Destinasi Wisata & Kuliner" },
      {
        name: "description",
        content: "Temukan destinasi wisata terkenal, kuliner terbaik, event seru, dan berita terbaru di Kota Semarang.",
      },
    ],
  }),
  component: ExploreSemarang,
});

/* ── Helpers ────────────────────────────────────────────────────────── */

const DAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const CATEGORIES = [
  { key: "all", label: "Semua", icon: LayoutGrid },
  { key: "dest", label: "Destinasi", icon: MapPin },
  { key: "culinary", label: "Kuliner", icon: Utensils },
  { key: "event", label: "Event", icon: Calendar },
  { key: "alam", label: "Alam", icon: TreePine },
  { key: "belanja", label: "Belanja", icon: ShoppingBag },
  { key: "budaya", label: "Budaya", icon: Drama },
  { key: "transport", label: "Transportasi", icon: Bus },
] as const;

const POPULAR_TAGS = ["Lawang Sewu", "Kota Lama", "Kuliner", "Event", "Wisata Alam"];

const getLabelStyle = (label: string) => {
  const l = label.toUpperCase();
  if (l === "EVENT") return "bg-emerald-50 text-emerald-700 border border-emerald-100";
  if (l === "BERITA") return "bg-purple-50 text-purple-700 border border-purple-100";
  if (l === "TRANSPORTASI" || l === "TRANSPORT") return "bg-blue-50 text-blue-700 border border-blue-100";
  return "bg-stone-50 text-stone-600 border border-stone-100";
};

/* ── Horizontal scroll hook ─────────────────────────────────────────── */

function useSliderTransform(itemCount: number, autoScroll: boolean = true) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [maxTranslate, setMaxTranslate] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const itemWidth = 220;
  const gap = 16;
  const step = itemWidth + gap;

  const updateMeasurements = () => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      const totalWidth = itemCount * itemWidth + (itemCount > 0 ? (itemCount - 1) * gap : 0);
      setMaxTranslate(Math.max(0, totalWidth - containerWidth));
    }
  };

  useEffect(() => {
    updateMeasurements();
    window.addEventListener("resize", updateMeasurements);
    return () => window.removeEventListener("resize", updateMeasurements);
  }, [itemCount]);

  const maxIndex = Math.ceil(maxTranslate / step);

  useEffect(() => {
    // Reset index if maxTranslate shrinks
    setIndex((prev) => Math.min(prev, Math.max(0, maxIndex)));
  }, [maxIndex]);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      const handleMouseEnter = () => setIsHovered(true);
      const handleMouseLeave = () => setIsHovered(false);
      el.addEventListener("mouseenter", handleMouseEnter);
      el.addEventListener("mouseleave", handleMouseLeave);
      return () => {
        el.removeEventListener("mouseenter", handleMouseEnter);
        el.removeEventListener("mouseleave", handleMouseLeave);
      };
    }
  }, []);

  const scroll = (dir: "left" | "right") => {
    setIndex((prev) => {
      if (dir === "left") return Math.max(0, prev - 1);
      return Math.min(maxIndex, prev + 1);
    });
  };

  useEffect(() => {
    if (!autoScroll || isHovered || maxIndex <= 0) return;
    const interval = setInterval(() => {
      setIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
    }, 4500); // 4.5 seconds for slower auto play
    return () => clearInterval(interval);
  }, [autoScroll, isHovered, maxIndex]);

  const currentTranslate = Math.min(index * step, maxTranslate);
  const showLeft = currentTranslate > 0;
  const showRight = currentTranslate < maxTranslate;

  return { containerRef, currentTranslate, showLeft, showRight, scroll };
}

/* ── Main Component ─────────────────────────────────────────────────── */

function ExploreSemarang() {
  const loaderData = Route.useLoaderData();
  const fn = useServerFn(getPublicSiteData);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fn(),
    initialData: loaderData,
  });

  const config = mergeExploreConfig(data?.property?.explore_config);
  const now = useCurrentTime();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Combine events + news for the sidebar
  const sidebarItems = [
    ...config.events.map((ev) => ({
      type: "event" as const,
      title: ev.title,
      date: ev.date,
      location: ev.location,
      desc: ev.desc,
      image: ev.image,
      label: ev.label || "EVENT",
    })),
    ...config.news.map((nw) => ({
      type: "news" as const,
      title: nw.title,
      date: nw.date,
      location: nw.location || "",
      desc: nw.desc,
      image: nw.image,
      label: nw.label || "BERITA",
    })),
  ];

  // Filters for keyword-based tabs (Alam, Belanja, Budaya, Transportasi)
  const getKeywordsForTab = (tab: string) => {
    if (tab === "alam") return ["alam", "pantai", "gunung", "wisata alam", "outdoor", "park", "taman", "air", "sungai", "curug", "laut"];
    if (tab === "belanja") return ["belanja", "mall", "pasar", "oleh-oleh", "shopping", "toko", "suvenir", "pusat"];
    if (tab === "budaya") return ["budaya", "sejarah", "museum", "candi", "kelenteng", "masjid", "gereja", "culture", "monumen", "tua", "heritage"];
    if (tab === "transport") return ["transport", "bus", "kereta", "stasiun", "bandara", "rute", "jalan", "trans", "akses"];
    return [];
  };

  const itemMatchesTabKeywords = (name: string, desc: string, tab: string) => {
    const kws = getKeywordsForTab(tab);
    if (kws.length === 0) return true;
    const txt = `${name} ${desc}`.toLowerCase();
    return kws.some((kw) => txt.includes(kw));
  };

  // Filtered items based on tab and search query
  const filteredDestinations = config.destinations.filter((d) => {
    const matchesSearch =
      searchQuery === "" ||
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.desc.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTab = activeTab === "all" || activeTab === "dest" || itemMatchesTabKeywords(d.name, d.desc, activeTab);
    return matchesSearch && matchesTab;
  });

  const filteredCulinary = config.culinary.filter((c) => {
    const matchesSearch =
      searchQuery === "" ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.category.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab = activeTab === "all" || activeTab === "culinary" || itemMatchesTabKeywords(c.name, c.desc, activeTab);
    return matchesSearch && matchesTab;
  });

  const destScroll = useSliderTransform(filteredDestinations.length, true);
  const culScroll = useSliderTransform(filteredCulinary.length, true);

  const filteredEvents = config.events.filter((e) => {
    const matchesSearch =
      searchQuery === "" ||
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.location.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab = activeTab === "all" || activeTab === "event" || itemMatchesTabKeywords(e.title, e.desc, activeTab);
    return matchesSearch && matchesTab;
  });

  const filteredSidebarItems = sidebarItems.filter((item) => {
    const matchesSearch =
      searchQuery === "" ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.location.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab = activeTab === "all" || (item.type === "event" && activeTab === "event") || itemMatchesTabKeywords(item.title, item.desc, activeTab);
    return matchesSearch && matchesTab;
  });

  const isBrowsingAll = activeTab === "all";

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>
      <PublicNav property={data?.property} transparent={true} />

      {/* ═══════════════ HERO SECTION ═══════════════ */}
      <header className="relative overflow-hidden min-h-[580px] md:h-[485px] flex items-stretch md:items-center">
        {/* Background image or video */}
        {config.hero.videoUrl ? (
          <video
            className="absolute inset-0 w-full h-full object-cover"
            src={config.hero.videoUrl}
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url('${config.hero.bgImageUrl}')` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-stone-950/85 via-stone-900/60 to-stone-950/45" />

        <div className="relative mx-auto max-w-7xl px-6 w-full pt-28 pb-8 md:pt-24">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-10">
            {/* Left — Title + Search */}
            <div className="flex-1 max-w-2xl">
              <span className="inline-block text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400 mb-3 bg-emerald-950/30 px-2.5 py-1 rounded-md border border-emerald-900/20">
                City Guide
              </span>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white leading-tight tracking-tight">
                {config.hero.heading}
              </h1>
              <p className="mt-3 text-stone-300 text-sm md:text-base leading-relaxed max-w-lg">
                Temukan destinasi wisata, kuliner, event menarik dan informasi seputar Kota Semarang.
              </p>

              {/* Search bar */}
              <div className="mt-8 flex items-center bg-white rounded-xl shadow-lg border border-stone-200/20 max-w-lg p-1">
                <input
                  type="text"
                  placeholder="Cari destinasi, kuliner, atau event..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 px-4 py-3 text-sm text-stone-850 placeholder:text-stone-400 outline-none bg-transparent"
                />
                <button className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white p-3 rounded-lg transition-colors shadow-sm shadow-emerald-500/10">
                  <Search className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* Popular tags */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-stone-300 uppercase tracking-wider">Populer:</span>
                {POPULAR_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSearchQuery(tag)}
                    className="text-[11px] text-stone-100 bg-black/35 hover:bg-black/50 px-3.5 py-1.5 rounded-full transition-colors border border-white/5"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Right — Weather Widget */}
            <div className="shrink-0 bg-black/35 backdrop-blur-md border border-white/10 rounded-xl p-5 text-white w-full sm:w-[320px] lg:w-[300px] shadow-xl">
              <div className="text-right text-[11px] text-stone-300 font-medium">
                {DAYS_ID[now.getDay()]}, {now.getDate()} {MONTHS_ID[now.getMonth()]} {now.getFullYear()}
              </div>
              <div className="text-right mt-1">
                <span className="text-3xl font-bold tracking-tight tabular-nums">
                  {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
                </span>
                <span className="text-[10px] text-stone-300 ml-1">WIB</span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-stone-200">
                    <MapPin className="h-3 w-3 text-emerald-400" /> Semarang
                  </div>
                  <p className="text-[10px] text-stone-400 mt-0.5">Jawa Tengah, Indonesia</p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <div>
                    <div className="text-2xl font-bold">31°C</div>
                    <p className="text-[10px] text-stone-300">Cerah Berawan</p>
                  </div>
                  <CloudSun className="h-9 w-9 text-amber-300 ml-1.5" />
                </div>
              </div>

              <div className="mt-4 pt-3.5 border-t border-white/10 grid grid-cols-3 gap-2 text-[10px] text-stone-300">
                <div className="flex flex-col items-center text-center">
                  <Droplets className="h-4 w-4 text-emerald-400 mb-1" />
                  <span className="font-semibold text-white">62%</span>
                  <span className="text-[9px] text-stone-400">Kelembapan</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <Wind className="h-4 w-4 text-emerald-400 mb-1" />
                  <span className="font-semibold text-white">12 km/jam</span>
                  <span className="text-[9px] text-stone-400">Angin</span>
                </div>
                <div className="flex flex-col items-center text-center">
                  <Eye className="h-4 w-4 text-emerald-400 mb-1" />
                  <span className="font-semibold text-white">10 km</span>
                  <span className="text-[9px] text-stone-400">Jarak Pandang</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ═══════════════ CATEGORY TABS ═══════════════ */}
      <div className="bg-white border-b border-stone-200/80 sticky top-0 z-30 shadow-sm">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center gap-2.5 overflow-x-auto py-4 scrollbar-hide md:justify-center">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = activeTab === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => {
                    setActiveTab(cat.key);
                    setSearchQuery(""); // Clear search when switching tabs
                  }}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap border ${
                    active
                      ? "bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/10"
                      : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-850"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════ MAIN CONTENT ═══════════════ */}
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* ── LEFT COLUMN (feed items or grid views) ── */}
          <div className="flex-1 min-w-0 space-y-10">
            
            {/* If browsing dashboard view ("Semua") */}
            {isBrowsingAll && (
              <>
                {/* Destinasi Wisata */}
                {filteredDestinations.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-base font-bold text-stone-900 uppercase tracking-wide">
                        <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                          <MapPin className="h-4.5 w-4.5" />
                        </span>
                        Destinasi Wisata
                      </h2>
                      <button 
                        onClick={() => setActiveTab("dest")}
                        className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition"
                      >
                        Lihat Semua <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="relative group/scroll" ref={destScroll.containerRef}>
                      <div className="overflow-hidden pb-4">
                        <div
                          className="flex gap-4 transition-transform duration-[800ms] ease-out"
                          style={{ transform: `translateX(-${destScroll.currentTranslate}px)` }}
                        >
                          {filteredDestinations.map((dest, i) => (
                            <div
                            key={`dest-${dest.name}-${i}`}
                            className="shrink-0 w-[220px] bg-white rounded-xl border border-stone-200/60 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group/card cursor-pointer animate-card-slide"
                            style={{ animationDelay: `${i * 80}ms` }}
                          >
                            <div className="relative h-[135px] overflow-hidden bg-stone-100">
                              {dest.image ? (
                                <img
                                  src={dest.image}
                                  alt={dest.name}
                                  className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-stone-300 text-xs">
                                  No Image
                                </div>
                              )}
                              <button className="absolute top-2.5 right-2.5 bg-white border border-stone-100 p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 hover:shadow-sm transition">
                                <Bookmark className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="p-4">
                              <h3 className="font-bold text-sm text-stone-900 group-hover/card:text-emerald-700 transition truncate">
                                {dest.name}
                              </h3>
                              {dest.nearby_distance && (
                                <div className="mt-1 flex">
                                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-100/50">
                                    <Navigation className="h-2.5 w-2.5 shrink-0" />
                                    {dest.nearby_distance} dari Pomah
                                  </span>
                                </div>
                              )}
                              <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed line-clamp-3">
                                {dest.desc}
                              </p>
                              <div className="mt-3.5 pt-2.5 border-t border-stone-100 flex items-center gap-1 text-[11px] text-stone-600 font-medium">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                <span className="text-stone-900 font-bold">{dest.rating}</span>
                                {dest.reviewCount && (
                                  <span className="text-stone-400 font-normal">({dest.reviewCount} ulasan)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      </div>

                      {/* Scroll arrows */}
                      {destScroll.showLeft && (
                        <button
                          onClick={() => destScroll.scroll("left")}
                          className="absolute left-0 top-[67px] -translate-y-1/2 -translate-x-3.5 bg-white border border-stone-200 rounded-full p-2 shadow-md text-stone-600 hover:text-stone-950 transition z-10"
                        >
                          <ChevronLeft className="h-4.5 w-4.5" />
                        </button>
                      )}
                      {destScroll.showRight && (
                        <button
                          onClick={() => destScroll.scroll("right")}
                          className="absolute right-0 top-[67px] -translate-y-1/2 translate-x-3.5 bg-white border border-stone-200 rounded-full p-2 shadow-md text-stone-600 hover:text-stone-950 transition z-10"
                        >
                          <ChevronRight className="h-4.5 w-4.5" />
                        </button>
                      )}
                    </div>
                  </section>
                )}

                {/* Kuliner Terbaik */}
                {filteredCulinary.length > 0 && (
                  <section className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="flex items-center gap-2 text-base font-bold text-stone-900 uppercase tracking-wide">
                        <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                          <Utensils className="h-4.5 w-4.5" />
                        </span>
                        Kuliner Terbaik
                      </h2>
                      <button 
                        onClick={() => setActiveTab("culinary")}
                        className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition"
                      >
                        Lihat Semua <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="relative group/scroll" ref={culScroll.containerRef}>
                      <div className="overflow-hidden pb-4">
                        <div
                          className="flex gap-4 transition-transform duration-[800ms] ease-out"
                          style={{ transform: `translateX(-${culScroll.currentTranslate}px)` }}
                        >
                          {filteredCulinary.map((cul, i) => (
                            <div
                            key={`cul-${cul.name}-${i}`}
                            className="shrink-0 w-[220px] bg-white rounded-xl border border-stone-200/60 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group/card cursor-pointer animate-card-slide"
                            style={{ animationDelay: `${i * 80}ms` }}
                          >
                            <div className="relative h-[135px] overflow-hidden bg-stone-100">
                              {cul.image ? (
                                <img
                                  src={cul.image}
                                  alt={cul.name}
                                  className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-stone-300 text-xs">
                                  No Image
                                </div>
                              )}
                              <button className="absolute top-2.5 right-2.5 bg-white border border-stone-100 p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 hover:shadow-sm transition">
                                <Bookmark className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="p-4">
                              <div className="flex items-center justify-between gap-1">
                                <h3 className="font-bold text-sm text-stone-900 group-hover/card:text-emerald-700 transition truncate">
                                  {cul.name}
                                </h3>
                              </div>
                              <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">{cul.category}</p>
                              {cul.address && (
                                <p className="text-[10px] text-stone-400 mt-1 flex items-start gap-1 leading-snug">
                                  <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                  <span className="truncate">{cul.address}</span>
                                </p>
                              )}
                              {cul.nearby_distance && (
                                <p className="text-[10px] text-emerald-600 font-semibold mt-1 flex items-center gap-1 leading-snug">
                                  <Navigation className="h-3 w-3 shrink-0" />
                                  <span>Nearby: {cul.nearby_distance}</span>
                                </p>
                              )}
                              <p className="mt-2 text-[11px] text-stone-500 leading-relaxed line-clamp-2">
                                {cul.desc}
                              </p>
                              <div className="mt-3.5 pt-2.5 border-t border-stone-100 flex items-center gap-1 text-[11px] text-stone-600 font-medium">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                <span className="text-stone-900 font-bold">{cul.rating || "—"}</span>
                                {cul.reviewCount && (
                                  <span className="text-stone-400 font-normal">({cul.reviewCount} ulasan)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      </div>

                      {/* Scroll arrows */}
                      {culScroll.showLeft && (
                        <button
                          onClick={() => culScroll.scroll("left")}
                          className="absolute left-0 top-[67px] -translate-y-1/2 -translate-x-3.5 bg-white border border-stone-200 rounded-full p-2 shadow-md text-stone-600 hover:text-stone-950 transition z-10"
                        >
                          <ChevronLeft className="h-4.5 w-4.5" />
                        </button>
                      )}
                      {culScroll.showRight && (
                        <button
                          onClick={() => culScroll.scroll("right")}
                          className="absolute right-0 top-[67px] -translate-y-1/2 translate-x-3.5 bg-white border border-stone-200 rounded-full p-2 shadow-md text-stone-600 hover:text-stone-950 transition z-10"
                        >
                          <ChevronRight className="h-4.5 w-4.5" />
                        </button>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* If a specific category tab is active (shows grid layout) */}
            {!isBrowsingAll && (
              <section className="space-y-6">
                <div className="flex items-center justify-between pb-2 border-b border-stone-200/80">
                  <h2 className="text-lg font-extrabold text-stone-900 flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                      {activeTab === "dest" ? <MapPin className="h-5 w-5" /> : activeTab === "culinary" ? <Utensils className="h-5 w-5" /> : activeTab === "event" ? <Calendar className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
                    </span>
                    {CATEGORIES.find((c) => c.key === activeTab)?.label || "City Guide"}
                  </h2>
                  <span className="text-xs font-semibold text-stone-500">
                    {filteredDestinations.length + filteredCulinary.length + (activeTab === "event" ? filteredEvents.length : 0)} items ditemukan
                  </span>
                </div>

                {/* Grid container */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                  {/* Destinations Grid */}
                  {(activeTab === "dest" || activeTab === "alam" || activeTab === "belanja" || activeTab === "budaya" || activeTab === "transport") &&
                    filteredDestinations.map((dest, i) => (
                      <div
                        key={`dest-grid-${dest.name}-${i}`}
                        className="bg-white rounded-xl border border-stone-200/60 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group/card cursor-pointer flex flex-col animate-card-slide"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        <div className="relative h-[150px] overflow-hidden bg-stone-100">
                          {dest.image ? (
                            <img
                              src={dest.image}
                              alt={dest.name}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-stone-300 text-xs">
                              No Image
                            </div>
                          )}
                          <button className="absolute top-2.5 right-2.5 bg-white border border-stone-100 p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 transition">
                            <Bookmark className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-bold text-sm text-stone-900 group-hover/card:text-emerald-700 transition truncate">
                              {dest.name}
                            </h3>
                            {dest.nearby_distance && (
                              <div className="mt-1 flex">
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold border border-emerald-100/50">
                                  <Navigation className="h-2.5 w-2.5 shrink-0" />
                                  {dest.nearby_distance} dari Pomah
                                </span>
                              </div>
                            )}
                            <p className="mt-2 text-[11px] text-stone-500 leading-relaxed line-clamp-3">
                              {dest.desc}
                            </p>
                          </div>
                          <div className="mt-4 pt-3 border-t border-stone-100 flex items-center gap-1 text-[11px] text-stone-600 font-medium">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-stone-900 font-bold">{dest.rating}</span>
                            {dest.reviewCount && (
                              <span className="text-stone-400 font-normal">({dest.reviewCount} ulasan)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                  {/* Culinary Grid */}
                  {(activeTab === "culinary" || activeTab === "alam" || activeTab === "belanja" || activeTab === "budaya" || activeTab === "transport") &&
                    filteredCulinary.map((cul, i) => (
                      <div
                        key={`cul-grid-${cul.name}-${i}`}
                        className="bg-white rounded-xl border border-stone-200/60 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group/card cursor-pointer flex flex-col animate-card-slide"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        <div className="relative h-[150px] overflow-hidden bg-stone-100">
                          {cul.image ? (
                            <img
                              src={cul.image}
                              alt={cul.name}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-stone-300 text-xs">
                              No Image
                            </div>
                          )}
                          <button className="absolute top-2.5 right-2.5 bg-white border border-stone-100 p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 transition">
                            <Bookmark className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-bold text-sm text-stone-900 group-hover/card:text-emerald-700 transition truncate">
                              {cul.name}
                            </h3>
                            <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">{cul.category}</p>
                            {cul.address && (
                              <p className="text-[10px] text-stone-400 mt-1 flex items-start gap-1">
                                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                                <span className="truncate">{cul.address}</span>
                              </p>
                            )}
                            <p className="mt-2 text-[11px] text-stone-500 leading-relaxed line-clamp-3">
                              {cul.desc}
                            </p>
                          </div>
                          <div className="mt-4 pt-3 border-t border-stone-100 flex items-center gap-1 text-[11px] text-stone-600 font-medium">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span className="text-stone-900 font-bold">{cul.rating || "—"}</span>
                            {cul.reviewCount && (
                              <span className="text-stone-400 font-normal">({cul.reviewCount} ulasan)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                  {/* Event Grid (only if activeTab === "event") */}
                  {activeTab === "event" &&
                    filteredEvents.map((ev, i) => (
                      <div
                        key={`ev-grid-${ev.title}-${i}`}
                        className="bg-white rounded-xl border border-stone-200/60 overflow-hidden shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group/card cursor-pointer flex flex-col animate-card-slide"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        <div className="relative h-[150px] overflow-hidden bg-stone-100">
                          {ev.image ? (
                            <img
                              src={ev.image}
                              alt={ev.title}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-stone-300 text-xs">
                              No Image
                            </div>
                          )}
                          <span className="absolute top-2.5 left-2.5 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-sm">
                            {ev.label || "EVENT"}
                          </span>
                          <button className="absolute top-2.5 right-2.5 bg-white border border-stone-100 p-1.5 rounded-lg text-stone-500 hover:text-emerald-600 transition">
                            <Bookmark className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-bold text-sm text-stone-900 group-hover/card:text-emerald-700 transition truncate">
                              {ev.title}
                            </h3>
                            <div className="mt-2 space-y-0.5 text-[10px] text-stone-400 font-medium">
                              <p className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5 text-stone-400" /> {ev.date}
                              </p>
                              {ev.location && (
                                <p className="flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 text-stone-400" /> {ev.location}
                                </p>
                              )}
                            </div>
                            <p className="mt-2.5 text-[11px] text-stone-500 leading-relaxed line-clamp-3">
                              {ev.desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>

                {filteredDestinations.length === 0 && filteredCulinary.length === 0 && (activeTab !== "event" || filteredEvents.length === 0) && (
                  <div className="py-16 text-center border border-dashed border-stone-200 rounded-xl bg-white">
                    <p className="text-sm font-semibold text-stone-400">Tidak ada konten ditemukan untuk kategori ini.</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ── RIGHT SIDEBAR (News & Events) ── */}
          {filteredSidebarItems.length > 0 && (
            <aside className="w-full lg:w-[350px] shrink-0 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-stone-900 uppercase tracking-wide">
                  News &amp; Event Terbaru
                </h2>
                {isBrowsingAll && (
                  <button 
                    onClick={() => setActiveTab("event")}
                    className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition"
                  >
                    Lihat Semua <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="space-y-4.5">
                {filteredSidebarItems.slice(0, 4).map((item, i) => (
                  <div
                    key={i}
                    className="flex gap-4 bg-white rounded-xl border border-stone-200/60 p-3.5 hover:shadow-md transition-shadow duration-300 cursor-pointer group/item relative"
                  >
                    {/* Image */}
                    <div className="w-22 h-[92px] shrink-0 rounded-lg overflow-hidden bg-stone-100">
                      {item.image ? (
                        <img src={item.image} alt={item.title} className="w-full h-full object-cover transition-transform duration-500 group-hover/item:scale-103" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-300 text-[10px]">
                          No Img
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md ${getLabelStyle(
                            item.label
                          )}`}
                        >
                          {item.label}
                        </span>
                        <button className="text-stone-300 hover:text-emerald-600 transition shrink-0">
                          <Bookmark className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <h3 className="mt-2 text-xs font-bold text-stone-900 leading-snug line-clamp-2 group-hover/item:text-emerald-700 transition-colors">
                        {item.title}
                      </h3>

                      <div className="mt-1.5 space-y-0.5 text-[10px] text-stone-400 font-medium">
                        <p className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-stone-400" /> {item.date}
                        </p>
                        {item.location && (
                          <p className="flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-stone-400" /> {item.location}
                          </p>
                        )}
                      </div>

                      <p className="mt-2 text-[10px] text-stone-500 line-clamp-2 leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          )}

        </div>
      </main>

      {/* ═══════════════ BOTTOM INFO BAR ═══════════════ */}
      <div className="border-t border-stone-200/80 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: BookOpen,
                title: "Panduan Lengkap",
                desc: "Informasi lengkap seputar wisata, kuliner, dan event di Semarang.",
              },
              {
                icon: RefreshCw,
                title: "Update Terbaru",
                desc: "Konten selalu diperbarui agar Anda tidak ketinggalan informasi terbaru.",
              },
              {
                icon: ThumbsUp,
                title: "Rekomendasi Terbaik",
                desc: "Pilihan destinasi dan kuliner terbaik berdasarkan ulasan pengunjung.",
              },
              {
                icon: Navigation,
                title: "Mudah Dijangkau",
                desc: "Temukan lokasi dengan akses mudah dan transportasi terdekat.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex items-start gap-4 rounded-xl border border-stone-200/60 p-5 hover:border-emerald-200 hover:shadow-sm transition-all duration-300"
                >
                  <div className="shrink-0 p-3 rounded-lg bg-emerald-50 text-emerald-600">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wide">{item.title}</h3>
                    <p className="mt-1.5 text-[11px] text-stone-500 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PublicFooter property={data?.property} />

      {/* ─── Scrollbar-hide utility & animations ─── */}
      <style>{`
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        @keyframes slowSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .animate-card-slide {
          opacity: 0;
          animation: slowSlideIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
