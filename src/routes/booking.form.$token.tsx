import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Halaman publik untuk form booking sekali pakai. Tamu membuka URL ini dari
 * pesan WhatsApp chatbot, mengisi data, dan submit. Setelah sukses chatbot
 * akan mengirim ringkasan booking + permintaan konfirmasi "Ya/Lanjut" via WA.
 */

interface RoomCatalogItem {
  id: string;
  name: string;
  base_rate: number;
  capacity: number;
  extrabed_capacity: number | null;
  extrabed_rate: number | null;
  hero_image_url: string | null;
}

interface FormData {
  status: "pending" | "submitted" | "expired";
  expiresAt: string;
  submittedAt: string | null;
  prefill: {
    roomTypeId?: string | null;
    roomTypeName?: string | null;
    checkIn?: string | null;
    checkOut?: string | null;
    guestCount?: number | null;
    rooms?: number | null;
  };
  rooms: RoomCatalogItem[];
  phoneMasked: string;
}

function formatIDR(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function countNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const diff = (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

function BookingFormPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FormData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [rooms, setRooms] = useState(1);
  const [guestCount, setGuestCount] = useState(2);
  const [extrabed, setExtrabed] = useState(0);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/booking-form/${token}`);
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setLoadError(body?.error ?? "Gagal memuat form");
          setLoading(false);
          return;
        }
        const d = body as FormData;
        setData(d);
        if (d.status === "submitted") setSubmitted(true);
        // Prefill
        setCheckIn(d.prefill.checkIn ?? "");
        setCheckOut(d.prefill.checkOut ?? "");
        setRoomTypeId(d.prefill.roomTypeId ?? "");
        if (d.prefill.guestCount) setGuestCount(d.prefill.guestCount);
        if (d.prefill.rooms) setRooms(d.prefill.rooms);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const selectedRoom = useMemo<RoomCatalogItem | null>(
    () => data?.rooms.find((r) => r.id === roomTypeId) ?? null,
    [data, roomTypeId],
  );

  const nights = useMemo(() => countNights(checkIn, checkOut), [checkIn, checkOut]);
  const maxExtrabed = (selectedRoom?.extrabed_capacity ?? 0) * rooms;
  const extrabedRate = Number(selectedRoom?.extrabed_rate ?? 0);
  const roomSubtotal = (selectedRoom ? Number(selectedRoom.base_rate) : 0) * rooms * nights;
  const extrabedSubtotal = extrabedRate * extrabed * nights;
  const total = roomSubtotal + extrabedSubtotal;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/booking-form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email: email || null,
          checkIn,
          checkOut,
          roomTypeId,
          rooms,
          guestCount,
          extrabed,
          notes: notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body?.error ?? "Gagal mengirim form");
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Memuat form…</p>
      </main>
    );
  }

  if (loadError || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Form tidak tersedia</CardTitle>
            <CardDescription>{loadError ?? "Token tidak valid"}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Silakan kembali ke chat WhatsApp dan minta link baru kepada chatbot.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>✅ Terima kasih!</CardTitle>
            <CardDescription>
              Data booking Anda sudah kami terima.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Chatbot akan mengirim ringkasan booking ke WhatsApp Anda dalam beberapa detik.
              Mohon balas <strong>"Ya"</strong> untuk konfirmasi pemesanan dan menerima invoice.
            </p>
            <p className="text-muted-foreground">
              Anda dapat menutup halaman ini.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (data.status === "expired") {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Form sudah kedaluwarsa</CardTitle>
            <CardDescription>
              Link form berlaku 30 menit. Silakan kembali ke chat WhatsApp untuk meminta link baru.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 py-6 px-4">
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Formulir Booking</CardTitle>
            <CardDescription>
              Lengkapi data berikut untuk mempercepat proses pemesanan. Nomor WA: <span className="font-mono">{data.phoneMasked}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="ci">Check-in</Label>
                  <Input id="ci" type="date" required value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="co">Check-out</Label>
                  <Input id="co" type="date" required value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Tipe kamar</Label>
                <Select value={roomTypeId} onValueChange={setRoomTypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih kamar" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.rooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} — {formatIDR(Number(r.base_rate))}/malam
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="rm">Kamar</Label>
                  <Input id="rm" type="number" min={1} max={10} value={rooms} onChange={(e) => setRooms(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gc">Tamu</Label>
                  <Input id="gc" type="number" min={1} max={20} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value) || 1)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="eb">Extra bed</Label>
                  <Input
                    id="eb"
                    type="number"
                    min={0}
                    max={maxExtrabed || 0}
                    value={extrabed}
                    onChange={(e) => setExtrabed(Math.min(Number(e.target.value) || 0, maxExtrabed))}
                    disabled={maxExtrabed === 0}
                  />
                </div>
              </div>
              {selectedRoom && extrabedRate > 0 && (
                <p className="text-xs text-muted-foreground">
                  Maks {maxExtrabed} extra bed · {formatIDR(extrabedRate)}/malam/bed
                </p>
              )}

              <div className="space-y-1">
                <Label htmlFor="nm">Nama lengkap</Label>
                <Input id="nm" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nama untuk reservasi" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="em">Email (opsional)</Label>
                <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="kosongkan jika tidak ingin diisi" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="nt">Catatan khusus</Label>
                <Textarea id="nt" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mis. permintaan jam check-in, alergi, dll." />
              </div>

              {selectedRoom && nights > 0 && (
                <div className="rounded-md border bg-background p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span>{rooms} kamar × {nights} malam</span><span>{formatIDR(roomSubtotal)}</span></div>
                  {extrabed > 0 && (
                    <div className="flex justify-between"><span>{extrabed} extra bed × {nights} malam</span><span>{formatIDR(extrabedSubtotal)}</span></div>
                  )}
                  <div className="flex justify-between font-semibold pt-1 border-t"><span>Estimasi total</span><span>{formatIDR(total)}</span></div>
                  <p className="text-xs text-muted-foreground pt-1">
                    Total final akan dikonfirmasi chatbot setelah submit (termasuk harga dinamis bila berlaku).
                  </p>
                </div>
              )}

              {submitError && <p className="text-sm text-destructive">{submitError}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Mengirim…" : "Kirim ke chatbot"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/booking/form/$token")({
  component: BookingFormPage,
});
