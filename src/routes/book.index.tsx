import { useEffect, useMemo, useState, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPublicSiteData, submitCartBooking } from "@/public/functions/public.functions";
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
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
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
  CheckCircle2,
  Plus,
  Minus,
  Trash2
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

type CartItem = {
  roomTypeId: string;
  quantity: number;
  extraBeds: number;
};

function BookPage() {
  const loaderData = Route.useLoaderData();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const fn = useServerFn(getPublicSiteData);
  const submit = useServerFn(submitCartBooking);
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
    checkIn: search.checkIn ?? today,
    checkOut: search.checkOut ?? tomorrow,
    adults: search.adults ?? 2,
    children: 0,
    specialRequests: "",
  });
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pending, setPending] = useState(false);

  // Prefill the room from the ?room=<slug> param once room types load.
  const prefillRoom = search.room;
  useEffect(() => {
    if (!prefillRoom || rooms.length === 0) return;
    const match = rooms.find((r: any) => r.slug === prefillRoom || r.id === prefillRoom);
    if (match && cartItems.length === 0) {
      setCartItems([{ roomTypeId: match.id, quantity: 1, extraBeds: 0 }]);
    }
  }, [prefillRoom, rooms]);

  // Calculations for summary
  const nights = useMemo(() => {
    const d1 = new Date(form.checkIn).getTime();
    const d2 = new Date(form.checkOut).getTime();
    const diff = (d2 - d1) / 86400000;
    return diff > 0 ? Math.round(diff) : 0;
  }, [form.checkIn, form.checkOut]);

  const grandTotal = useMemo(() => {
    if (nights <= 0) return 0;
    let total = 0;
    cartItems.forEach(item => {
      const room = rooms.find((r: any) => r.id === item.roomTypeId);
      if (room) {
        total += Number(room.base_rate) * nights * item.quantity;
        if (item.extraBeds > 0) {
          total += Number(room.extrabed_rate || 0) * nights * item.extraBeds;
        }
      }
    });
    return total;
  }, [cartItems, nights, rooms]);

  const handleAddToCart = (roomTypeId: string) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.roomTypeId === roomTypeId);
      if (existing) {
        const room = rooms.find((r: any) => r.id === roomTypeId);
        const limit = room?.total_physical_rooms || 10;
        if (existing.quantity < limit) {
           return prev.map(item => item.roomTypeId === roomTypeId ? { ...item, quantity: item.quantity + 1 } : item);
        }
        return prev;
      } else {
        return [...prev, { roomTypeId, quantity: 1, extraBeds: 0 }];
      }
    });
  };

  const updateCartItem = (roomTypeId: string, updates: Partial<CartItem>) => {
    setCartItems(prev => prev.map(item => item.roomTypeId === roomTypeId ? { ...item, ...updates } : item));
  };

  const removeFromCart = (roomTypeId: string) => {
    setCartItems(prev => prev.filter(item => item.roomTypeId !== roomTypeId));
  };

  const roomListRef = useRef<HTMLDivElement>(null);

  const handleSearchClick = () => {
    roomListRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartItems.length === 0) return toast.error("Silakan pilih minimal satu kamar terlebih dahulu");
    if (nights <= 0) return toast.error("Check-out harus setelah check-in");
    
    setPending(true);
    try {
      const res = await submit({ 
        data: {
          ...form,
          cart: cartItems
        }
      });
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
              
              <Carousel
                opts={{
                  align: "start",
                }}
                className="w-full"
              >
                <CarouselContent className="-ml-6">
                  {rooms.map((room: any, index: number) => {
                    const cartItem = cartItems.find(item => item.roomTypeId === room.id);
                    const isInCart = !!cartItem;
                    const availableCount = room.total_physical_rooms || 10;
                    
                    return (
                      <CarouselItem key={room.id} className="pl-6 md:basis-1/2 xl:basis-1/3">
                        <div className={`h-full bg-white rounded-2xl border ${isInCart ? 'border-[#364935] ring-1 ring-[#364935]' : 'border-stone-200'} overflow-hidden shadow-sm flex flex-col transition-all hover:shadow-md relative`}>
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

                            {isInCart ? (
                               <div className="space-y-4 bg-stone-50 p-4 rounded-xl border border-[#364935]/20 mt-auto">
                                 <div className="flex items-center justify-between">
                                   <span className="text-sm font-medium text-stone-700">Jumlah Kamar</span>
                                   <div className="flex items-center gap-3 bg-white border border-stone-200 rounded-lg p-1">
                                     <Button 
                                       type="button"
                                       variant="ghost" 
                                       size="icon" 
                                       className="h-7 w-7 rounded-md hover:bg-stone-100"
                                       onClick={() => cartItem.quantity > 1 ? updateCartItem(room.id, { quantity: cartItem.quantity - 1 }) : removeFromCart(room.id)}
                                     >
                                       {cartItem.quantity > 1 ? <Minus className="h-3 w-3" /> : <Trash2 className="h-3 w-3 text-red-500" />}
                                     </Button>
                                     <span className="text-sm font-semibold w-4 text-center">{cartItem.quantity}</span>
                                     <Button 
                                       type="button"
                                       variant="ghost" 
                                       size="icon" 
                                       className="h-7 w-7 rounded-md hover:bg-stone-100"
                                       disabled={cartItem.quantity >= availableCount}
                                       onClick={() => updateCartItem(room.id, { quantity: cartItem.quantity + 1 })}
                                     >
                                       <Plus className="h-3 w-3" />
                                     </Button>
                                   </div>
                                 </div>
                                 
                                 {(room.extrabed_capacity > 0) && (
                                   <div className="flex items-center justify-between pt-3 border-t border-stone-200">
                                     <div className="flex flex-col">
                                       <span className="text-sm font-medium text-stone-700">Extrabed</span>
                                       <span className="text-xs text-stone-500">+Rp{Number(room.extrabed_rate || 0).toLocaleString("id-ID")}</span>
                                     </div>
                                     <div className="flex items-center gap-3 bg-white border border-stone-200 rounded-lg p-1">
                                       <Button 
                                         type="button"
                                         variant="ghost" 
                                         size="icon" 
                                         className="h-7 w-7 rounded-md hover:bg-stone-100"
                                         disabled={cartItem.extraBeds <= 0}
                                         onClick={() => updateCartItem(room.id, { extraBeds: cartItem.extraBeds - 1 })}
                                       >
                                         <Minus className="h-3 w-3" />
                                       </Button>
                                       <span className="text-sm font-semibold w-4 text-center">{cartItem.extraBeds}</span>
                                       <Button 
                                         type="button"
                                         variant="ghost" 
                                         size="icon" 
                                         className="h-7 w-7 rounded-md hover:bg-stone-100"
                                         disabled={cartItem.extraBeds >= (room.extrabed_capacity * cartItem.quantity)}
                                         onClick={() => updateCartItem(room.id, { extraBeds: cartItem.extraBeds + 1 })}
                                       >
                                         <Plus className="h-3 w-3" />
                                       </Button>
                                     </div>
                                   </div>
                                 )}
                               </div>
                            ) : (
                              <Button 
                                type="button"
                                variant="outline"
                                className="w-full rounded-xl border-[#364935] text-[#364935] hover:bg-stone-50 mt-auto"
                                onClick={() => handleAddToCart(room.id)}
                              >
                                Tambahkan kamar
                              </Button>
                            )}
                          </div>
                        </div>
                      </CarouselItem>
                    );
                  })}
                </CarouselContent>
                <div className="flex justify-end gap-3 mt-6 pr-2">
                  <CarouselPrevious className="static translate-y-0 bg-white border-stone-200 hover:bg-stone-50" />
                  <CarouselNext className="static translate-y-0 bg-white border-stone-200 hover:bg-stone-50" />
                </div>
              </Carousel>
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
              
              {cartItems.length > 0 ? (
                <>
                  <div className="max-h-[40vh] overflow-y-auto pr-2 mb-6 space-y-4">
                  {cartItems.map((item, idx) => {
                     const room = rooms.find((r: any) => r.id === item.roomTypeId);
                     if (!room) return null;
                     const roomSubtotal = Number(room.base_rate) * nights * item.quantity;
                     const extrabedSubtotal = item.extraBeds > 0 ? Number(room.extrabed_rate || 0) * nights * item.extraBeds : 0;
                     
                     return (
                        <div key={idx} className="pb-4 border-b border-stone-100 last:border-b-0 last:pb-0">
                           <div className="flex justify-between items-start mb-2">
                             <div>
                               <h4 className="font-semibold text-stone-900 leading-tight">{room.name}</h4>
                               <p className="text-xs text-stone-500 mt-1">{item.quantity}x Kamar</p>
                             </div>
                             <span className="font-medium text-stone-900">Rp{roomSubtotal.toLocaleString("id-ID")}</span>
                           </div>
                           
                           {item.extraBeds > 0 && (
                             <div className="flex justify-between items-start mt-2 bg-stone-50 p-2.5 rounded-lg border border-stone-100">
                               <div>
                                 <span className="text-xs font-medium text-stone-700">{item.extraBeds}x Extrabed</span>
                               </div>
                               <span className="text-xs font-medium text-stone-900">Rp{extrabedSubtotal.toLocaleString("id-ID")}</span>
                             </div>
                           )}
                        </div>
                     );
                  })}
                  </div>

                  <div className="space-y-3 mb-6 pb-6 border-b border-t pt-6 border-stone-100 text-sm">
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
                  </div>

                  <div className="flex justify-between items-end mb-6">
                    <span className="text-stone-600 font-medium">Total estimasi</span>
                    <span className="font-serif text-2xl font-semibold text-stone-900">Rp{grandTotal.toLocaleString("id-ID")}</span>
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
                  <p className="text-stone-500 text-sm">Tambahkan kamar di sebelah kiri untuk melihat ringkasan pesanan Anda.</p>
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
