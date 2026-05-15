import { useState } from "react";
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

export const Route = createFileRoute("/book")({
  head: () => ({
    meta: [
      { title: "Book a stay — Pomah Guesthouse" },
      {
        name: "description",
        content: "Reserve direct at Pomah Guesthouse. No commissions, faster confirmation.",
      },
    ],
  }),
  component: BookPage,
});

function BookPage() {
  const navigate = useNavigate();
  const fn = useServerFn(getPublicSiteData);
  const submit = useServerFn(submitPublicBooking);
  const { data } = useQuery({ queryKey: ["public-site"], queryFn: () => fn() });
  const rooms = data?.roomTypes ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    roomTypeId: "",
    checkIn: today,
    checkOut: "",
    adults: 2,
    children: 0,
    specialRequests: "",
  });
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.roomTypeId) return toast.error("Please pick a room");
    setPending(true);
    try {
      const res = await submit({ data: form });
      toast.success("Booking received");
      navigate({ to: "/book/confirmation/$id", params: { id: res.id } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-stone-900">
      <PublicNav />

      {/* Header */}
      <header className="border-b border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-amber-700">
            <span className="h-px w-6 bg-amber-700" />
            Reservasi
          </span>
          <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight">Pesan langsung</h1>
          <p className="mt-3 text-sm text-stone-500">
            Konfirmasi via WhatsApp dalam beberapa jam. Tidak perlu deposit. Pembatalan gratis.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <form onSubmit={onSubmit} className="grid gap-6">
            <div className="grid gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
                Pilih Kamar
              </Label>
              <Select
                value={form.roomTypeId}
                onValueChange={(v) => setForm({ ...form, roomTypeId: v })}
              >
                <SelectTrigger className="border-stone-200">
                  <SelectValue placeholder="Pilih tipe kamar" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} — Rp {Number(r.base_rate).toLocaleString("id-ID")}/malam
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Check-in">
                <Input
                  type="date"
                  required
                  value={form.checkIn}
                  onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                />
              </Field>
              <Field label="Check-out">
                <Input
                  type="date"
                  required
                  value={form.checkOut}
                  onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Jumlah Tamu Dewasa">
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={form.adults}
                  onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })}
                />
              </Field>
              <Field label="Anak-anak">
                <Input
                  type="number"
                  min={0}
                  max={8}
                  value={form.children}
                  onChange={(e) => setForm({ ...form, children: Number(e.target.value) })}
                />
              </Field>
            </div>

            <div className="h-px bg-stone-100" />

            <Field label="Nama Lengkap">
              <Input
                required
                placeholder="Nama sesuai identitas"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Email">
                <Input
                  type="email"
                  required
                  placeholder="email@contoh.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
              <Field label="WhatsApp / Telepon">
                <Input
                  placeholder="+62 ..."
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Permintaan Khusus (opsional)">
              <Textarea
                rows={3}
                placeholder="Contoh: kamar lantai atas, extra pillow, late check-in..."
                value={form.specialRequests}
                onChange={(e) => setForm({ ...form, specialRequests: e.target.value })}
              />
            </Field>

            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="bg-amber-700 hover:bg-amber-800 text-white"
            >
              {pending ? "Mengirim…" : "Kirim Permintaan Reservasi"}
            </Button>
            <p className="text-center text-xs text-stone-400">
              Dengan mengirim formulir ini, Anda setuju dengan kebijakan pemesanan kami.
            </p>
          </form>
        </div>
      </main>

      <PublicFooter property={data?.property} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="font-mono text-[10px] uppercase tracking-widest text-stone-500">
        {label}
      </Label>
      {children}
    </div>
  );
}
