import { Sparkles, ChevronsRight, PenLine, Settings, Lightbulb, Languages, CheckCircle2, AlertTriangle, Copy, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AiSidebar() {
  return (
    <div className="w-80 shrink-0 space-y-6">
      <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <h3 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-purple-600" />
          AI Assistant
        </h3>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Write Assistance Card */}
      <Card className="p-4 bg-purple-50/50 border-purple-100">
        <div className="flex items-start gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-purple-900">Butuh bantuan menulis?</h4>
            <p className="text-xs text-purple-700/80 mt-1 leading-relaxed">
              Gunakan AI untuk membuat konten lebih menarik dan SEO-friendly.
            </p>
          </div>
        </div>
        <div className="space-y-2 mt-4">
          <ActionItem icon={PenLine} title="Generate Deskripsi" desc="Buat deskripsi destinasi baru" />
          <ActionItem icon={Settings} title="SEO Optimizer" desc="Optimalkan judul & meta SEO" />
          <ActionItem icon={Lightbulb} title="Ide Konten" desc="Dapatkan ide konten menarik" />
          <ActionItem icon={Languages} title="Terjemahkan" desc="Terjemahkan ke bahasa lain" />
        </div>
      </Card>

      {/* SEO Score Card */}
      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-4">Konten SEO Score</h4>
        <div className="flex items-center gap-4 mb-5">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] border-emerald-500 bg-emerald-50/50">
            <span className="text-sm font-bold text-emerald-700">
              78<span className="text-[10px] font-normal">/100</span>
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold">Bagus! Konten Anda sudah dioptimalkan.</p>
          </div>
        </div>
        <div className="space-y-2.5">
          <ChecklistItem text="Judul mengandung keyword" checked />
          <ChecklistItem text="Meta description ideal" checked />
          <ChecklistItem text="Struktur heading baik" checked />
          <ChecklistItem text="Gambar memiliki alt text" warning />
          <ChecklistItem text="Internal link cukup" checked />
        </div>
      </Card>

      {/* AI Tips Card */}
      <Card className="p-4 bg-purple-50/50 border-purple-100">
        <h4 className="text-sm font-semibold text-purple-900 mb-2">Tips AI</h4>
        <p className="text-xs text-purple-700/80 leading-relaxed mb-4">
          Tambahkan 2-3 destinasi lagi dengan keyword 'dekat UNNES' untuk meningkatkan peluang ranking lokal.
        </p>
        <Button size="sm" variant="outline" className="w-full gap-2 text-purple-700 hover:text-purple-800 hover:bg-purple-100/50 border-purple-200">
          Terapkan Saran
          <Sparkles className="h-3 w-3" />
        </Button>
      </Card>

      {/* AI History Card */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold">Riwayat AI</h4>
          <span className="text-[10px] text-muted-foreground hover:text-primary cursor-pointer">Lihat semua</span>
        </div>
        <div className="flex gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center">
            <History className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-stone-900 line-clamp-2 leading-snug">
              Generated deskripsi untuk Lawang Sewu
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">2 jam yang lalu</p>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Card>

      <div className="pb-10" />
    </div>
  );
}

function ActionItem({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-transparent bg-white p-2.5 shadow-sm transition-all hover:border-purple-200 hover:shadow-md cursor-pointer">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-50 text-purple-600 group-hover:bg-purple-100">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="text-xs font-semibold text-stone-900">{title}</p>
        <p className="text-[10px] text-muted-foreground line-clamp-1">{desc}</p>
      </div>
    </div>
  );
}

function ChecklistItem({ text, checked, warning }: { text: string; checked?: boolean; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {checked && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
        {warning && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
        {!checked && !warning && <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />}
        <span className="text-xs text-stone-600">{text}</span>
      </div>
      {checked && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
      {warning && <AlertTriangle className="h-3 w-3 text-amber-500" />}
    </div>
  );
}
