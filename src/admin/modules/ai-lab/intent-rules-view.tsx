import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Network,
  Plus,
  Trash2,
  Edit2,
  HelpCircle,
  Loader2,
  Save,
  RefreshCw,
  Sliders,
  Type,
  DownloadCloud,
  FlaskConical,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getIntentRules,
  saveIntentRule,
  seedDefaultIntentRules,
  testIntentClassification,
} from "./intent-rules.functions";
import {
  INTENT_CATEGORIES,
  getIntentCategoryLabel,
} from "@/ai/router/intent-categories";

const WEIGHT_MIN = 1;
const WEIGHT_MAX = 20;

/**
 * Validasi sebuah pola: terima bentuk polos (`\bharga\b`) atau ber-flag
 * (`/\bharga\b/i`). Mengembalikan pesan error bila regex tidak bisa di-compile.
 */
function validatePattern(raw: string): { ok: boolean; error?: string } {
  const p = raw.trim();
  if (!p) return { ok: false, error: "Pola kosong." };
  try {
    if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
      const last = p.lastIndexOf("/");
      // eslint-disable-next-line no-new
      new RegExp(p.slice(1, last), p.slice(last + 1) || "i");
    } else {
      // eslint-disable-next-line no-new
      new RegExp(p, "i");
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Regex tidak valid." };
  }
}

export function IntentRulesView() {
  const qc = useQueryClient();
  const getRulesFn = useServerFn(getIntentRules);
  const saveRuleFn = useServerFn(saveIntentRule);
  const seedFn = useServerFn(seedDefaultIntentRules);
  const testFn = useServerFn(testIntentClassification);

  // Fetch intent rules
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["ai-intent-rules"],
    queryFn: () => getRulesFn(),
  });

  const rules = data?.rules ?? [];

  // Edit / Add state
  const [editingRule, setEditingRule] = useState<{
    id?: string;
    category: string;
    patterns: string[];
    weight: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

  // Tester
  const [testText, setTestText] = useState("");
  const [testMode, setTestMode] = useState<"guest" | "admin" | "managerial">("guest");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { category: string; confidence: number; matchedTerms: string[] } | null
  >(null);

  const handleOpenEdit = (rule?: any) => {
    if (rule) {
      setEditingRule({
        id: rule.id,
        category: rule.category,
        patterns: [...rule.patterns],
        weight: rule.weight,
      });
    } else {
      setEditingRule({
        category: "booking_inquiry",
        patterns: [],
        weight: 5,
      });
    }
    setNewPattern("");
    setPatternError(null);
  };

  const handleCloseEdit = () => {
    setEditingRule(null);
    setPatternError(null);
  };

  const handleAddPattern = () => {
    if (!editingRule) return;
    const candidate = newPattern.trim();
    if (!candidate) return;

    const check = validatePattern(candidate);
    if (!check.ok) {
      setPatternError(check.error ?? "Regex tidak valid.");
      return;
    }
    if (editingRule.patterns.includes(candidate)) {
      setPatternError("Pola ini sudah ada.");
      return;
    }

    setEditingRule({
      ...editingRule,
      patterns: [...editingRule.patterns, candidate],
    });
    setNewPattern("");
    setPatternError(null);
  };

  const handleRemovePattern = (index: number) => {
    if (editingRule) {
      const updated = [...editingRule.patterns];
      updated.splice(index, 1);
      setEditingRule({
        ...editingRule,
        patterns: updated,
      });
    }
  };

  const handleSave = async () => {
    if (!editingRule) return;
    if (editingRule.patterns.length === 0) {
      toast.error("Aturan harus memiliki minimal 1 pola kata kunci.");
      return;
    }

    setSaving(true);
    try {
      await saveRuleFn({
        data: {
          id: editingRule.id,
          category: editingRule.category,
          patterns: editingRule.patterns,
          weight: editingRule.weight,
        },
      });
      toast.success(editingRule.id ? "Aturan berhasil diperbarui" : "Aturan berhasil dibuat");
      qc.invalidateQueries({ queryKey: ["ai-intent-rules"] });
      handleCloseEdit();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await saveRuleFn({
        data: {
          id: deleteTarget.id,
          category: "",
          patterns: [],
          weight: 0,
          delete: true,
        },
      });
      toast.success("Aturan berhasil dihapus");
      qc.invalidateQueries({ queryKey: ["ai-intent-rules"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await seedFn();
      if (res.inserted > 0) {
        toast.success(`${res.inserted} aturan default diimpor (${res.skipped} dilewati karena sudah ada).`);
      } else {
        toast.info("Semua kategori default sudah ada — tidak ada yang ditambahkan.");
      }
      qc.invalidateQueries({ queryKey: ["ai-intent-rules"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSeeding(false);
    }
  };

  const handleTest = async () => {
    const text = testText.trim();
    if (!text) return;
    setTesting(true);
    try {
      const res = await testFn({ data: { text, mode: testMode } });
      setTestResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Aturan Klasifikasi Intent</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Atur kata kunci pencocokan Regex untuk memetakan pesan tamu ke kategori intent yang sesuai.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              disabled={seeding}
              onClick={handleSeedDefaults}
            >
              {seeding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <DownloadCloud className="h-3.5 w-3.5" />
              )}
              Impor Default
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={() => {
                refetch();
                toast.success("Data berhasil disinkronkan");
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Sinkronisasi
            </Button>
            <Button
              size="sm"
              className="gap-1.5 h-9 bg-teal-700 hover:bg-teal-800 text-white"
              onClick={() => handleOpenEdit()}
            >
              <Plus className="h-4 w-4" /> Tambah Aturan
            </Button>
          </div>
        </div>

        {/* Merge-behaviour notice */}
        <Card className="flex gap-3 border-amber-300 bg-amber-50/60 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-xs text-amber-900 leading-relaxed space-y-1">
            <p className="font-semibold">Cara kerja aturan ini</p>
            <p>
              Aturan di sini <strong>digabung per-kategori</strong> dengan aturan bawaan sistem. Kategori yang Anda
              edit di sini akan menimpa bawaannya; kategori yang tidak Anda sentuh tetap memakai aturan bawaan. Jadi
              menambah satu aturan tidak lagi mematikan kategori lain. Gunakan <strong>Impor Default</strong> bila ingin
              melihat & menyunting seluruh aturan bawaan.
            </p>
          </div>
        </Card>

        {/* Tester */}
        <Card className="space-y-3 border-teal-200 bg-white p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-teal-700" />
            <h3 className="font-semibold text-sm">Uji Klasifikasi</h3>
            <span className="text-[11px] text-muted-foreground">(berbasis aturan, tanpa fallback AI)</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder='Ketik contoh pesan tamu, mis. "ada kamar kosong besok?"'
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleTest();
                }
              }}
              className="h-9 text-sm"
            />
            <select
              className="h-9 rounded-md border border-stone-300 bg-white px-2 text-sm focus:border-teal-500 focus:outline-none"
              value={testMode}
              onChange={(e) => setTestMode(e.target.value as "guest" | "admin" | "managerial")}
              aria-label="Mode penguji"
            >
              <option value="guest">Mode Tamu</option>
              <option value="admin">Mode Admin</option>
              <option value="managerial">Mode Manajer</option>
            </select>
            <Button
              size="sm"
              className="h-9 shrink-0 bg-teal-700 hover:bg-teal-800 text-white"
              disabled={testing || !testText.trim()}
              onClick={handleTest}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Uji"}
            </Button>
          </div>
          {testResult && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Hasil:</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 font-semibold text-teal-800 border border-teal-200">
                <Network className="h-3 w-3" />
                {getIntentCategoryLabel(testResult.category)}
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-stone-600 border border-stone-200">
                confidence {(testResult.confidence * 100).toFixed(0)}%
              </span>
              {testResult.matchedTerms.length > 0 && (
                <span className="text-muted-foreground">
                  cocok: <span className="font-mono text-stone-700">{testResult.matchedTerms.join(", ")}</span>
                </span>
              )}
            </div>
          )}
        </Card>

        {/* Explain Box */}
        <Card className="space-y-3 border-dashed border-teal-300 bg-teal-50/50 p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-teal-700" />
            <h3 className="font-semibold text-teal-900 text-sm">Petunjuk Format Pola (Regular Expression)</h3>
          </div>
          <div className="text-xs text-teal-800 space-y-2 leading-relaxed">
            <p>
              Pencocokan menggunakan mesin pencocokan regex case-insensitive (huruf besar/kecil tidak berpengaruh).
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Gunakan batasan kata <code>\b</code> di awal dan akhir kata kunci untuk mencocokkan kata utuh. Contoh: <code>\bharga\b</code> hanya mencocokkan "harga", bukan "dihargai".
              </li>
              <li>
                Gunakan karakter pipa <code>|</code> untuk mencocokkan salah satu kata kunci pilihan. Contoh: <code>\b(komplain|complain|kecewa)\b</code>.
              </li>
              <li>
                Jika Anda ingin mencocokkan dua kata dalam satu kalimat secara fleksibel, gunakan <code>.*</code> di antara kata tersebut. Contoh: <code>\bac\b.*\b(rusak|mati)\b</code> mencocokkan "ac saya rusak" atau "ac di kamar mati".
              </li>
              <li>
                <strong>Bobot (Weight):</strong> Jika ada lebih dari satu kategori intent yang cocok dengan pesan tamu, kategori dengan total bobot tertinggi yang akan dipilih.
              </li>
            </ul>
          </div>
        </Card>

        {/* Rules Table/Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-teal-700" />
          </div>
        ) : rules.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground border-dashed">
            <Network className="h-10 w-10 text-muted-foreground/60 mb-2" />
            <p className="font-medium text-sm">Belum ada aturan intent terdefinisi.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sistem saat ini menggunakan aturan bawaan. Klik "Impor Default" untuk menyuntingnya.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {rules.map((rule: any) => (
              <Card key={rule.id} className="flex flex-col justify-between gap-4 p-4 transition duration-200 hover:shadow-md sm:p-5 md:flex-row md:items-center">
                <div className="space-y-2.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800 border border-teal-200">
                      <Network className="h-3 w-3" />
                      {getIntentCategoryLabel(rule.category)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 border border-stone-200">
                      <Sliders className="h-2.5 w-2.5" />
                      Bobot: {rule.weight}
                    </span>
                    {rule.created_at && (
                      <span className="text-[10px] text-muted-foreground">
                        dibuat {new Date(rule.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Pola Regex ({rule.patterns.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {rule.patterns.map((pattern: string, idx: number) => (
                        <code key={idx} className="px-2 py-1 rounded bg-stone-100 border border-stone-200 text-xs font-mono text-stone-800 break-all select-all">
                          {pattern}
                        </code>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 self-end md:self-center border-t md:border-t-0 pt-3 md:pt-0 border-stone-100">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1 hover:bg-stone-100"
                    onClick={() => handleOpenEdit(rule)}
                  >
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    onClick={() => setDeleteTarget({ id: rule.id, label: getIntentCategoryLabel(rule.category) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus aturan intent?</AlertDialogTitle>
              <AlertDialogDescription>
                Aturan untuk kategori "{deleteTarget?.label}" akan dihapus. Bila ini satu-satunya aturan kategori
                tersebut, sistem otomatis kembali memakai aturan bawaan untuk kategori itu.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700 text-white"
                onClick={handleConfirmDelete}
              >
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit / Add Dialog */}
        <Dialog open={!!editingRule} onOpenChange={(open) => !open && handleCloseEdit()}>
          <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col sm:max-w-[550px]">
            <DialogHeader>
              <DialogTitle>{editingRule?.id ? "Edit Aturan Intent" : "Tambah Aturan Intent Baru"}</DialogTitle>
              <DialogDescription>
                Konfigurasikan kategori, bobot prioritas, dan pola kata kunci pencocokan untuk intent ini.
              </DialogDescription>
            </DialogHeader>

            {editingRule && (
              <div className="space-y-4 py-3 flex-1 overflow-y-auto px-1">
                {/* Category Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-stone-700">Kategori Intent</label>
                  <select
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    value={editingRule.category}
                    onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value })}
                  >
                    {INTENT_CATEGORIES.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Weight selection */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-stone-700">Bobot Prioritas</label>
                    <span className="text-xs font-mono font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-100">
                      {editingRule.weight}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={WEIGHT_MIN}
                    max={WEIGHT_MAX}
                    className="w-full accent-teal-700 h-1.5 bg-stone-200 rounded-lg cursor-pointer"
                    value={editingRule.weight}
                    onChange={(e) => setEditingRule({ ...editingRule, weight: parseInt(e.target.value) || 5 })}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Semakin tinggi bobot, semakin diprioritaskan jika ada kata kunci yang tumpang tindih dengan intent lain.
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Referensi tangga bobot bawaan: <strong>perintah admin 20</strong> · komplain 10 · kerusakan/layanan 8 ·
                    finance 7 · harga/ketersediaan 6 · niat umum 5 · sapaan 3.
                  </p>
                </div>

                {/* Patterns list */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-stone-700 block">Daftar Pola Regex</label>

                  {editingRule.patterns.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3 border rounded bg-stone-50 border-dashed text-center">
                      Belum ada pola ditambahkan. Gunakan kolom di bawah untuk menambah.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto border border-stone-200 rounded-md p-2 bg-stone-50/50">
                      {editingRule.patterns.map((pattern, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded border border-stone-200 text-xs font-mono text-stone-800">
                          <span className="truncate flex-1">{pattern}</span>
                          <button
                            type="button"
                            className="text-stone-400 hover:text-rose-600 transition shrink-0 p-0.5 rounded hover:bg-stone-50"
                            onClick={() => handleRemovePattern(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Pattern Field */}
                  <div className="flex gap-2 pt-1.5">
                    <Input
                      placeholder="Contoh: \b(kecewa|buruk)\b"
                      value={newPattern}
                      onChange={(e) => {
                        setNewPattern(e.target.value);
                        if (patternError) setPatternError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddPattern();
                        }
                      }}
                      className={`h-9 font-mono text-xs ${patternError ? "border-rose-400 focus-visible:ring-rose-400" : ""}`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 text-teal-800 hover:bg-teal-50"
                      onClick={handleAddPattern}
                    >
                      Tambah Pola
                    </Button>
                  </div>
                  {patternError && (
                    <p className="text-[10px] text-rose-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {patternError}
                    </p>
                  )}
                  <div className="flex gap-1.5 justify-end">
                    <button
                      type="button"
                      className="text-[10px] text-teal-800 hover:underline flex items-center gap-0.5 font-medium"
                      onClick={() => setNewPattern((prev) => (prev ? prev : "\\b(kata1|kata2)\\b"))}
                    >
                      <Type className="h-3 w-3" /> Template Pencocokan Kata
                    </button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="mt-4 pt-3 border-t border-stone-100 shrink-0">
              <Button variant="outline" size="sm" onClick={handleCloseEdit} disabled={saving}>
                Batal
              </Button>
              <Button
                className="bg-teal-700 hover:bg-teal-800 text-white"
                size="sm"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Menyimpan...
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1.5" /> Simpan Aturan
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
