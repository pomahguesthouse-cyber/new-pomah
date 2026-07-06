import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy, Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicNav, PublicFooter } from "@/public/components/public-shell";

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
      { title: "Hubungkan asisten AI Anda ke Pomah Guesthouse" },
      {
        name: "description",
        content:
          "Panduan menghubungkan ChatGPT atau Claude ke Pomah Guesthouse melalui MCP untuk mengecek kamar dan tarif langsung dari asisten AI Anda.",
      },
      { property: "og:title", content: "Hubungkan asisten AI Anda ke Pomah Guesthouse" },
      {
        property: "og:description",
        content:
          "Panduan singkat memasang koneksi MCP Pomah Guesthouse di ChatGPT atau Claude.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConnectPage,
});

function ConnectPage() {
  const [mcpUrl, setMcpUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMcpUrl(new URL("/mcp", window.location.origin).toString());
  }, []);

  const copy = async () => {
    if (!mcpUrl) return;
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <PublicNav showBackHome />
      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 py-16">
          <div className="mb-10 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
              <Sparkles className="h-3.5 w-3.5" />
              Untuk pengguna asisten AI
            </div>
            <h1 className="mt-4 font-serif text-4xl font-semibold text-stone-900 md:text-5xl">
              Hubungkan asisten AI Anda
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-stone-600">
              Tempelkan alamat di bawah ke ChatGPT atau Claude untuk mengecek ketersediaan
              kamar dan tarif Pomah Guesthouse langsung dari percakapan Anda.
            </p>
          </div>

          {/* MCP URL card */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">
              Alamat koneksi (MCP)
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-lg bg-stone-100 px-4 py-3 font-mono text-sm text-stone-800">
                {mcpUrl || "…"}
              </code>
              <Button
                onClick={copy}
                disabled={!mcpUrl}
                className="bg-amber-700 hover:bg-amber-800"
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Tersalin
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Salin
                  </>
                )}
              </Button>
            </div>
            <p className="mt-4 text-sm text-stone-500">
              Setelah terhubung, Anda bisa bertanya seperti "kamar apa saja yang tersedia
              di Pomah tanggal 12–14 Juli untuk 2 tamu?" dan asisten akan menjawab dengan
              data terbaru.
            </p>
          </div>

          {/* ChatGPT */}
          <div className="mt-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Bot className="h-5 w-5" />
              </div>
              <h2 className="font-serif text-2xl font-semibold text-stone-900">
                ChatGPT
              </h2>
            </div>
            <ol className="space-y-3 text-stone-700">
              <Step n={1}>
                Buka{" "}
                <a
                  href="https://chatgpt.com/#settings/Connectors/Advanced"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 underline underline-offset-2 hover:text-amber-800"
                >
                  Pengaturan → Connectors → Advanced
                </a>
                , lalu aktifkan Developer mode (perhatikan peringatan risiko yang muncul).
              </Step>
              <Step n={2}>
                Di menu "+" pada kolom pesan, aktifkan Developer mode.
              </Step>
              <Step n={3}>
                Klik <em>Add sources</em>, lalu <em>Connect more</em>.
              </Step>
              <Step n={4}>
                Beri nama koneksi (misal "Pomah Guesthouse") dan tempelkan alamat MCP di atas.
              </Step>
              <Step n={5}>
                Mulai percakapan dan minta ChatGPT menggunakan Pomah untuk mengecek kamar.
              </Step>
            </ol>
          </div>

          {/* Claude */}
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                <Bot className="h-5 w-5" />
              </div>
              <h2 className="font-serif text-2xl font-semibold text-stone-900">
                Claude
              </h2>
            </div>
            <ol className="space-y-3 text-stone-700">
              <Step n={1}>
                Buka{" "}
                <a
                  href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 underline underline-offset-2 hover:text-amber-800"
                >
                  Claude Connectors → Add custom connector
                </a>
                .
              </Step>
              <Step n={2}>
                Beri nama koneksi (misal "Pomah Guesthouse") dan tempelkan alamat MCP di atas.
              </Step>
              <Step n={3}>
                Aktifkan koneksi dari kolom pesan, lalu minta Claude menggunakan Pomah.
              </Step>
            </ol>
          </div>

          <p className="mt-10 text-center text-sm text-stone-500">
            Butuh bantuan? Hubungi kami lewat WhatsApp yang tercantum di halaman utama.
          </p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white">
        {n}
      </span>
      <span className="pt-0.5 leading-relaxed">{children}</span>
    </li>
  );
}
