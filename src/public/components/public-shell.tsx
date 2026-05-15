import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, MapPin, Phone, Mail, Instagram, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* Public Nav                                                           */
/* ------------------------------------------------------------------ */
export function PublicNav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link to="/" className="flex items-baseline gap-1">
          <span className="font-serif text-xl font-semibold tracking-tight text-stone-900">
            Pomah
          </span>
          <span className="font-serif text-xl font-light text-amber-700">Living</span>
        </Link>

        {/* Desktop menu */}
        <div className="hidden items-center gap-8 md:flex">
          <Link
            to="/rooms"
            className="text-sm text-stone-600 transition-colors hover:text-stone-900"
          >
            Kamar
          </Link>
          <Link
            to="/book"
            className="text-sm text-stone-600 transition-colors hover:text-stone-900"
          >
            Fasilitas
          </Link>
          <Link
            to="/book"
            className="text-sm text-stone-600 transition-colors hover:text-stone-900"
          >
            Lokasi
          </Link>
          <Button asChild size="sm" className="bg-amber-700 hover:bg-amber-800">
            <Link to="/book">Pesan Sekarang</Link>
          </Button>
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden text-stone-700"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="border-t border-stone-100 bg-white md:hidden">
          <div className="flex flex-col gap-1 px-6 py-4">
            {[
              { to: "/rooms", label: "Kamar" },
              { to: "/book", label: "Fasilitas" },
              { to: "/book", label: "Lokasi" },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => setOpen(false)}
                className="py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                {item.label}
              </Link>
            ))}
            <Button asChild size="sm" className="mt-2 bg-amber-700 hover:bg-amber-800">
              <Link to="/book" onClick={() => setOpen(false)}>
                Pesan Sekarang
              </Link>
            </Button>
          </div>
        </div>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Public Footer                                                        */
/* ------------------------------------------------------------------ */
export function PublicFooter({
  property,
}: {
  property?: {
    name?: string;
    address?: string | null;
    city?: string | null;
    whatsapp_number?: string | null;
    email?: string | null;
  } | null;
}) {
  return (
    <footer className="border-t border-stone-200 bg-stone-900 text-stone-300">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-2xl font-semibold text-white">Pomah</span>
              <span className="font-serif text-2xl font-light text-amber-400">Living</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-stone-400">
              Guesthouse butik dengan pengalaman menginap yang personal. Setiap tamu adalah tamu
              istimewa.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <a
                href="#"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-700 text-stone-400 transition hover:border-amber-400 hover:text-amber-400"
              >
                <Instagram className="h-4 w-4" />
              </a>
              <a
                href={
                  property?.whatsapp_number
                    ? `https://wa.me/${property.whatsapp_number.replace(/\D/g, "")}`
                    : "#"
                }
                className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-700 text-stone-400 transition hover:border-amber-400 hover:text-amber-400"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
              Navigasi
            </p>
            <ul className="space-y-2 text-sm">
              {[
                { to: "/", label: "Beranda" },
                { to: "/rooms", label: "Kamar" },
                { to: "/book", label: "Reservasi" },
              ].map((l) => (
                <li key={l.label}>
                  <Link to={l.to} className="text-stone-400 transition hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
              Kontak
            </p>
            <ul className="space-y-3 text-sm">
              {property?.address && (
                <li className="flex items-start gap-2 text-stone-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    {property.address}
                    {property.city ? `, ${property.city}` : ""}
                  </span>
                </li>
              )}
              {property?.whatsapp_number && (
                <li className="flex items-center gap-2 text-stone-400">
                  <Phone className="h-4 w-4 shrink-0 text-amber-500" />
                  <a
                    href={`https://wa.me/${property.whatsapp_number.replace(/\D/g, "")}`}
                    className="hover:text-white"
                  >
                    {property.whatsapp_number}
                  </a>
                </li>
              )}
              {property?.email && (
                <li className="flex items-center gap-2 text-stone-400">
                  <Mail className="h-4 w-4 shrink-0 text-amber-500" />
                  <a href={`mailto:${property.email}`} className="hover:text-white">
                    {property.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-stone-800 pt-8 md:flex-row">
          <p className="text-xs text-stone-600">
            © {new Date().getFullYear()} Pomah Living. Semua hak dilindungi.
          </p>
          <Link
            to="/login"
            className="font-mono text-[10px] uppercase tracking-widest text-stone-700 hover:text-stone-500"
          >
            Staff Login
          </Link>
        </div>
      </div>
    </footer>
  );
}
