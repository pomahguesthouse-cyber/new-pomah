import { useEffect, useMemo, useState, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPublicSiteData, submitPublicBooking } from "@/public/functions/public.functions";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Users, 
  CalendarDays, 
  Search, 
  AirVent, 
  Wifi, 
  Bath, 
  Coffee, 
  MapPin, 
  MessageCircle, 
  Clock,
  ShieldCheck,
  BedDouble,
  CheckCircle2
} from "lucide-react";

/** Optional prefill carried from a room's dedicated booking page. */
type BookSearch = { room?: string; checkIn?: string; checkOut?: string; adults?: number };

export const Route = createFileRoute("/book/")({
  validateSearch: (s: Record<string, unknown>): BookSearch => {
    const out: BookSearch = {};
    if (typeof s.room === "string") out.room = s.room;
    if (typeof s.checkIn === "string") out.checkIn = s.checkIn;
    if (typeof s.checkOut === "string") out.checkOut = s.checkOut;
    if (s.adults != null && !Number.isNaN(Number(s.adults))) out.adults = Number(s.adults);
    return out;
  },
  loader: async () => {
    const { getPublicSiteData } = await import("@/public/functions/public.functions");
    return getPublicSiteData();
  },
  head: () => ({
    meta: [
      { title: "Reservasi Online Langsung — Pomah Guesthouse Semarang" },
      {
        name: "description",
        content: "Pesan kamar di Pomah Guesthouse Semarang secara langsung. Proses mudah, tanpa perantara, dan konfirmasi instan via WhatsApp.",
      },
    ],
  }),
  component: BookPage,
});

function BookPage() {
  const loaderData = Route.useLoaderData();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const fn = useServerFn(getPublicSiteData);
  const submit = useServerFn(submitPublicBooking);
  const { data } = useQuery({
    queryKey: ["public-site"],
    queryFn: () => fn(),
    initialData: loaderData,
  });
  const rooms = useMemo(() => data?.roomTypes ?? [], [data]);

  const today = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date(Date.now() + 86400000);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    roomTypeId: "",
    checkIn: search.checkIn ?? today,
    checkOut: search.checkOut ?? tomorrow,
    adults: search.adults ?? 2,
    children: 0,
    rooms: 1, // Jumlah Kamar
    specialRequests: "",
  });
  const [pending, setPending] = useState(false);

  // Prefill the room from the ?room=<slug> param once room types load.
  const prefillRoom = search.room;
  useEffect(() => {
    if (!prefillRoom || rooms.length === 0) return;
    const match = rooms.find((r: any) => r.slug === prefillRoom || r.id === prefillRoom);
    if (match) setForm((f) => (f.roomTypeId ? f : { ...f, roomTypeId: match.id }));
  }, [prefillRoom, rooms]);

  // Recalculate room requirements automatically based on guests
  useEffect(() => {
    const match = rooms.find((r: any) => r.id === form.roomTypeId);
    if (match && match.capacity) {
      const requiredRooms = Math.ceil(form.adults / match.capacity);
      // Auto-set rooms if it's less than what's needed for the guests
      if (form.rooms < requiredRooms) {
        setForm((f) => ({ ...f, rooms: requiredRooms }));
      }
    }
  }, [form.adults, form.roomTypeId, rooms]);

  const selectedRoom = useMemo(() => rooms.find((r: any) => r.id === form.roomTypeId), [form.roomTypeId, rooms]);

  // Calculations for summary
  const nights = useMemo(() => {
    const d1 = new Date(form.checkIn).getTime();
    const d2 = new Date(form.checkOut).getTime();
    const diff = (d2 - d1) / 86400000;
    return diff > 0 ? Math.round(diff) : 0;
  }, [form.checkIn, form.checkOut]);

  const subtotal = useMemo(() => {
    if (!selectedRoom || nights <= 0) return 0;
    return Number(selectedRoom.base_rate) * nights * form.rooms;
  }, [selectedRoom, nights, form.rooms]);

  const roomListRef = useRef<HTMLDivElement>(null);

  const handleSearchClick = () => {
    roomListRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.roomTypeId) return toast.error("Silakan pilih kamar terlebih dahulu");
    if (nights <= 0) return toast.error("Check-out harus setelah check-in");
    
    setPending(true);
    try {
      const res = await submit({ data: form });
      toast.success("Booking berhasil dibuat");
      navigate({ to: "/book/confirmation/$id", params: { id: res.id }, search: {} });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  // Helper for formatting date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-[#F9F9F7] text-stone-900 font-sans">
      <PublicNav property={data?.property} />

      {/* Hero Section */}
      <section className="relative pt-16 pb-12 md:pt-24 md:pb-16 bg-stone-900 overflow-hidden">
        {/* Placeholder for Page Builder Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=2070&auto=format&fit=crop" 
            alt="Hero Background" 
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#F9F9F7] via-transparent to-stone-900/40" />
        </div>
        
        <div className="relative z-10 mx-auto max-w-[1440px] px-6">
          <div className="max-w-2xl text-white">
            <h1 className="font-serif text-5xl md:text-6xl font-semibold tracking-tight leading-tight">
              Pesan kamar dengan mudah
            </h1>
            <p className="mt-4 text-lg text-stone-200">
              Cek ketersediaan, pilih kamar, dan konfirmasi booking dalam beberapa langkah.
            </p>
          </div>

          {/* Search Bar */}
          <div className="mt-10 bg-white rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center gap-4 max-w-4xl">
            <div className="flex-1 w-full flex items-center gap-3 px-4 py-2 border-r-0 md:border-r border-stone-200">
              <CalendarDays className="w-5 h-5 text-stone-400" />
              <div className="flex flex-col w-full">
                <span className="text-xs font-semibold text-stone-500 uppercase">Check-in</span>
                <input 
                  type="date" 
                  value={form.checkIn}
                  onChange={(e) => setForm({...form, checkIn: e.target.value})}
                  className="text-sm font-medium border-none outline-none focus:ring-0 p-0 text-stone-800 bg-transparent"
                />
              </div>
            </div>
            
            <div className="flex-1 w-full flex items-center gap-3 px-4 py-2 border-r-0 md:border-r border-stone-200">
              <CalendarDays className="w-5 h-5 text-stone-400" />
              <div className="flex flex-col w-full">
                <span className="text-xs font-semibold text-stone-500 uppercase">Check-out</span>
                <input 
                  type="date" 
                  value={form.checkOut}
                  onChange={(e) => setForm({...form, checkOut: e.target.value})}
                  className="text-sm font-medium border-none outline-none focus:ring-0 p-0 text-stone-800 bg-transparent"
                />
              </div>
            </div>

            <div className="flex-1 w-full flex items-center gap-3 px-4 py-2">
              <Users className="w-5 h-5 text-stone-400" />
              <div className="flex flex-col w-full">
                <span className="text-xs font-semibold text-stone-500 uppercase">Tamu</span>
                <select 
                  value={form.adults}
                  onChange={(e) => setForm({...form, adults: Number(e.target.value)})}
                  className="text-sm font-medium border-none outline-none focus:ring-0 p-0 text-stone-800 bg-transparent appearance-none cursor-pointer"
                >
                  {[1,2,3,4,5,6,7,8,9,10,12,15,20].map(n => (
                    <option key={n} value={n}>{n} Tamu</option>
                  ))}
                </select>
              </div>
            </div>

            <Button 
              size="lg" 
              onClick={handleSearchClick}
              className="w-full md:w-auto bg-[#364935] hover:bg-[#2A3929] text-white rounded-xl px-8 h-12"
            >
              Cari kamar
            </Button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1440px] px-6 py-8" ref={roomListRef}>
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
          
          {/* Left Column */}
          <div className="flex-1 space-y-12">
            
            {/* Rooms Section */}
            <section>
              <h2 className="font-serif text-2xl font-semibold mb-2">Pilih kamar yang tersedia</h2>
              <p className="text-stone-500 mb-6">Pilih kamar yang paling cocok untuk kebutuhan Anda.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {rooms.map((room: any, index: number) => (
                  <div key={room.id} className={`bg-white rounded-2xl border ${form.roomTypeId === room.id ? 'border-[#364935] ring-1 ring-[#364935]' : 'border-stone-200'} overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md relative`}>
                    {index === 1 && (
                       <div className="absolute top-4 left-4 z-10 bg-stone-900/80 backdrop-blur text-white text-xs font-medium px-3 py-1 rounded-full">
                         Populer
                       </div>
                    )}
                    <div className="aspect-[4/3] bg-stone-100 relative overflow-hidden">
                      {room.hero_image_url ? (
                        <img src={room.hero_image_url} alt={room.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-stone-300">
                          <BedDouble className="w-12 h-12" />
                        </div>
                      )}
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <h3 className="font-serif text-xl font-semibold mb-1">{room.name}</h3>
                      <p className="text-sm text-stone-500 mb-4">Mulai dari <span className="font-semibold text-stone-900">Rp{Number(room.base_rate).toLocaleString("id-ID")}</span> / malam</p>
                      
                      <ul className="space-y-2 mb-6 flex-1">
                        <li className="flex items-center gap-2 text-sm text-stone-600">
                          <Users className="w-4 h-4" /> {room.capacity} Tamu
                        </li>
                        <li className="flex items-center gap-2 text-sm text-stone-600">
                          <AirVent className="w-4 h-4" /> AC
                        </li>
                        <li className="flex items-center gap-2 text-sm text-stone-600">
                          <Wifi className="w-4 h-4" /> WiFi
                        </li>
                        <li className="flex items-center gap-2 text-sm text-stone-600">
                          <Bath className="w-4 h-4" /> Kamar mandi dalam
                        </li>
                        <li className="flex items-center gap-2 text-sm text-stone-600">
                          <Coffee className="w-4 h-4" /> Sarapan opsional
                        </li>
                      </ul>

                      <Button 
                        variant={form.roomTypeId === room.id ? "default" : "outline"}
                        className={`w-full rounded-xl ${form.roomTypeId === room.id ? 'bg-[#364935] hover:bg-[#2A3929] text-white' : 'border-[#364935] text-[#364935] hover:bg-stone-50'}`}
                        onClick={() => setForm({...form, roomTypeId: room.id})}
                      >
                        {form.roomTypeId === room.id ? "Kamar terpilih" : "Pilih kamar"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Form Section */}
            <section>
              <h2 className="font-serif text-2xl font-semibold mb-2">Data pemesan</h2>
              <p className="text-stone-500 mb-6">Lengkapi data di bawah untuk melanjutkan booking.</p>

              <form id="booking-form" onSubmit={onSubmit} className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Nama lengkap <span className="text-red-500">*</span></Label>
                    <Input 
                      required 
                      placeholder="Masukkan nama lengkap" 
                      className="rounded-xl border-stone-200"
                      value={form.fullName}
                      onChange={e => setForm({...form, fullName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Nomor WhatsApp <span className="text-red-500">*</span></Label>
                    <Input 
                      required 
                      placeholder="08xxxxxxxxxx" 
                      className="rounded-xl border-stone-200"
                      value={form.phone}
                      onChange={e => setForm({...form, phone: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Email (opsional)</Label>
                    <Input 
                      type="email" 
                      placeholder="Masukkan email Anda" 
                      className="rounded-xl border-stone-200"
                      value={form.email}
                      onChange={e => setForm({...form, email: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Check-in <span className="text-red-500">*</span></Label>
                    <Input 
                      type="date" 
                      required 
                      className="rounded-xl border-stone-200"
                      value={form.checkIn}
                      onChange={e => setForm({...form, checkIn: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Check-out <span className="text-red-500">*</span></Label>
                    <Input 
                      type="date" 
                      required 
                      className="rounded-xl border-stone-200"
                      value={form.checkOut}
                      onChange={e => setForm({...form, checkOut: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Jumlah tamu <span className="text-red-500">*</span></Label>
                    <Select value={form.adults.toString()} onValueChange={v => setForm({...form, adults: Number(v)})}>
                      <SelectTrigger className="rounded-xl border-stone-200">
                        <SelectValue placeholder="Pilih tamu" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1,2,3,4,5,6,7,8,9,10,12,15,20].map(n => (
                          <SelectItem key={n} value={n.toString()}>{n} Tamu</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700">Pilih kamar <span className="text-red-500">*</span></Label>
                    <Select value={form.roomTypeId} onValueChange={v => setForm({...form, roomTypeId: v})}>
                      <SelectTrigger className="rounded-xl border-stone-200">
                        <SelectValue placeholder="Pilih tipe kamar" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms.map((r: any) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} — Rp {Number(r.base_rate).toLocaleString("id-ID")} / malam
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-stone-700 flex justify-between">
                      <span>Jumlah kamar <span className="text-red-500">*</span></span>
                      {selectedRoom && (
                         <span className="text-xs text-amber-600 font-normal">Min. {Math.ceil(form.adults / (selectedRoom.capacity || 2))} kamar untuk {form.adults} tamu</span>
                      )}
                    </Label>
                    <Select value={form.rooms.toString()} onValueChange={v => setForm({...form, rooms: Number(v)})}>
                      <SelectTrigger className="rounded-xl border-stone-200">
                        <SelectValue placeholder="Pilih jumlah kamar" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1,2,3,4,5,6,7,8,9,10].map(n => (
                          <SelectItem key={n} value={n.toString()}>{n} Kamar</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-stone-700">Catatan khusus (opsional)</Label>
                  <Textarea 
                    rows={3} 
                    placeholder="Contoh: Butuh kamar di lantai bawah, early check-in, dll." 
                    className="rounded-xl border-stone-200 resize-none"
                    value={form.specialRequests}
                    onChange={e => setForm({...form, specialRequests: e.target.value})}
                  />
                </div>
              </form>

              {/* Help Box */}
              <div className="mt-8 bg-[#F5F8F5] border border-[#E8F0E8] rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4 justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center shrink-0">
                    <MessageCircle className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-stone-900">Butuh bantuan?</h4>
                    <p className="text-sm text-stone-500">Chat admin kami jika ada pertanyaan atau permintaan khusus.</p>
                  </div>
                </div>
                <Button variant="outline" className="shrink-0 rounded-xl bg-white border-stone-200 text-stone-700 hover:bg-stone-50" asChild>
                  <a href="https://wa.me/6281234567890" target="_blank" rel="noreferrer">
                    Chat via WhatsApp
                  </a>
                </Button>
              </div>

            </section>
          </div>

          {/* Right Sidebar */}
          <div className="w-full lg:w-[380px] shrink-0">
            <div className="sticky top-24 bg-white rounded-3xl border border-stone-200 shadow-xl shadow-stone-200/50 p-6">
              <h3 className="font-serif text-xl font-semibold mb-6">Ringkasan Booking</h3>
              
              {selectedRoom ? (
                <>
                  <div className="flex gap-4 items-center mb-6 pb-6 border-b border-stone-100">
                    <div className="w-20 h-20 rounded-xl overflow-hidden bg-stone-100 shrink-0">
                      {selectedRoom.hero_image_url ? (
                        <img src={selectedRoom.hero_image_url} alt={selectedRoom.name} className="w-full h-full object-cover" />
                      ) : (
                        <BedDouble className="w-8 h-8 m-6 text-stone-300" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-semibold text-stone-900">{selectedRoom.name}</h4>
                      <p className="text-sm text-stone-500">Kapasitas {selectedRoom.capacity} tamu per kamar</p>
                    </div>
                  </div>

                  <div className="space-y-4 mb-6 pb-6 border-b border-stone-100 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-500 flex items-center gap-2"><CalendarDays className="w-4 h-4"/> Check-in</span>
                      <span className="font-medium text-stone-900">{formatDate(form.checkIn)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500 flex items-center gap-2"><CalendarDays className="w-4 h-4"/> Check-out</span>
                      <span className="font-medium text-stone-900">{formatDate(form.checkOut)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500 flex items-center gap-2"><Clock className="w-4 h-4"/> Jumlah malam</span>
                      <span className="font-medium text-stone-900">{nights} Malam</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500 flex items-center gap-2"><Users className="w-4 h-4"/> Tamu</span>
                      <span className="font-medium text-stone-900">{form.adults} Tamu</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500 flex items-center gap-2"><BedDouble className="w-4 h-4"/> Kamar</span>
                      <span className="font-medium text-stone-900">{form.rooms} Kamar</span>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6 pb-6 border-b border-stone-100 text-sm">
                    <div className="flex justify-between">
                      <span className="text-stone-500">Harga per malam</span>
                      <span className="font-medium text-stone-900">Rp{Number(selectedRoom.base_rate).toLocaleString("id-ID")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-stone-500">Subtotal ({nights}x malam, {form.rooms}x kamar)</span>
                      <span className="font-medium text-stone-900">Rp{subtotal.toLocaleString("id-ID")}</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-end mb-6">
                    <span className="text-stone-600 font-medium">Total estimasi</span>
                    <span className="font-serif text-2xl font-semibold text-stone-900">Rp{subtotal.toLocaleString("id-ID")}</span>
                  </div>
                  
                  <div className="bg-[#FFF9E6] border border-[#FFE5A3] rounded-xl p-4 flex gap-3 mb-6">
                    <Clock className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Status</p>
                      <p className="text-xs text-amber-700">Menunggu konfirmasi admin</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Button 
                      type="submit" 
                      form="booking-form"
                      disabled={pending}
                      className="w-full h-12 bg-[#364935] hover:bg-[#2A3929] text-white rounded-xl font-medium text-base"
                    >
                      {pending ? "Memproses..." : "Kirim booking"}
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full h-12 bg-white border-stone-200 text-stone-700 rounded-xl hover:bg-stone-50 flex items-center justify-center gap-2"
                      asChild
                    >
                      <a href="https://wa.me/6281234567890" target="_blank" rel="noreferrer">
                        <MessageCircle className="w-4 h-4 text-green-600" /> Chat admin via WhatsApp
                      </a>
                    </Button>
                  </div>
                  <p className="text-center text-xs text-stone-400 mt-4">
                    Booking mudah & cepat via WhatsApp.
                  </p>
                </>
              ) : (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-6 h-6 text-stone-300" />
                  </div>
                  <p className="text-stone-500 text-sm">Pilih tipe kamar di sebelah kiri untuk melihat ringkasan pesanan Anda.</p>
                </div>
              )}
            </div>
          </div>
          
        </div>
      </main>

      {/* Benefits Section */}
      <section className="bg-white border-t border-stone-200 py-12">
        <div className="max-w-[1440px] mx-auto px-6">
          <h2 className="font-serif text-2xl font-semibold mb-8 text-center md:text-left">Kenapa memilih New Pomah Guesthouse?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="flex gap-4 p-4 rounded-2xl bg-[#F9F9F7] border border-stone-100">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                <MapPin className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 text-sm mb-1">Dekat UNNES</h4>
                <p className="text-xs text-stone-500 leading-relaxed">Lokasi strategis dekat kampus UNNES.</p>
              </div>
            </div>
            
            <div className="flex gap-4 p-4 rounded-2xl bg-[#F9F9F7] border border-stone-100">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 text-sm mb-1">Area tenang</h4>
                <p className="text-xs text-stone-500 leading-relaxed">Lingkungan nyaman dan bebas bising.</p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-2xl bg-[#F9F9F7] border border-stone-100">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                <Users className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 text-sm mb-1">Cocok untuk keluarga</h4>
                <p className="text-xs text-stone-500 leading-relaxed">Kamar luas, nyaman, dan aman untuk keluarga.</p>
              </div>
            </div>

            <div className="flex gap-4 p-4 rounded-2xl bg-[#F9F9F7] border border-stone-100">
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h4 className="font-semibold text-stone-900 text-sm mb-1">Booking mudah</h4>
                <p className="text-xs text-stone-500 leading-relaxed">Bisa booking cepat via WhatsApp.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter property={data?.property} />
    </div>
  );
}
