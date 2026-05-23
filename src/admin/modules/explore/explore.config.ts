export type ExploreConfig = {
  hero: {
    heading: string;
    subheading: string;
    bgImageUrl: string;
    videoUrl?: string;
  };
  destinations: {
    name: string;
    desc: string;
    image: string;
    rating: string;
    reviewCount?: string;
    address?: string;
    google_place_id?: string;
    nearby_distance?: string;
  }[];
  culinary: {
    name: string;
    desc: string;
    image: string;
    category: string;
    rating?: string;
    reviewCount?: string;
    address?: string;
    google_place_id?: string;
    nearby_distance?: string;
  }[];
  events: {
    title: string;
    date: string;
    location: string;
    desc: string;
    image: string;
    label?: string;
  }[];
  news: {
    title: string;
    date: string;
    desc: string;
    url: string;
    image: string;
    label?: string;
    location?: string;
  }[];
};

export const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  hero: {
    heading: "Jelajahi Semarang",
    subheading:
      "Temukan destinasi wisata terkenal, kuliner terbaik, event menarik\ndan informasi seputar Kota Semarang.",
    bgImageUrl: "https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=1600",
    videoUrl: "https://assets.mixkit.co/videos/preview/mixkit-aerial-view-of-a-harbor-city-at-sunset-41484-large.mp4",
  },
  destinations: [
    {
      name: "Lawang Sewu",
      desc: "Gedung bersejarah peninggalan Belanda yang ikonik dengan ribuan pintu dan arsitektur megah.",
      image: "https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=600",
      rating: "4.8",
      reviewCount: "128",
      google_place_id: "ChIJL7O5z-VSdy4R90j2V95Rksw",
      nearby_distance: "3.2 km (8 menit)",
    },
    {
      name: "Kota Lama Semarang",
      desc: "Kawasan cagar budaya dengan bangunan-bangunan tua bernuansa Eropa klasik yang indah.",
      image: "https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=600",
      rating: "4.9",
      reviewCount: "96",
      google_place_id: "ChIJO8C9WjBTdy4RI_1QJz1_Cbs",
      nearby_distance: "4.5 km (12 menit)",
    },
    {
      name: "Sam Poo Kong",
      desc: "Kelenteng bersejarah tempat persinggahan Laksamana Cheng Ho, dengan nuansa merah yang fotogenik.",
      image: "https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&q=80&w=600",
      rating: "4.7",
      reviewCount: "74",
      google_place_id: "ChIJW_Z73Z9Sdy4Rsx8B5Vp_1Wk",
      nearby_distance: "2.8 km (7 menit)",
    },
    {
      name: "Masjid Agung Jawa Tengah",
      desc: "Masjid dengan arsitektur modern yang menjadi ikon religi kota Semarang.",
      image: "https://images.unsplash.com/photo-1564507592333-c60657eea523?auto=format&fit=crop&q=80&w=600",
      rating: "4.8",
      reviewCount: "63",
      google_place_id: "ChIJa8wH40FSdy4RvA60D42eS5g",
      nearby_distance: "5.1 km (15 menit)",
    },
    {
      name: "Pantai Marina",
      desc: "Pantai populer dengan pemandangan laut indah, cocok untuk bersantai saat sore hari.",
      image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=600",
      rating: "4.6",
      reviewCount: "42",
      google_place_id: "ChIJt7P4kXVSdy4Re9r_Vf98_aQ",
      nearby_distance: "7.4 km (18 menit)",
    },
  ],
  culinary: [
    {
      name: "Lumpia Gang Lombok",
      desc: "Lumpia legendaris Semarang dengan isian rebung segar, udang, dan telur.",
      image: "https://images.unsplash.com/photo-1541832676-9b763b0239ab?auto=format&fit=crop&q=80&w=400",
      category: "Cemilan",
      rating: "4.7",
      reviewCount: "231",
      address: "Jl. Gang Lombok No. 11, Semarang",
    },
    {
      name: "Tahu Gimbal Pak Edy",
      desc: "Perpaduan tahu goreng, gimbal udang, irisan kol, tauge, disiram kuah kacang petis.",
      image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=400",
      category: "Makan Siang",
      rating: "4.6",
      reviewCount: "189",
      address: "Jl. Sriwijaya No. 29, Semarang",
    },
    {
      name: "Nasi Ayam Bu Wido",
      desc: "Nasi liwet khas Semarang disajikan dengan suwiran ayam, telur pindang, dan kuah opor.",
      image: "https://images.unsplash.com/photo-1562967914-6c822e12e200?auto=format&fit=crop&q=80&w=400",
      category: "Makan Malam",
      rating: "4.8",
      reviewCount: "156",
      address: "Jl. S. Parman No. 75, Semarang",
    },
    {
      name: "Tahu Pong Karangturi",
      desc: "Tahu pong gurih yang disajikan hangat dengan cocolan kecap pedas manis.",
      image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&q=80&w=400",
      category: "Cemilan",
      rating: "4.5",
      reviewCount: "142",
      address: "Jl. Karangturi Raya, Semarang",
    },
    {
      name: "Soto Bangkong",
      desc: "Soto khas Semarang dengan kuah bening yang gurih dan pelengkap sate kerang.",
      image: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&q=80&w=400",
      category: "Makan Siang",
      rating: "4.6",
      reviewCount: "198",
      address: "Jl. Brigjen Katamso, Semarang",
    },
  ],
  events: [
    {
      title: "Semarang Night Carnival 2026",
      date: "15 Agustus 2026",
      location: "Kawasan Simpang Lima",
      desc: "Pawai budaya tahunan terbesar di Semarang dengan kostum-kostum meriah dan lampu gemerlap.",
      image: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&q=80&w=400",
      label: "EVENT",
    },
    {
      title: "Festival Kota Lama",
      date: "10-12 September 2026",
      location: "Kawasan Kota Lama",
      desc: "Festival seni, budaya, dan kuliner tempo dulu di tengah gemerlap lampu malam.",
      image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=400",
      label: "EVENT",
    },
  ],
  news: [
    {
      title: "Revitalisasi Taman Budaya Raden Saleh Selesai",
      date: "10 Mei 2026",
      desc: "Kawasan Taman Budaya Raden Saleh kini tampil lebih modern dan siap menjadi pusat kesenian warga Semarang.",
      url: "#",
      image: "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=400",
      label: "BERITA",
      location: "Taman Budaya Raden Saleh",
    },
    {
      title: "Rute Bus Trans Semarang Baru Resmi Dibuka",
      date: "05 Mei 2026",
      desc: "Pemerintah Kota Semarang membuka koridor baru untuk mempermudah akses pariwisata hingga ke pinggiran kota.",
      url: "#",
      image: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&q=80&w=400",
      label: "TRANSPORTASI",
      location: "Seluruh Kota Semarang",
    },
  ],
};

export function mergeExploreConfig(data: any): ExploreConfig {
  if (!data || typeof data !== "object") return DEFAULT_EXPLORE_CONFIG;
  // Deep clone to avoid mutating frozen objects from React Query
  const clonedData = JSON.parse(JSON.stringify(data));
  return {
    hero: { 
      ...DEFAULT_EXPLORE_CONFIG.hero, 
      ...(clonedData.hero || {}),
      videoUrl: clonedData.hero?.videoUrl !== undefined ? clonedData.hero.videoUrl : DEFAULT_EXPLORE_CONFIG.hero.videoUrl
    },
    destinations: clonedData.destinations || JSON.parse(JSON.stringify(DEFAULT_EXPLORE_CONFIG.destinations)),
    culinary: clonedData.culinary || JSON.parse(JSON.stringify(DEFAULT_EXPLORE_CONFIG.culinary)),
    events: clonedData.events || JSON.parse(JSON.stringify(DEFAULT_EXPLORE_CONFIG.events)),
    news: clonedData.news || JSON.parse(JSON.stringify(DEFAULT_EXPLORE_CONFIG.news)),
  };
}
