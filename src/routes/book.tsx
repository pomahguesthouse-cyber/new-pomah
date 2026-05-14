import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPublicSiteData, submitPublicBooking } from "@/lib/public.functions";
import { PublicNav, PublicFooter } from "./index";
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
      { name: "description", content: "Reserve direct at Pomah Guesthouse. No commissions, faster confirmation." },
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
    <div className="min-h-screen bg-background">
      <PublicNav />
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-12">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">Reservation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Book direct</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We confirm by WhatsApp within a few hours. No deposit required.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <form onSubmit={onSubmit} className="grid gap-6">
          <div className="grid gap-2">
            <Label>Room</Label>
            <Select value={form.roomTypeId} onValueChange={(v) => setForm({ ...form, roomTypeId: v })}>
              <SelectTrigger><SelectValue placeholder="Choose a room" /></SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} — ${Number(r.base_rate).toFixed(0)}/n
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Check-in"><Input type="date" required value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></Field>
            <Field label="Check-out"><Input type="date" required value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Adults"><Input type="number" min={1} max={8} value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })} /></Field>
            <Field label="Children"><Input type="number" min={0} max={8} value={form.children} onChange={(e) => setForm({ ...form, children: Number(e.target.value) })} /></Field>
          </div>

          <Field label="Full name"><Input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="WhatsApp / Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Special requests"><Textarea rows={3} value={form.specialRequests} onChange={(e) => setForm({ ...form, specialRequests: e.target.value })} /></Field>

          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "Sending…" : "Request booking"}
          </Button>
        </form>
      </main>
      <PublicFooter property={data?.property} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
