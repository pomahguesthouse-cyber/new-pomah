export type ExploreConfig = {
  hero: {
    heading: string;
    subheading: string;
    bgImageUrl: string;
  };
  destinations: {
    name: string;
    desc: string;
    image: string;
    rating: string;
  }[];
  culinary: {
    name: string;
    desc: string;
    image: string;
    category: string;
  }[];
  events: {
    title: string;
    date: string;
    location: string;
    desc: string;
    image: string;
  }[];
  news: {
    title: string;
    date: string;
    desc: string;
    url: string;
    image: string;
  }[];
};

export const DEFAULT_EXPLORE_CONFIG: ExploreConfig = {
  hero: {
    heading: "Jelajahi Semarang",
    subheading:
      "Temukan pesona wisata bersejarah, ragam kuliner otentik, dan deretan acara seru di ibu kota Jawa Tengah.",
    bgImageUrl: "https://images.unsplash.com/photo-1629827014691-30cc0ed06927?auto=format&fit=crop&q=80&w=1600",
  },
  destinations: [
    {
      name: "Lawang Sewu",
      desc: "Gedung bersejarah peninggalan Belanda yang ikonik dengan ribuan pintu dan arsitektur megah.",
      image: "https://images.unsplash.com/photo-1549473889-14f410d83298?auto=format&fit=crop&q=80&w=600",
      rating: "4.8",
    },
    {
      name: "Kota Lama Semarang",
      desc: "Kawasan cagar budaya dengan bangunan-bangunan tua bernuansa Eropa klasik yang indah.",
      image: "https://images.unsplash.com/photo-1629827014691-30cc0ed06927?auto=format&fit=crop&q=80&w=600",
      rating: "4.9",
    },
    {
      name: "Sam Poo Kong",
      desc: "Kelenteng bersejarah tempat persinggahan Laksamana Cheng Ho, dengan nuansa merah yang fotogenik.",
      image: "https://images.unsplash.com/photo-1616239129525-24dbec2291cd?auto=format&fit=crop&q=80&w=600",
      rating: "4.7",
    },
  ],
  culinary: [
    {
      name: "Lumpia Gang Lombok",
      desc: "Lumpia legendaris Semarang dengan isian rebung segar, udang, dan telur.",
      image: "https://images.unsplash.com/photo-1606525437679-03e62698a1c1?auto=format&fit=crop&q=80&w=400",
      category: "Cemilan",
    },
    {
      name: "Tahu Gimbal Pak Edy",
      desc: "Perpaduan tahu goreng, gimbal udang, irisan kol, tauge, disiram kuah kacang petis.",
      image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&q=80&w=400",
      category: "Makan Siang",
    },
    {
      name: "Nasi Ayam Bu Wido",
      desc: "Nasi liwet khas Semarang disajikan dengan suwiran ayam, telur pindang, dan kuah opor.",
      image: "https://images.unsplash.com/photo-1615486171434-601f6004df9f?auto=format&fit=crop&q=80&w=400",
      category: "Makan Malam",
    },
    {
      name: "Tahu Pong Karangturi",
      desc: "Tahu pong gurih yang disajikan hangat dengan cocolan kecap pedas manis.",
      image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&q=80&w=400",
      category: "Cemilan",
    },
  ],
  events: [
    {
      title: "Semarang Night Carnival",
      date: "15 Agustus 2026",
      location: "Kawasan Simpang Lima",
      desc: "Pawai budaya tahunan terbesar di Semarang dengan kostum-kostum meriah.",
      image: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&q=80&w=400"
    },
    {
      title: "Festival Kota Lama",
      date: "10-12 September 2026",
      location: "Kawasan Kota Lama",
      desc: "Festival seni, budaya, dan kuliner tempo dulu di tengah gemerlap lampu malam.",
      image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=400"
    },
    {
      title: "Pasar Semawis",
      date: "Setiap Akhir Pekan (Jumat-Minggu)",
      location: "Kawasan Pecinan Semarang",
      desc: "Pusat jajanan kaki lima terpanjang dengan ragam kuliner halal dan non-halal.",
      image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&q=80&w=400"
    },
  ],
  news: [
    {
      title: "Revitalisasi Taman Budaya Raden Saleh Selesai",
      date: "10 Mei 2026",
      desc: "Kawasan Taman Budaya Raden Saleh kini tampil lebih modern dan siap menjadi pusat kesenian warga Semarang.",
      url: "#",
      image: "https://images.unsplash.com/photo-1582559937861-125691060eb7?auto=format&fit=crop&q=80&w=400"
    },
    {
      title: "Rute Bus Trans Semarang Baru Resmi Dibuka",
      date: "05 Mei 2026",
      desc: "Pemerintah Kota Semarang membuka koridor baru untuk mempermudah akses pariwisata hingga ke pinggiran kota.",
      url: "#",
      image: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&q=80&w=400"
    },
  ],
};

export function mergeExploreConfig(data: any): ExploreConfig {
  if (!data || typeof data !== "object") return DEFAULT_EXPLORE_CONFIG;
  return {
    hero: { ...DEFAULT_EXPLORE_CONFIG.hero, ...(data.hero || {}) },
    destinations: data.destinations || DEFAULT_EXPLORE_CONFIG.destinations,
    culinary: data.culinary || DEFAULT_EXPLORE_CONFIG.culinary,
    events: data.events || DEFAULT_EXPLORE_CONFIG.events,
    news: data.news || DEFAULT_EXPLORE_CONFIG.news,
  };
}
