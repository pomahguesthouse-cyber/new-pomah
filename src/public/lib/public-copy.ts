/**
 * Exact English leftovers that still ship in saved homepage config.
 * Custom Indonesian copy is left untouched.
 */
const PUBLIC_COPY: Record<string, string> = {
  "Your Perfect Stay": "Menginap yang Nyaman",
  "Our Room": "Kamar Kami",
  Facilities: "Fasilitas",
  "News & Event": "Berita & Acara",
  "Free Wifi": "Wifi Gratis",
  "Free Parking": "Parkir Gratis",
  Home: "Beranda",
  Rooms: "Kamar",
  Amenities: "Fasilitas",
  "Quick Links": "Tautan",
  "Follow Us": "Ikuti Kami",
  "Book This Room": "Pesan Kamar Ini",
  Availability: "Ketersediaan",
};

export function publicCopy(value: string | null | undefined): string {
  const raw = value ?? "";
  const trimmed = raw.trim();
  return PUBLIC_COPY[trimmed] ?? raw;
}
