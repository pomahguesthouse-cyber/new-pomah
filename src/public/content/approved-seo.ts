/**
 * Approved public copy, 27 Sep 2026.
 * City Guide articles and the UNNES landing article render from here.
 * Room, homepage, and landing fields that live in the database are also
 * written by supabase/migrations/20260927153000_seo_copy_2026_09_27.sql.
 * Hot-water claims from that copy are removed by
 * supabase/migrations/20261005020000_remove_hot_water_seo_claims.sql.
 * The source-notes section of the brief is not included.
 */
/** Same rules as slugifyPlaceName. Kept local so this module stays a leaf import. */
function slugifyPlaceName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type ApprovedFaq = { question: string; answer: string };
export type ApprovedLink = { anchor: string; href: string };
export type ApprovedSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type CityGuideArticle = {
  canonicalSlug: string;
  /** Names whose slug should show this article. */
  names: string[];
  title: string;
  meta: string;
  h1: string;
  cardIntro: string;
  sections: ApprovedSection[];
  faq: ApprovedFaq[];
  links: ApprovedLink[];
};

export type ApprovedRoomSeo = { title: string; meta: string; h1: string };

export const APPROVED_HOME = {
  title: "Pomah Guesthouse – Guesthouse Keluarga & Penginapan Semarang",
  meta: "Guesthouse keluarga di Sampangan, Semarang. Kamar bersih mulai Rp175.000, family room 2 kamar tidur, WiFi & parkir gratis. Dekat kampus UNNES.",
  h1: "Guesthouse Keluarga di Semarang yang Terasa Seperti Rumah",
} as const;

const PREVIOUS_HOME_H1 = "Guesthouse Keluarga di Semarang, Dekat UNNES";
const PREVIOUS_HOME_TITLE = "Pomah Guesthouse | Penginapan Dekat UNNES Semarang";
const PREVIOUS_HOME_META =
  "Penginapan dekat UNNES Semarang di Sampangan. Pomah Guesthouse: family room, WiFi, parkir, suasana tenang. Pesan di situs resmi.";

export const APPROVED_ROOMS: Record<string, ApprovedRoomSeo> = {
  "kamar-single": {
    title: "Kamar Single Semarang Mulai Rp175.000 | Pomah Guesthouse",
    meta: "Kamar Single 15 m² di Pomah Guesthouse Sampangan, Semarang. Praktis untuk solo traveler dan peserta tes: AC, WiFi, dapur bersama. Mulai Rp175.000.",
    h1: "Kamar Single untuk Solo Traveler di Semarang",
  },
  deluxe: {
    title: "Kamar Deluxe untuk Berdua di Semarang | Pomah Guesthouse",
    meta: "Kamar Deluxe 18 m² dengan kasur queen, shower, dan view taman di Pomah Guesthouse Sampangan, Semarang. Nyaman untuk dua orang, mulai Rp230.000.",
    h1: "Kamar Deluxe dengan View Taman untuk Dua Orang",
  },
  "grand-deluxe": {
    title: "Grand Deluxe Lantai 1 Lebih Lega | Pomah Semarang",
    meta: "Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.",
    h1: "Grand Deluxe: Kamar Lebih Lega di Lantai Satu",
  },
  "family-suite-100": {
    title: "Family Suite 100 – Guesthouse Keluarga Semarang | Pomah",
    meta: "Suite 60 m² di guesthouse keluarga Semarang: 2 kamar tidur dengan kamar mandi dalam, ruang tamu, dapur, dan teras pribadi. Untuk 4 tamu, mulai Rp500.000.",
    h1: "Family Suite 100: Suite Dua Kamar di Guesthouse Keluarga Semarang",
  },
  "family-room-222": {
    title: "Family Room Semarang 2 Kamar Tidur – Family Room 222 | Pomah",
    meta: "Family room di Semarang seluas 50 m²: 2 kamar tidur, 2 kamar mandi, dan ruang keluarga untuk 4 tamu. Pomah Guesthouse Sampangan, mulai Rp500.000.",
    h1: "Family Room 222: Family Room Semarang dengan Dua Kamar Tidur",
  },
};

export const FAMILY_SUITE_DESCRIPTION_OLD =
  "Kamar luas dengan 2 kamar tidur dan 2 kamar mandi ini sangat cocok untuk keluarga atau kelompok besar yang mencari tempat menginap nyaman di pusat kota.";

export const FAMILY_SUITE_DESCRIPTION_NEW =
  "Kamar luas dengan 2 kamar tidur dan 2 kamar mandi ini sangat cocok untuk keluarga atau rombongan kecil hingga empat tamu yang mencari tempat menginap nyaman dan tenang di kawasan Sampangan, Semarang.";

export const UNNES_SEKARAN_DISTANCE = "4,7 km";
export const UNNES_SEKARAN_TIME = "~10–12 menit";

export type NearbyPlace = {
  name: string;
  type: string;
  distance: string;
  time: string;
};

export const UNNES_SAMPANGAN_NEARBY: NearbyPlace = {
  name: "Unnes Sampangan (Kelud Utara III)",
  type: "Universitas",
  distance: "3,5 km",
  time: "~8–10 menit",
};

export type ApprovedLpRoom = {
  name: string;
  capacity: string;
  size: string;
  price: string;
  href: string;
  note: string;
};

export const APPROVED_LP = {
  slug: "penginapan-dekat-unnes",
  title: "Penginapan Dekat UNNES Semarang – Pomah Guesthouse",
  meta: "Penginapan & homestay dekat UNNES di Sampangan, Semarang. Cocok untuk wisuda, tes masuk, dan keluarga. Kamar mulai Rp175.000/malam. Pesan langsung.",
  h1: "Penginapan Dekat UNNES untuk Orang Tua, Wisudawan & Peserta Tes",
  cardIntro:
    "Penginapan keluarga di Sampangan, sekitar 4,7 km dari kampus UNNES Sekaran. Pilihan tepat untuk orang tua wisudawan, peserta tes, dan keluarga yang ingin menginap tenang dekat kampus.",
  tagline: "Penginapan keluarga yang nyaman & terjangkau di Sampangan, Semarang.",
  intro:
    'Datang ke Semarang untuk wisuda anak, mengantar tes masuk, atau urusan kampus lainnya? Pomah Guesthouse adalah penginapan keluarga di Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, yang bisa dijangkau dengan mudah dari kampus UNNES di Sekaran maupun Sampangan. "Pomah" dalam bahasa Jawa berarti rumah, dan suasana itulah yang ingin kami hadirkan: tenang, bersih, dan hangat, seperti menginap di rumah keluarga sendiri.',
  why: {
    heading: "Kenapa memilih Pomah sebagai penginapan dekat UNNES",
    paragraphs: [
      "**Untuk orang tua wisudawan.** Hari wisuda biasanya dimulai pagi-pagi sekali. Menginap dekat kampus membuat Anda tidak perlu berangkat subuh dari luar kota, dan masih sempat sarapan serta berdandan dengan tenang. Setelah acara, keluarga bisa kembali beristirahat di kamar yang nyaman sebelum makan malam bersama.",
      "**Untuk peserta tes dan pendamping.** Malam sebelum tes adalah waktu untuk tidur cukup, bukan terjebak di jalan. Kamar yang tenang, AC, dan WiFi membantu peserta mengulang materi dan beristirahat. Pendamping pun bisa menunggu dengan nyaman.",
      "**Untuk keluarga dan rombongan kecil.** Kami punya dua tipe kamar keluarga dengan dua kamar tidur, jadi satu keluarga bisa tetap dalam satu unit tanpa berdesakan. Buat Anda yang mencari suasana homestay dekat UNNES, dengan ruang keluarga dan dapur, pilihan ini terasa lebih akrab daripada kamar hotel biasa.",
    ],
  },
  distance: {
    heading: "Jarak ke kampus UNNES Sekaran & Sampangan",
    intro:
      "Pomah berada di kawasan Sampangan, jalur yang biasa dilewati menuju Gunungpati dan Sekaran. Perkiraan jarak dari Pomah:",
    bullets: [
      "**Kampus UNNES Sekaran (Gunungpati):** sekitar 4,7 km, kurang lebih 10–12 menit berkendara.",
      "**Kampus UNNES Sampangan (Jl. Kelud Utara III):** sekitar 3,5 km, kurang lebih 8–10 menit.",
      "**Universitas Wahid Hasyim (Kampus Menoreh):** sekitar 1,5 km, kurang lebih 5 menit.",
      "**GOR Jatidiri:** sekitar 4 km, kurang lebih 10 menit.",
      "**Pintu Tol Jatingaleh:** sekitar 5 km, kurang lebih 12 menit.",
    ],
    note: "Pada hari wisuda atau hari tes, jalan menuju kampus biasanya lebih padat dari biasanya. Kami sarankan berangkat lebih awal dan menggunakan taksi atau ojek online supaya tidak perlu mencari parkir di kampus.",
  },
  roomsHeading: "Tipe kamar & harga mulai dari",
  roomsNote: "Harga bisa berbeda di tanggal tertentu. Untuk harga pasti, pilih tanggal di halaman pemesanan.",
  rooms: [
    {
      name: "Single",
      capacity: "1 tamu",
      size: "15 m²",
      price: "Rp175.000/malam",
      href: "/rooms/kamar-single",
      note: "Praktis untuk peserta tes atau tamu yang datang sendiri. Ada AC, WiFi, dan akses dapur bersama.",
    },
    {
      name: "Deluxe",
      capacity: "2 tamu",
      size: "18 m²",
      price: "Rp230.000/malam",
      href: "/rooms/deluxe",
      note: "Kamar di lantai dua dengan kasur queen, shower, dan pemandangan taman. Cocok untuk orang tua yang datang berdua.",
    },
    {
      name: "Grand Deluxe",
      capacity: "2 tamu",
      size: "20 m²",
      price: "Rp300.000/malam",
      href: "/rooms/grand-deluxe",
      note: "kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.",
    },
    {
      name: "Family Room 222",
      capacity: "hingga 4 tamu",
      size: "50 m²",
      price: "Rp500.000/malam",
      href: "/rooms/family-room-222",
      note: "Dua kamar tidur, dua kamar mandi, dan ruang keluarga di lantai dua. Favorit keluarga wisudawan.",
    },
    {
      name: "Family Suite 100",
      capacity: "hingga 4 tamu",
      size: "60 m²",
      price: "Rp500.000/malam",
      href: "/rooms/family-suite-100",
      note: "Dua kamar tidur dengan kamar mandi dalam, toilet tamu, ruang tamu dengan smart TV, area makan mini, dapur, dan teras pribadi di lantai satu.",
    },
  ] satisfies ApprovedLpRoom[],
  facilities: {
    heading: "Fasilitas",
    bullets: [
      "WiFi gratis",
      "AC di kamar",
      "Parkir gratis tersedia",
      "Dapur bersama (untuk tipe kamar tertentu) dan mini kitchen di Family Suite",
      "Balkon dan mini cafe",
      "Check-in mulai pukul 14.00 WIB, check-out paling lambat pukul 12.00 WIB",
    ],
  },
  booking: {
    heading: "Cara booking",
    steps: [
      "Buka halaman pemesanan Pomah, pilih tanggal check-in/check-out dan jumlah tamu.",
      "Pilih kamar yang tersedia, lalu isi data pemesan.",
      "Ada pertanyaan soal tanggal wisuda atau kamar keluarga? Chat kami lewat WhatsApp di +62 851-9098-6169.",
    ],
    note: "Musim wisuda dan jadwal tes biasanya membuat kamar di sekitar kampus cepat penuh. Kalau tanggal sudah pasti, sebaiknya pesan jauh-jauh hari.",
  },
  faqTitle: "Pertanyaan yang sering ditanyakan",
  links: [
    { anchor: "Family Room 222", href: "/rooms/family-room-222" },
    { anchor: "Family Suite 100", href: "/rooms/family-suite-100" },
    { anchor: "kamar Single", href: "/rooms/kamar-single" },
    { anchor: "Deluxe", href: "/rooms/deluxe" },
    { anchor: "Grand Deluxe", href: "/rooms/grand-deluxe" },
    { anchor: "halaman pemesanan", href: "/book" },
    { anchor: "tempat wisata di Semarang", href: "/explore" },
  ] satisfies ApprovedLink[],
  faq: [
    {
      question: "Di mana alamat Pomah Guesthouse?",
      answer: "Jl. Dewi Sartika IV No. 71, Sampangan, Semarang, Jawa Tengah 50232.",
    },
    {
      question: "Berapa jauh Pomah dari UNNES Sekaran?",
      answer: "Sekitar 4,7 km, kurang lebih 10–12 menit berkendara, tergantung lalu lintas.",
    },
    {
      question: "Apakah Pomah cocok untuk keluarga yang datang saat wisuda UNNES?",
      answer:
        "Cocok. Family Room 222 dan Family Suite 100 masing-masing punya dua kamar tidur untuk hingga empat tamu, jadi satu keluarga bisa menginap bersama dengan leluasa.",
    },
    {
      question: "Apakah tersedia parkir?",
      answer: "Ya, tersedia parkir gratis untuk tamu.",
    },
    {
      question: "Berapa harga kamar termurah?",
      answer: "Kamar Single mulai Rp175.000 per malam.",
    },
  ] satisfies ApprovedFaq[],
};

export const CITY_GUIDE_ARTICLES: CityGuideArticle[] = [
  {
    canonicalSlug: "lawang-sewu-semarang",
    names: ["Lawang Sewu", "Lawang Sewu Semarang"],
    title: "Lawang Sewu Semarang: Tiket, Jam Buka & Rute | Pomah",
    meta: "Panduan ke Lawang Sewu dari Pomah Guesthouse Sampangan: rute, perkiraan waktu tempuh, harga tiket, jam buka, dan tips berkunjung bersama keluarga.",
    h1: "Lawang Sewu Semarang: Panduan Berkunjung dari Pomah Guesthouse",
    cardIntro:
      'Gedung "seribu pintu" di Tugu Muda ini dulu kantor perusahaan kereta api zaman Belanda, sekarang jadi museum yang selalu ramai pengunjung. Dari Pomah cukup sekali jalan lewat pusat kota, dan paling enak didatangi pagi atau menjelang sore.',
    sections: [
      {
        heading: "Sekilas tentang Lawang Sewu",
        paragraphs: [
          "Lawang Sewu berdiri di Jl. Pemuda No. 160, tepat di sisi Bundaran Tugu Muda. Gedung ini dibangun bertahap mulai 1904 dan selesai 1907 sebagai kantor pusat perusahaan kereta api swasta Belanda, NIS (Nederlandsch-Indische Spoorweg Maatschappij). Jendela dan pintunya yang sangat banyak dibuat untuk sirkulasi udara, dan dari situlah orang menyebutnya \"Lawang Sewu\" alias seribu pintu.",
          "Sekarang gedung ini dikelola KAI Wisata sebagai museum perkeretaapian. Di dalamnya ada koleksi mesin hitung, mesin tik, replika lokomotif uap, dokumentasi pemugaran gedung, dan kaca patri besar yang jadi salah satu spot foto favorit. Lorong-lorongnya yang panjang dan berlengkung juga cantik untuk difoto.",
        ],
      },
      {
        heading: "Cara ke sana dari Pomah Guesthouse",
        paragraphs: [
          "Jaraknya sekitar 6 km dari Pomah di Sampangan. Dengan mobil atau motor, perjalanan biasanya sekitar 15–25 menit, tergantung kepadatan di jalur menuju Tugu Muda. Pada jam berangkat dan pulang kantor atau malam minggu, sediakan waktu lebih.",
          "Kalau tidak membawa kendaraan, taksi atau ojek online adalah pilihan paling praktis karena titik turunnya jelas: Lawang Sewu, Jl. Pemuda. Di sekitar gedung tersedia area parkir, ikuti arahan petugas di lokasi.",
        ],
      },
      {
        heading: "Jam buka & harga tiket",
        paragraphs: [
          "Menurut KAI Wisata selaku pengelola, harga tiket masuk gedung adalah:",
          "Lawang Sewu biasanya buka setiap hari, dan menurut KAI Wisata jam operasionalnya pukul 07.00–21.00 WIB. Ada juga area immersive yang biasanya memakai tiket terpisah. Jam buka dan harga bisa berubah saat libur panjang atau ada acara khusus, jadi sebaiknya cek info terbaru di Instagram resmi @wisata.lawangsewu sebelum berangkat.",
        ],
        bullets: [
          "Dewasa & mahasiswa: Rp20.000/orang",
          "Anak-anak & pelajar: Rp10.000/orang",
          "Wisatawan mancanegara: Rp30.000/orang",
        ],
      },
      {
        heading: "Tips berkunjung bersama keluarga",
        paragraphs: [],
        bullets: [
          "Datang pagi supaya tidak terlalu panas dan antrean loket masih pendek. Sore menjelang magrib juga enak, cahayanya bagus untuk foto.",
          "Bangunannya bertingkat dan luas, jadi pakai alas kaki yang nyaman. Untuk anak kecil, stroller ringan atau gendongan lebih praktis.",
          "Sepakati titik kumpul dengan anggota keluarga, misalnya di dekat loket, karena lorongnya mirip-mirip dan mudah terpencar.",
          "Lawang Sewu bisa digabung dengan Kota Lama dan kuliner lunpia di hari yang sama.",
        ],
      },
      {
        heading: "Menginap dekat sini",
        paragraphs: [
          "Setelah seharian keliling kota, kembali ke tempat yang tenang itu terasa melegakan. Pomah Guesthouse ada di Sampangan, di sisi kota yang lebih teduh, tetapi Lawang Sewu tetap terjangkau sekitar 6 km. Untuk rombongan keluarga, **Family Room 222** punya dua kamar tidur dan dua kamar mandi untuk hingga empat tamu, sehingga semua bisa istirahat dengan leluasa. Cek ketersediaan dan pesan langsung lewat halaman kamar atau WhatsApp kami.",
        ],
      },
    ],
    faq: [
      {
        question: "Berapa harga tiket Lawang Sewu?",
        answer:
          "Menurut KAI Wisata, Rp20.000 untuk dewasa/mahasiswa, Rp10.000 untuk anak/pelajar, dan Rp30.000 untuk wisatawan mancanegara. Sebaiknya cek info terbaru sebelum berangkat.",
      },
      {
        question: "Berapa lama waktu yang dibutuhkan untuk keliling Lawang Sewu?",
        answer: "Biasanya 1–2 jam sudah cukup untuk melihat gedung utama, museum, dan berfoto.",
      },
      {
        question: "Berapa jauh Lawang Sewu dari Pomah Guesthouse?",
        answer: "Sekitar 6 km atau kurang lebih 15–25 menit berkendara, tergantung lalu lintas.",
      },
    ],
    links: [
      { anchor: "Family Room 222 untuk keluarga", href: "/rooms/family-room-222" },
      { anchor: "jalan kaki keliling Kota Lama Semarang", href: "/explore/kota-lama-semarang" },
      { anchor: "lunpia khas Semarang untuk oleh-oleh", href: "/explore/lcm-lunpia-cik-me-me" },
    ],
  },
  {
    canonicalSlug: "kota-lama-semarang",
    names: ["Kota Lama Semarang", "Kota Lama"],
    title: "Kota Lama Semarang: Rute, Tiket & Tips Keluarga | Pomah",
    meta: "Jelajah Kota Lama Semarang dari Pomah Guesthouse: rute dari Sampangan, spot wajib, info museum dan tiket, serta tips jalan kaki santai bersama keluarga.",
    h1: "Kota Lama Semarang: Jalan-Jalan Sejarah dari Pomah Guesthouse",
    cardIntro:
      "Deretan gedung kolonial, jalan berbatu, dan kafe di bangunan tua membuat Kota Lama terasa seperti mundur ke masa lalu. Paling seru dijelajahi dengan jalan kaki santai, pagi hari atau saat lampu-lampunya mulai menyala di sore hari.",
    sections: [
      {
        heading: "Sekilas tentang Kota Lama",
        paragraphs: [
          "Kota Lama Semarang adalah kawasan bersejarah di utara pusat kota, sekitar Jl. Letjen Suprapto dan Taman Srigunting. Di sini berdiri gedung-gedung peninggalan masa kolonial Belanda yang sebagian besar sudah dipugar dan kini dipakai sebagai kafe, galeri, toko, dan museum. Karena suasananya, kawasan ini sering dijuluki \"Little Netherland\".",
          "Ikon paling terkenal adalah Gereja Blenduk dengan kubahnya yang khas, yang sampai sekarang masih dipakai untuk ibadah. Di sekitarnya ada Taman Srigunting, gedung-gedung tua di sepanjang Jl. Letjen Suprapto, dan Museum Kota Lama di Jl. Cendrawasih yang menceritakan sejarah kota Semarang. Suasana siang dan malam terasa berbeda. Siang cocok untuk foto arsitektur, malam lebih hidup dengan lampu dan kuliner.",
        ],
      },
      {
        heading: "Cara ke sana dari Pomah Guesthouse",
        paragraphs: [
          "Jaraknya sekitar 9–10 km dari Pomah di Sampangan, kurang lebih 25–35 menit berkendara melewati pusat kota. Taksi atau ojek online paling praktis. Minta diturunkan di Gereja Blenduk atau Taman Srigunting, lalu lanjut jalan kaki. Kalau membawa mobil, gunakan kantong parkir resmi di sekitar kawasan dan ikuti arahan petugas.",
        ],
      },
      {
        heading: "Jam buka & harga tiket",
        paragraphs: [
          "Kawasan Kota Lama adalah ruang publik terbuka. Jalan-jalan dan berfoto di area luar tidak dipungut tiket. Beberapa tempat di dalamnya punya aturan sendiri:",
        ],
        bullets: [
          "Museum Kota Lama: masuk gratis, tetapi wajib reservasi lewat aplikasi Lunpia dan kuota per sesi terbatas. Museum biasanya buka pukul 09.00–15.30 WIB. Jadwal sesi dan hari buka bisa berubah, jadi sebaiknya cek langsung di aplikasi sebelum berangkat.",
          "Gereja Blenduk: pengunjung biasanya diminta donasi pemeliharaan sekitar Rp10.000/orang. Kunjungan bisa dibatasi saat ada ibadah.",
          "Museum dan galeri swasta lain di kawasan ini punya tiket dan jam masing-masing. Sebaiknya cek info terbaru sebelum masuk.",
        ],
      },
      {
        heading: "Tips berkunjung bersama keluarga",
        paragraphs: [],
        bullets: [
          "Siapkan waktu 1–2 jam untuk jalan kaki santai. Jalan berbatu kurang nyaman untuk stroller kecil, jadi gendongan bisa jadi alternatif.",
          "Tentukan titik kumpul yang mudah dikenali, misalnya depan Gereja Blenduk.",
          "Siang hari cukup terik. Bawa topi, air minum, dan rencanakan istirahat di kafe atau taman.",
          "Pesan slot Museum Kota Lama beberapa hari sebelumnya kalau ingin masuk, terutama saat akhir pekan.",
          "Malam hari, lanjutkan dengan kuliner di Pasar Semawis (Pecinan), yang lokasinya tidak jauh.",
        ],
      },
      {
        heading: "Menginap dekat sini",
        paragraphs: [
          "Setelah seharian di keramaian Kota Lama, suasana Sampangan yang lebih tenang cocok untuk istirahat. Pomah Guesthouse punya pilihan kamar keluarga seperti **Family Suite 100**, dengan dua kamar tidur, ruang tamu, dan dapur kecil. Jadi anak-anak bisa tidur lebih awal sementara orang tua masih santai di ruang tengah. Cek tanggal menginap dan pesan langsung di situs Pomah.",
        ],
      },
    ],
    faq: [
      {
        question: "Apakah masuk Kota Lama Semarang bayar?",
        answer:
          "Kawasannya terbuka untuk umum tanpa tiket. Tiket atau reservasi hanya berlaku untuk tempat tertentu, seperti Museum Kota Lama (gratis, reservasi lewat aplikasi Lunpia).",
      },
      {
        question: "Kapan waktu terbaik ke Kota Lama?",
        answer: "Pagi untuk foto dan udara yang lebih sejuk, atau sore menjelang malam saat lampu kawasan menyala.",
      },
      {
        question: "Berapa lama perjalanan dari Pomah Guesthouse?",
        answer: "Sekitar 25–35 menit berkendara, jaraknya kurang lebih 9–10 km.",
      },
    ],
    links: [
      { anchor: "Family Suite 100 dengan dua kamar tidur", href: "/rooms/family-suite-100" },
      { anchor: "Lawang Sewu", href: "/explore/lawang-sewu-semarang" },
      { anchor: "kuliner malam di Pasar Semawis", href: "/explore/wisata-kuliner-malam-pasar-semawis" },
    ],
  },
  {
    canonicalSlug: "sam-poo-kong",
    names: ["Sam Poo Kong", "SAM POO KONG", "Klenteng Sam Poo Kong"],
    title: "Sam Poo Kong Semarang: Tiket, Jam Buka & Rute | Pomah",
    meta: "Panduan ke Klenteng Sam Poo Kong dari Pomah Guesthouse: sekitar 4–5 km dari Sampangan. Info tiket, jam buka, dan tips berkunjung bersama keluarga.",
    h1: "Sam Poo Kong Semarang: Panduan Singkat dari Pomah Guesthouse",
    cardIntro:
      "Kompleks klenteng merah menyala di Simongan ini menyimpan kisah persinggahan armada Laksamana Cheng Ho di Semarang. Letaknya paling dekat dari Pomah di antara destinasi wisata utama kota, cocok untuk setengah hari santai bersama keluarga.",
    sections: [
      {
        heading: "Sekilas tentang Sam Poo Kong",
        paragraphs: [
          "Sam Poo Kong, yang juga dikenal sebagai Gedung Batu, berada di kawasan Simongan, Bongsari, Semarang Barat. Menurut catatan sejarah yang banyak dikutip, tempat ini berawal dari persinggahan armada Laksamana Cheng Ho (Zheng He) di pesisir Semarang pada awal abad ke-15. Di sebuah gua batu, rombongannya beristirahat dan beribadah. Seiring waktu, lokasi itu berkembang menjadi klenteng untuk menghormati Cheng Ho.",
          "Kini Sam Poo Kong adalah kompleks luas dengan beberapa bangunan klenteng bergaya Tionghoa, patung Cheng Ho yang besar, pelataran terbuka, dan gerbang megah. Tempat ini masih dipakai untuk ibadah, sekaligus menjadi wisata budaya yang menunjukkan akulturasi Tionghoa, Jawa, dan Islam di Semarang.",
        ],
      },
      {
        heading: "Cara ke sana dari Pomah Guesthouse",
        paragraphs: [
          "Sam Poo Kong termasuk destinasi terdekat dari Pomah, sekitar 4–5 km atau kurang lebih 10–20 menit berkendara ke arah Simongan, tergantung lalu lintas. Ojek atau taksi online paling praktis, dan area parkir tersedia di kompleks wisata. Di sekitar Jl. Pamularsih juga ada halte Trans Semarang. Sebaiknya cek rute terbaru sebelum berangkat.",
        ],
      },
      {
        heading: "Jam buka & harga tiket",
        paragraphs: [
          "Menurut situs resminya, tiket bisa dibeli langsung di loket atau secara online lewat Tiket.com. Harga yang biasanya berlaku:",
          "Sam Poo Kong biasanya buka Senin–Jumat pukul 09.00–18.00 WIB dan Sabtu–Minggu pukul 08.00–20.00 WIB. Saat Imlek atau hari besar lain biasanya ada acara khusus dengan tiket berbeda. Sebaiknya cek info terbaru di Instagram @wisatasampookong sebelum berangkat.",
        ],
        bullets: [
          "Tiket umum dewasa: sekitar Rp15.000 (hari kerja) sampai Rp20.000 (akhir pekan)",
          "Tiket umum anak: sekitar Rp10.000–15.000",
          "Tiket terusan (akses ke area dalam yang lebih luas): sekitar Rp35.000–40.000 untuk dewasa",
        ],
      },
      {
        heading: "Tips berkunjung bersama keluarga",
        paragraphs: [],
        bullets: [
          "Pakai pakaian sopan. Beberapa area adalah tempat ibadah, jadi ajak anak-anak menjaga suara dan tidak menyentuh perlengkapan sembahyang.",
          "Pelatarannya luas dan cukup terbuka. Datang pagi atau sore, dan bawa topi serta air minum.",
          "Ceritakan sedikit kisah Cheng Ho ke anak-anak sebelum berangkat. Mereka akan lebih antusias saat melihat patung dan bangunannya langsung.",
          "Sediakan waktu sekitar 1,5–2 jam untuk keliling dengan santai.",
        ],
      },
      {
        heading: "Menginap dekat sini",
        paragraphs: [
          "Karena jaraknya hanya belasan menit, Sam Poo Kong enak dijadikan acara pagi sebelum check-out atau sore setelah check-in. Pomah Guesthouse di Sampangan punya **Family Room 222** untuk hingga empat tamu dengan dua kamar tidur dan ruang keluarga. Untuk perjalanan berdua, ada kamar Deluxe yang lebih ringkas. Pesan langsung di situs Pomah supaya tanggal Anda aman.",
        ],
      },
    ],
    faq: [
      {
        question: "Berapa harga tiket Sam Poo Kong?",
        answer:
          "Tiket umum dewasa biasanya sekitar Rp15.000–20.000 tergantung hari, dan tiket terusan lebih mahal. Sebaiknya cek harga terbaru di loket atau Tiket.com sebelum berangkat.",
      },
      {
        question: "Apakah Sam Poo Kong cocok untuk anak-anak?",
        answer:
          "Cocok. Areanya luas, banyak spot foto, dan ceritanya menarik untuk dikenalkan ke anak. Tetap jaga ketenangan di area ibadah.",
      },
      {
        question: "Seberapa dekat Sam Poo Kong dari Pomah Guesthouse?",
        answer: "Sekitar 4–5 km, kurang lebih 10–20 menit berkendara.",
      },
    ],
    links: [
      { anchor: "Family Room 222 untuk empat tamu", href: "/rooms/family-room-222" },
      { anchor: "kamar Deluxe untuk berdua", href: "/rooms/deluxe" },
      { anchor: "Lawang Sewu di Tugu Muda", href: "/explore/lawang-sewu-semarang" },
    ],
  },
  {
    canonicalSlug: "masjid-agung-jawa-tengah-majt",
    names: ["Masjid Agung Jawa Tengah", "Masjid Agung Jawa Tengah (MAJT)", "MAJT"],
    title: "Masjid Agung Jawa Tengah (MAJT): Menara & Rute | Pomah",
    meta: "Panduan ke MAJT Semarang dari Pomah Guesthouse: rute dari Sampangan, info Menara Al Husna, jam operasional, dan tips berkunjung bersama keluarga.",
    h1: "Masjid Agung Jawa Tengah (MAJT): Panduan Berkunjung dari Pomah",
    cardIntro:
      "Payung-payung raksasa di pelataran dan menara setinggi 99 meter membuat MAJT mudah dikenali dari kejauhan. Tempat ini cocok untuk ibadah, wisata religi, sekaligus melihat Semarang dari ketinggian.",
    sections: [
      {
        heading: "Sekilas tentang MAJT",
        paragraphs: [
          "Masjid Agung Jawa Tengah berada di Jl. Gajah Raya, Sambirejo, Gayamsari, di sisi timur Kota Semarang. Masjid ini diresmikan Presiden Susilo Bambang Yudhoyono pada 14 November 2006, dan arsitekturnya memadukan unsur Jawa, Timur Tengah, dan Romawi. Di pelatarannya ada enam payung hidrolik raksasa yang terinspirasi dari Masjid Nabawi di Madinah. Payung ini biasanya dibuka pada momen tertentu, misalnya saat salat Jumat atau hari raya.",
          "Daya tarik lain adalah Menara Al Husna setinggi 99 meter, sesuai jumlah Asmaul Husna. Menurut pengelola, di lantai 2 dan 3 menara ada museum tentang pembangunan MAJT dan perkembangan Islam di Jawa Tengah, sedangkan lantai 19 adalah gardu pandang untuk melihat kota Semarang.",
        ],
      },
      {
        heading: "Cara ke sana dari Pomah Guesthouse",
        paragraphs: [
          "Jaraknya sekitar 11 km dari Pomah di Sampangan, kurang lebih 25–35 menit berkendara melintasi kota ke arah timur. Pada jam sibuk atau menjelang salat Jumat, perjalanan bisa lebih lama. Taksi atau ojek online praktis, dan tersedia area parkir di kompleks masjid.",
        ],
      },
      {
        heading: "Jam buka & harga tiket",
        paragraphs: [],
        bullets: [
          "Masjid: tidak ada tiket masuk. Pengunjung datang untuk ibadah maupun melihat-lihat, dengan tetap menghormati waktu salat.",
          "Menara Al Husna: infak Rp10.000/orang. Menurut situs resmi MAJT, menara beroperasi setiap hari pukul 08.15–20.45 WIB, istirahat pukul 11.30–12.30 dan 17.30–18.30 WIB. Hari Jumat, jeda siang biasanya lebih panjang, hingga sekitar pukul 13.00 WIB.",
          "Resto putar di lantai 18 disebut pengelola masih ditutup.",
        ],
      },
      {
        heading: "Tips berkunjung bersama keluarga",
        paragraphs: ["Jam layanan bisa menyesuaikan kegiatan masjid, jadi sebaiknya cek info terbaru sebelum berangkat."],
        bullets: [
          "Kenakan pakaian sopan dan menutup aurat. Bawa mukena atau sarung sendiri supaya lebih nyaman.",
          "Kalau tujuan utamanya berfoto atau naik menara, hindari jam salat berjamaah dan jam istirahat menara.",
          "Pelatarannya sangat luas dan terbuka. Siang hari terasa terik, jadi bawa topi, payung kecil, dan air minum.",
          "Naik menara lebih nyaman pagi atau sore saat langit cerah. Anak-anak biasanya senang melihat kota dari atas.",
          "Jaga kebersihan dan ketenangan, karena masjid tetap dipakai beribadah sepanjang hari.",
          "Kalau datang hari Jumat, perhitungkan keramaian jemaah salat Jumat. Bagi keluarga yang ingin berfoto dengan tenang, hari kerja selain Jumat biasanya lebih longgar.",
        ],
      },
      {
        heading: "Menginap dekat sini",
        paragraphs: [
          "Rencanakan kunjungan ke MAJT dengan istirahat yang cukup sebelum dan sesudahnya. Pomah Guesthouse di Sampangan menyediakan kamar keluarga yang lapang, seperti **Family Suite 100** dengan dua kamar tidur dan ruang tamu, atau **Family Room 222** untuk hingga empat tamu. Jadi keluarga yang datang bersama bisa tetap satu unit tanpa berdesakan. Cek ketersediaan di situs Pomah atau tanya langsung lewat WhatsApp.",
        ],
      },
    ],
    faq: [
      {
        question: "Apakah masuk MAJT dikenakan biaya?",
        answer: "Masuk masjid tidak ada tiket. Untuk naik Menara Al Husna, pengunjung memberi infak Rp10.000 per orang.",
      },
      {
        question: "Jam berapa Menara Al Husna buka?",
        answer:
          "Menurut situs resmi MAJT, setiap hari pukul 08.15–20.45 WIB dengan jeda istirahat di siang dan sore hari. Sebaiknya cek info terbaru sebelum berangkat.",
      },
      {
        question: "Berapa lama perjalanan dari Pomah Guesthouse ke MAJT?",
        answer: "Sekitar 25–35 menit berkendara, jaraknya kurang lebih 11 km.",
      },
    ],
    links: [
      { anchor: "Family Suite 100 untuk keluarga", href: "/rooms/family-suite-100" },
      { anchor: "Family Room 222", href: "/rooms/family-room-222" },
      { anchor: "Kota Lama Semarang", href: "/explore/kota-lama-semarang" },
    ],
  },
  {
    canonicalSlug: "obyek-wisata-goa-kreo",
    names: ["Goa Kreo", "Obyek Wisata Goa Kreo", "Gua Kreo"],
    title: "Goa Kreo Semarang: Tiket, Jam Buka & Rute | Pomah",
    meta: "Panduan ke Goa Kreo dari Pomah Guesthouse: sekitar 7 km dari Sampangan. Info tiket, jam buka, legenda Sunan Kalijaga, dan tips aman bersama anak.",
    h1: "Goa Kreo Semarang: Wisata Alam Dekat Pomah Guesthouse",
    cardIntro:
      "Jembatan di atas Waduk Jatibarang, gua yang dikaitkan dengan kisah Sunan Kalijaga, dan kawanan kera ekor panjang jadi daya tarik Goa Kreo. Pilihan wisata alam yang dekat untuk keluarga, tanpa harus ke pusat kota.",
    sections: [
      {
        heading: "Sekilas tentang Goa Kreo",
        paragraphs: [
          "Goa Kreo terletak di Kandri, Gunungpati, di kawasan perbukitan barat daya Semarang dan berdampingan dengan Waduk Jatibarang. Menurut cerita rakyat setempat, gua ini adalah petilasan Sunan Kalijaga saat mencari kayu jati untuk tiang Masjid Agung Demak. Konon beliau dibantu kawanan kera, lalu meminta mereka menjaga tempat itu. Kata \"mangreho\" (menjaga) dipercaya menjadi asal nama \"Kreo\".",
          "Sampai sekarang, ratusan kera ekor panjang hidup di sekitar kawasan ini dan menjadi daya tarik utama. Pengunjung biasanya menyeberangi jembatan, menikmati pemandangan waduk yang dikelilingi hutan, lalu naik tangga menuju mulut gua.",
        ],
      },
      {
        heading: "Cara ke sana dari Pomah Guesthouse",
        paragraphs: [
          "Goa Kreo tidak jauh dari Pomah, sekitar 7 km atau kurang lebih 15–25 menit berkendara ke arah Gunungpati/Kandri, tergantung kondisi jalan. Menjelang lokasi, jalan melewati area perbukitan. Motor dan mobil pribadi paling fleksibel. Kalau memakai taksi atau ojek online, sebaiknya rencanakan juga cara pulang sebelum berangkat.",
        ],
      },
      {
        heading: "Jam buka & harga tiket",
        paragraphs: [
          "Menurut Dinas Kebudayaan dan Pariwisata Kota Semarang:",
          "Goa Kreo biasanya buka pukul 08.00–16.00 WIB pada hari kerja dan hingga 17.00 WIB pada akhir pekan. Saat libur panjang seperti Lebaran, tarif biasanya disesuaikan. Wahana atau aktivitas tambahan di kawasan wisata dikenakan biaya terpisah. Sebaiknya cek info terbaru sebelum berangkat.",
        ],
        bullets: ["Tiket masuk hari biasa: Rp8.000/orang", "Hari Minggu/libur: Rp10.000/orang"],
      },
      {
        heading: "Tips berkunjung bersama keluarga",
        paragraphs: [],
        bullets: [
          "Jangan memberi makan atau memamerkan makanan di depan kera. Simpan makanan, botol minum, kacamata, dan ponsel di tas tertutup. Pegang tangan anak kecil saat melewati area kera.",
          "Pakai sepatu yang nyaman dan tidak licin, karena ada tangga dan jalan setapak, terutama setelah hujan.",
          "Datang pagi saat udara masih sejuk dan pengunjung belum ramai. Sekitar pukul 10.00 juga waktu yang pas.",
          "Bawa air minum dan tisu basah. Setelah dari Goa Kreo, bisa lanjut makan di sekitar Gunungpati.",
          "Untuk lansia atau balita, tidak perlu memaksakan naik sampai mulut gua. Pemandangan waduk dari area jembatan sudah cukup menyenangkan, dan bisa jadi tempat menunggu yang teduh.",
        ],
      },
      {
        heading: "Menginap dekat sini",
        paragraphs: [
          "Pomah Guesthouse termasuk penginapan kota yang cukup dekat ke Goa Kreo, jadi Anda bisa berangkat pagi tanpa terburu-buru. Untuk keluarga, **Family Room 222** di lantai dua punya dua kamar tidur, dua kamar mandi, dan ruang keluarga untuk hingga empat tamu. Tempat yang pas untuk beristirahat setelah seharian di alam. Pesan langsung melalui situs Pomah.",
        ],
      },
    ],
    faq: [
      {
        question: "Berapa harga tiket Goa Kreo?",
        answer:
          "Menurut Disbudpar Kota Semarang, Rp8.000 di hari biasa dan Rp10.000 di hari Minggu/libur. Saat Lebaran, tarif biasanya disesuaikan.",
      },
      {
        question: "Apakah kera di Goa Kreo berbahaya?",
        answer:
          "Kera biasanya tidak menyerang jika tidak diganggu, tetapi mereka bisa merebut makanan atau barang. Simpan barang di tas tertutup dan jangan memberi makan.",
      },
      {
        question: "Berapa jauh Goa Kreo dari Pomah Guesthouse?",
        answer: "Sekitar 7 km, kurang lebih 15–25 menit berkendara.",
      },
    ],
    links: [
      { anchor: "Family Room 222 dengan dua kamar mandi", href: "/rooms/family-room-222" },
      { anchor: "Sam Poo Kong", href: "/explore/sam-poo-kong" },
      { anchor: "soto Semarang untuk sarapan", href: "/explore/soto-pak-wito-trangkil" },
    ],
  },
];

const ARTICLE_BY_SLUG = new Map<string, CityGuideArticle>();
for (const article of CITY_GUIDE_ARTICLES) {
  ARTICLE_BY_SLUG.set(article.canonicalSlug, article);
  for (const name of article.names) {
    const slug = slugifyPlaceName(name);
    if (slug) ARTICLE_BY_SLUG.set(slug, article);
  }
}

export function cityGuideArticleForSlug(slug: string | null | undefined): CityGuideArticle | null {
  const clean = slugifyPlaceName(slug ?? "");
  if (!clean) return null;
  return ARTICLE_BY_SLUG.get(clean) ?? null;
}

export function cardIntroForName(name: string | null | undefined, fallback: string): string {
  const article = cityGuideArticleForSlug(slugifyPlaceName(name ?? ""));
  return article?.cardIntro || fallback;
}

export function approvedRoomSeo(slug: string | null | undefined): ApprovedRoomSeo | null {
  const clean = (slug ?? "").trim().toLowerCase();
  return APPROVED_ROOMS[clean] ?? null;
}

export function isLegacyHomepageH1(value: string): boolean {
  return value === "Penginapan Dekat UNNES Semarang" || value === PREVIOUS_HOME_H1;
}

export function isLegacyHomepageTitle(value: string): boolean {
  return value === PREVIOUS_HOME_TITLE;
}

export function isLegacyHomepageMeta(value: string): boolean {
  return value === PREVIOUS_HOME_META;
}

/** Public claim that a room has hot water. Denial copy ("belum menyediakan") is not a claim. */
const PUBLIC_HOT_WATER_CLAIM_RE =
  /\b(?:air(?:nya)?\s*(?:panas|hangat)(?:nya)?|hot\s*water|hot\s*shower|water\s*heater|pemanas\s*air)\b/i;

const PUBLIC_HOT_WATER_DENIAL_RE =
  /belum\s+(?:menyediakan|ada|tersedia)|tidak\s+(?:menyediakan|tersedia)|jangan\s+(?:pernah|mengklaim|laporkan|menyimpulkan|klaim)/i;

export function containsPublicHotWaterClaim(value: string | null | undefined): boolean {
  return PUBLIC_HOT_WATER_CLAIM_RE.test(value ?? "");
}

/**
 * Remove a false hot-water claim from public copy.
 * Text that says hot water is not available is returned unchanged.
 * Text with no claim is returned unchanged.
 */
export function stripPublicHotWaterClaim(value: string | null | undefined): string {
  const original = value ?? "";
  if (!containsPublicHotWaterClaim(original) || PUBLIC_HOT_WATER_DENIAL_RE.test(original)) return original;
  let text = original
    .replaceAll(
      "Grand Deluxe Lantai 1 dengan Air Panas | Pomah Semarang",
      "Grand Deluxe Lantai 1 Lebih Lega | Pomah Semarang",
    )
    .replaceAll(
      "Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, air panas, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.",
      "Grand Deluxe 20 m² di lantai 1 Pomah Guesthouse Semarang: kasur double, AC, dan WiFi. Kamar lebih lega untuk berdua, mulai Rp300.000/malam.",
    )
    .replaceAll(
      "Kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.",
      "kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.",
    )
    .replaceAll(
      "kamar di lantai satu dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.",
      "kamar di lantai satu dengan kasur double dan ruang yang sedikit lebih lega.",
    )
    .replaceAll(
      "dengan kasur double dan air panas, untuk yang ingin sedikit lebih lega.",
      "dengan kasur double dan ruang yang sedikit lebih lega.",
    )
    .replaceAll(
      "dengan kasur double dan Air Panas, untuk yang ingin sedikit lebih lega.",
      "dengan kasur double dan ruang yang sedikit lebih lega.",
    );
  if (!containsPublicHotWaterClaim(text)) return text;
  const phrase =
    String.raw`\b(?:air(?:nya)?\s*(?:panas|hangat)(?:nya)?|hot\s*water|hot\s*shower|water\s*heater|pemanas\s*air)\b`;
  text = text
    .replace(new RegExp(String.raw`\s+\b(?:dan|dengan)\s+${phrase}`, "gi"), "")
    .replace(new RegExp(String.raw`\s*,\s*${phrase}`, "gi"), "")
    .replace(new RegExp(String.raw`${phrase}\s*,\s*`, "gi"), "")
    .replace(new RegExp(phrase, "gi"), "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,.;])(?:\s*[,.;])+/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return text;
}

/** Drop amenity labels that claim hot water. Other amenities stay in order. */
export function omitPublicHotWaterAmenities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0 && !containsPublicHotWaterClaim(item));
}

function isHotWaterAmenityNode(item: unknown): boolean {
  if (typeof item === "string") return containsPublicHotWaterClaim(item);
  if (!item || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  return containsPublicHotWaterClaim(`${record.name ?? ""} ${record.value ?? ""}`);
}

/** Remove hot-water claims from stored public JSON, including schema.org amenityFeature entries. */
export function stripHotWaterFromPublicJson<T>(value: T): T {
  return stripHotWaterNode(value) as T;
}

function stripHotWaterNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripHotWaterNode);
  if (typeof node === "string") return stripPublicHotWaterClaim(node);
  if (!node || typeof node !== "object") return node;
  const input = node as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if ((key === "amenityFeature" || key === "amenities") && Array.isArray(child)) {
      output[key] = child.filter((item) => !isHotWaterAmenityNode(item)).map(stripHotWaterNode);
      continue;
    }
    output[key] = stripHotWaterNode(child);
  }
  return output;
}

/** Strip a JSON-LD string. Invalid JSON falls back to plain-text claim removal. */
export function stripPublicHotWaterJsonText(raw: string | null | undefined): string {
  const value = raw ?? "";
  const trimmed = value.trim();
  if (!trimmed || !containsPublicHotWaterClaim(trimmed)) return value;
  try {
    return JSON.stringify(stripHotWaterFromPublicJson(JSON.parse(trimmed)));
  } catch {
    return stripPublicHotWaterClaim(value);
  }
}

export function publicRoomBlurb(slug: string | null | undefined, text: string | null | undefined): string {
  const value = stripPublicHotWaterClaim(text ?? "");
  if (!value.includes(FAMILY_SUITE_DESCRIPTION_OLD)) return value;
  if (slug && slug !== "family-suite-100" && !value.includes("di pusat kota")) return value;
  return value.replaceAll(FAMILY_SUITE_DESCRIPTION_OLD, FAMILY_SUITE_DESCRIPTION_NEW);
}

function isUnnesSekaran(name: string): boolean {
  const value = name.toLowerCase();
  return value.includes("unnes") && value.includes("sekaran");
}

function isUnnesSampangan(name: string): boolean {
  const value = name.toLowerCase();
  return value.includes("unnes") && value.includes("sampangan");
}

export function normalizeNearbyList<T extends { name?: string; distance?: string; time?: string; type?: string }>(
  items: T[] | null | undefined,
): T[] {
  const list = (items ?? []).map((item) => {
    if (!isUnnesSekaran(item.name ?? "")) return item;
    return { ...item, distance: UNNES_SEKARAN_DISTANCE, time: UNNES_SEKARAN_TIME };
  });
  if (list.some((item) => isUnnesSampangan(item.name ?? ""))) return list;
  const sekaran = list.findIndex((item) => isUnnesSekaran(item.name ?? ""));
  const entry = { ...UNNES_SAMPANGAN_NEARBY } as T;
  if (sekaran >= 0) list.splice(sekaran + 1, 0, entry);
  else list.unshift(entry);
  return list;
}

/** Walk public JSON so stored "8 km / ~13 menit" for UNNES Sekaran renders as the approved distance. */
export function patchUnnesDistance<T>(value: T): T {
  return walk(value) as T;
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk);
  if (typeof node === "string") return patchUnnesDistanceText(node);
  if (!node || typeof node !== "object") return node;
  const input = node as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) output[key] = walk(child);
  const name = typeof output.name === "string" ? output.name : "";
  if (isUnnesSekaran(name)) {
    output.distance = UNNES_SEKARAN_DISTANCE;
    output.time = UNNES_SEKARAN_TIME;
  }
  if (Array.isArray(output.nearby)) {
    output.nearby = normalizeNearbyList(output.nearby as NearbyPlace[]);
  }
  return output;
}

function patchUnnesDistanceText(value: string): string {
  if (!/unnes sekaran/i.test(value) || !/8\s*km/i.test(value)) return value;
  return value
    .replace(/~\s*13\s*menit/gi, UNNES_SEKARAN_TIME)
    .replace(/~\s*10\s*menit(?!–|-)/gi, UNNES_SEKARAN_TIME)
    .replace(/8\s*km/gi, UNNES_SEKARAN_DISTANCE);
}

type ExploreList = Array<Record<string, unknown>>;

/** Replace known older homepage SEO defaults in stored JSON before it is rendered. */
export function applyApprovedHomepageSeo<T>(config: T): T {
  if (!config || typeof config !== "object") return config;
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  const current = cloned.seo && typeof cloned.seo === "object" ? (cloned.seo as Record<string, unknown>) : {};
  const seo = { ...current };
  const h1 = typeof seo.h1 === "string" ? seo.h1 : "";
  const title = typeof seo.metaTitle === "string" ? seo.metaTitle : "";
  const meta = typeof seo.metaDescription === "string" ? seo.metaDescription : "";
  const twitterTitle = typeof seo.twitterTitle === "string" ? seo.twitterTitle : "";
  const twitterDescription = typeof seo.twitterDescription === "string" ? seo.twitterDescription : "";
  if (!h1 || isLegacyHomepageH1(h1)) seo.h1 = APPROVED_HOME.h1;
  if (!title || isLegacyHomepageTitle(title)) seo.metaTitle = APPROVED_HOME.title;
  if (!meta || isLegacyHomepageMeta(meta)) seo.metaDescription = APPROVED_HOME.meta;
  if (!twitterTitle || isLegacyHomepageTitle(twitterTitle)) seo.twitterTitle = APPROVED_HOME.title;
  if (!twitterDescription || isLegacyHomepageMeta(twitterDescription)) seo.twitterDescription = APPROVED_HOME.meta;
  if (typeof seo.targetKeyword === "string" && seo.targetKeyword.trim().toLowerCase() === "guesthouse keluarga semarang") {
    seo.targetKeyword = "";
  }
  cloned.seo = seo;
  return cloned as T;
}

export function applyGuideCardIntros(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const cloned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const key of ["destinations", "culinary", "events", "news"] as const) {
    const rows = cloned[key];
    if (!Array.isArray(rows)) continue;
    cloned[key] = (rows as ExploreList).map((row) => {
      const name = String(row.name ?? row.title ?? "");
      const article = cityGuideArticleForSlug(slugifyPlaceName(name));
      if (!article) return row;
      return { ...row, desc: article.cardIntro, metaDescription: article.meta };
    });
  }
  return cloned;
}
