import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Building2,
  CheckCircle2,
  Database,
  Home,
  Hotel,
  MessageCircle,
  Play,
  PlugZap,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WandSparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Baboo AI Agent | Bibi, Asisten AI untuk Bisnis" },
      {
        name: "description",
        content:
          "Baboo AI Agent adalah platform asisten AI untuk membantu bisnis menjawab chat, membaca data, menjalankan otomasi, dan membuat laporan secara otomatis.",
      },
      { property: "og:title", content: "Baboo AI Agent | Bibi, Asisten AI untuk Bisnis" },
      {
        property: "og:description",
        content:
          "Bibi dari Baboo membantu membersihkan pekerjaan digital yang berulang: chat customer, booking, laporan, database, dan otomasi bisnis.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Baboo AI Agent" },
      {
        name: "twitter:description",
        content: "AI helper pintar untuk kerjaan digital yang berulang.",
      },
    ],
  }),
  component: BabooLandingPage,
});

type Feature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const agents: Feature[] = [
  {
    icon: MessageCircle,
    title: "Customer Service Agent",
    description: "Menjawab chat pelanggan 24 jam dengan gaya bahasa brand Anda.",
  },
  {
    icon: Hotel,
    title: "Booking Agent",
    description: "Cek ketersediaan, buat booking, dan kirim konfirmasi otomatis.",
  },
  {
    icon: Database,
    title: "Data Agent",
    description: "Membaca database, Google Sheet, dan membuat rekap siap pakai.",
  },
  {
    icon: PlugZap,
    title: "Smart Home Agent",
    description: "Menghubungkan AI dengan perangkat rumah, sensor, CCTV, dan IoT.",
  },
  {
    icon: BrainCircuit,
    title: "Manager Agent",
    description: "Memberi ringkasan, notifikasi penting, dan insight operasional.",
  },
  {
    icon: WandSparkles,
    title: "Marketing Agent",
    description: "Membantu ide konten, campaign, caption, dan follow-up prospek.",
  },
];

const features: Feature[] = [
  {
    icon: Workflow,
    title: "Workflow Automation",
    description: "Agent dapat menjalankan alur kerja otomatis, bukan cuma menjawab teks.",
  },
  {
    icon: ShieldCheck,
    title: "Human Handoff",
    description: "Saat perlu keputusan manusia, Bibi bisa oper ke admin atau manager.",
  },
  {
    icon: Database,
    title: "Knowledge Base & RAG",
    description: "Jawaban lebih akurat karena membaca SOP, FAQ, dokumen, dan data bisnis.",
  },
  {
    icon: Bot,
    title: "Multi Agent",
    description: "Pisahkan peran agent: front office, sales, finance, teknisi, dan manager.",
  },
];

const useCases = [
  {
    icon: Hotel,
    title: "Guesthouse & Hotel",
    text: "Booking, harga, komplain, check-in, dan reminder pembayaran.",
  },
  {
    icon: ShoppingBag,
    title: "UMKM & Toko Online",
    text: "Jawab stok, invoice, katalog, follow-up, dan laporan order.",
  },
  {
    icon: Wrench,
    title: "Kontraktor & Proyek",
    text: "Laporan harian, progres pekerjaan, dokumentasi, dan notifikasi tim.",
  },
  {
    icon: Home,
    title: "Smart Home",
    text: "Kontrol lampu, pompa, CCTV, sensor, dan otomasi rumah.",
  },
  {
    icon: Building2,
    title: "Operasional Bisnis",
    text: "Admin digital untuk data, approval, rekap, dan pengingat kerja.",
  },
];

const steps = [
  "Chat masuk",
  "Bibi memahami konteks",
  "Ambil data & SOP",
  "Jalankan aksi",
  "Kirim hasil",
];

function BabooLandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#06131f] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-70">
        <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.08)_1px,transparent_0)] [background-size:32px_32px]" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#06131f]/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a href="#hero" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-300 text-[#06131f] shadow-lg shadow-cyan-300/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-bold leading-none tracking-tight">Baboo</p>
              <p className="text-xs text-cyan-100/70">AI Agent</p>
            </div>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
            <a className="transition hover:text-cyan-200" href="#agent">
              Agent
            </a>
            <a className="transition hover:text-cyan-200" href="#cara-kerja">
              Cara Kerja
            </a>
            <a className="transition hover:text-cyan-200" href="#fitur">
              Fitur
            </a>
            <a className="transition hover:text-cyan-200" href="#use-case">
              Use Case
            </a>
          </nav>

          <a
            href="#kontak"
            className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-5 py-2 text-sm font-semibold text-cyan-100 shadow-lg shadow-cyan-500/10 transition hover:bg-cyan-300 hover:text-[#06131f]"
          >
            Coba Baboo
          </a>
        </div>
      </header>

      <section
        id="hero"
        className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-24"
      >
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-white/5 px-4 py-2 text-sm text-cyan-100 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.9)]" />
            Kenalkan Bibi, maskot AI helper Baboo
          </div>

          <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            AI Agent yang bantu
            <span className="block bg-gradient-to-r from-cyan-200 via-emerald-200 to-white bg-clip-text text-transparent">
              beresin kerjaan digital.
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Baboo membantu bisnis menjawab chat, membaca data, menjalankan otomasi, membuat laporan, dan menghubungkan sistem. Bukan cuma chatbot. Ini asisten digital yang bisa kerja.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="#kontak"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-7 py-4 font-bold text-[#06131f] shadow-2xl shadow-cyan-300/20 transition hover:-translate-y-0.5 hover:bg-cyan-200"
            >
              Bangun Agent Pertama
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
            </a>
            <a
              href="#cara-kerja"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-7 py-4 font-bold text-white backdrop-blur transition hover:bg-white/10"
            >
              <Play className="h-5 w-5" />
              Lihat Cara Kerja
            </a>
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3 text-center">
            {[
              ["24/7", "Siap bantu"],
              ["Multi", "AI Agent"],
              ["API", "Ready"],
            ].map(([value, label]) => (
              <div key={value} className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
                <p className="text-2xl font-black text-cyan-200">{value}</p>
                <p className="mt-1 text-xs text-white/55">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute inset-0 rounded-[3rem] bg-cyan-300/20 blur-3xl" />
          <div className="relative rounded-[2.5rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-xl">
            <div className="overflow-hidden rounded-[2rem] border border-cyan-200/10 bg-[#071927] p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/50">Live Assistant</p>
                  <p className="font-bold">Bibi sedang membersihkan antrean kerja</p>
                </div>
                <div className="rounded-full bg-emerald-300/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                  Online
                </div>
              </div>

              <BibiMascot />

              <div className="mt-5 space-y-3">
                {[
                  "12 chat pelanggan dijawab",
                  "3 booking perlu konfirmasi",
                  "Laporan harian siap dikirim",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200"
                  >
                    <CheckCircle2 className="h-5 w-5 text-cyan-200" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="agent" className="relative z-10 mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <SectionHeading
          eyebrow="AI Agent"
          title="Satu platform, banyak Bibi dengan tugas berbeda."
          description="Setiap agent punya peran, data, SOP, dan gaya bicara sendiri. Jadi bisnis tidak perlu punya satu bot serba bingung."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <FeatureCard key={agent.title} {...agent} />
          ))}
        </div>
      </section>

      <section id="cara-kerja" className="relative z-10 mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="rounded-[2.5rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl lg:p-10">
          <SectionHeading
            eyebrow="Cara Kerja"
            title="Dari chat menjadi aksi nyata."
            description="Baboo memahami permintaan, mengambil konteks dari data, lalu menjalankan tugas melalui tool, API, atau workflow."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-5">
            {steps.map((step, index) => (
              <div key={step} className="relative rounded-3xl border border-white/10 bg-[#071927] p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-300 text-sm font-black text-[#06131f]">
                  {index + 1}
                </div>
                <p className="font-bold">{step}</p>
                {index < steps.length - 1 ? (
                  <ArrowRight className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-cyan-200 md:block" />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="fitur" className="relative z-10 mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <SectionHeading
          eyebrow="Fitur"
          title="Dibuat untuk otomasi yang benar-benar kepakai."
          description="Mulai dari WhatsApp, Telegram, dashboard, knowledge base, sampai integrasi database dan API."
        />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} compact />
          ))}
        </div>
      </section>

      <section id="use-case" className="relative z-10 mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <SectionHeading
          eyebrow="Use Case"
          title="Cocok untuk bisnis lokal yang mau naik kelas."
          description="Baboo bisa mulai dari satu workflow sederhana, lalu berkembang jadi sistem operasional AI penuh."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-5">
          {useCases.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.title}
                className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur transition hover:-translate-y-1 hover:bg-white/[0.07]"
              >
                <Icon className="h-7 w-7 text-cyan-200" />
                <h3 className="mt-5 font-bold">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="kontak" className="relative z-10 mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="overflow-hidden rounded-[2.5rem] border border-cyan-200/20 bg-gradient-to-br from-cyan-300 to-emerald-200 p-8 text-[#06131f] shadow-2xl shadow-cyan-300/20 lg:p-12">
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="font-bold uppercase tracking-[0.3em] text-[#06131f]/60">Mulai Sekarang</p>
              <h2 className="mt-4 max-w-3xl text-4xl font-black tracking-tight lg:text-5xl">
                Bangun AI Agent pertama untuk bisnis Anda.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-[#06131f]/75">
                Mulai dari Bibi yang menjawab chat, lalu sambungkan ke database, WhatsApp, dashboard, dan otomasi operasional.
              </p>
            </div>
            <a
              href="mailto:hello@baboo.id"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#06131f] px-8 py-4 font-black text-white transition hover:-translate-y-0.5 hover:bg-[#0a2236]"
            >
              Konsultasi Gratis
              <ArrowRight className="h-5 w-5" />
            </a>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10 px-5 py-10 text-center text-sm text-white/50">
        <p>Baboo AI Agent — Bibi siap bantu beresin kerjaan digital.</p>
      </footer>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm font-bold uppercase tracking-[0.3em] text-cyan-200">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">{title}</h2>
      <p className="mt-5 text-base leading-8 text-slate-400">{description}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  compact = false,
}: Feature & { compact?: boolean }) {
  return (
    <article className="group rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur transition hover:-translate-y-1 hover:border-cyan-200/30 hover:bg-white/[0.07]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-300/10 text-cyan-200 ring-1 ring-cyan-200/20 transition group-hover:bg-cyan-300 group-hover:text-[#06131f]">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-lg font-bold">{title}</h3>
      <p className={`mt-3 leading-7 text-slate-400 ${compact ? "text-sm" : "text-base"}`}>{description}</p>
    </article>
  );
}

function BibiMascot() {
  return (
    <div className="relative mx-auto flex h-[360px] max-w-sm items-end justify-center rounded-[2rem] bg-gradient-to-b from-cyan-300/10 to-white/[0.03]">
      <div className="absolute left-8 top-8 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-cyan-100 backdrop-blur">
        “Bibi siap bantu.”
      </div>

      <div className="relative mb-6 h-64 w-52">
        <div className="absolute left-1/2 top-0 h-20 w-20 -translate-x-1/2 rounded-full bg-cyan-100 shadow-[0_0_40px_rgba(103,232,249,0.35)]">
          <div className="absolute left-5 top-9 h-2 w-2 rounded-full bg-[#06131f]" />
          <div className="absolute right-5 top-9 h-2 w-2 rounded-full bg-[#06131f]" />
          <div className="absolute left-1/2 top-12 h-2 w-7 -translate-x-1/2 rounded-b-full border-b-2 border-[#06131f]" />
        </div>
        <div className="absolute left-1/2 top-[72px] h-28 w-28 -translate-x-1/2 rounded-[2.2rem] bg-cyan-300 shadow-xl shadow-cyan-300/20" />
        <div className="absolute left-[50px] top-[95px] h-24 w-7 -rotate-12 rounded-full bg-cyan-100" />
        <div className="absolute right-[48px] top-[92px] h-28 w-7 rotate-12 rounded-full bg-cyan-100" />
        <div className="absolute bottom-0 left-[68px] h-20 w-8 rounded-full bg-cyan-100" />
        <div className="absolute bottom-0 right-[68px] h-20 w-8 rounded-full bg-cyan-100" />

        <div className="absolute right-0 top-[70px] h-28 w-10 rotate-[28deg] rounded-full bg-emerald-200/90 shadow-[0_0_22px_rgba(110,231,183,0.35)]" />
        <div className="absolute right-[-18px] top-[38px] h-20 w-20 rounded-full border border-emerald-100/40 bg-emerald-300/20 blur-[1px]" />
        <div className="absolute right-[-8px] top-[44px] grid h-16 w-16 grid-cols-3 gap-1 rounded-full p-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="rounded-full bg-emerald-100/80 shadow-[0_0_12px_rgba(209,250,229,0.7)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
