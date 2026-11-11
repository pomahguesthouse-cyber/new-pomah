/**
 * Tampilan "Daftar Manager" (Settings → Manager). Komponen presentasional
 * murni — data & mutasi disuplai lewat props oleh ManagerTab, supaya bisa
 * dirender dengan data mock untuk preview/test tanpa menyentuh produksi.
 */
import { useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Bell,
  BellOff,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  MANAGER_ROLES,
  MANAGER_ROLE_INFO,
  duplicateManagerMessage,
  findDuplicateManager,
  formatManagerPhone,
  isManagerRoleValue,
  normalizeManagerPhone,
  validateAddManagerInput,
  validateManagerPhone,
  type AddManagerInput,
  type ManagerRoleValue,
} from "./property-managers.shared";

export type ManagerRow = {
  id: string;
  name: string;
  phone: string;
  role: string;
  is_active?: boolean | null;
  is_muted?: boolean | null;
};

export type ManagerSettingsViewProps = {
  managers: ManagerRow[] | undefined;
  isLoading?: boolean;
  /** Harus resolve saat sukses dan reject (Error berpesan Indonesia) saat gagal. */
  onAdd: (input: AddManagerInput) => Promise<unknown>;
  onChangeRole: (id: string, role: ManagerRoleValue) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onToggleMute: (id: string, isMuted: boolean) => void;
  onDelete: (id: string) => Promise<unknown> | void;
  /** id baris yang sedang diproses (switch/select/hapus dinonaktifkan). */
  busyIds?: ReadonlySet<string>;
  addPending?: boolean;
  /** Pesan error terakhir dari server untuk form tambah. */
  addError?: string | null;
};

function RoleBadge({ role }: { role: string }) {
  const info = isManagerRoleValue(role) ? MANAGER_ROLE_INFO[role] : null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        info?.badge ?? "bg-gray-100 text-gray-700 ring-gray-200",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", info?.dot ?? "bg-gray-400")} />
      {info?.label ?? role}
    </span>
  );
}

function DeleteButton({
  name,
  busy,
  onClick,
  className,
}: {
  name: string;
  busy: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          className={cn(
            "h-9 w-9 shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600",
            className,
          )}
          aria-label={`Hapus ${name}`}
          onClick={onClick}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Hapus manager</TooltipContent>
    </Tooltip>
  );
}

function RoleSelectItems({ compact = false }: { compact?: boolean }) {
  return (
    <>
      {MANAGER_ROLES.map((r) => (
        <SelectItem key={r} value={r} className={compact ? "text-xs" : undefined}>
          <span className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", MANAGER_ROLE_INFO[r].dot)} />
            {MANAGER_ROLE_INFO[r].label}
          </span>
        </SelectItem>
      ))}
    </>
  );
}

export function ManagerSettingsView({
  managers,
  isLoading,
  onAdd,
  onChangeRole,
  onToggleActive,
  onToggleMute,
  onDelete,
  busyIds,
  addPending = false,
  addError,
}: ManagerSettingsViewProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ManagerRoleValue>("booking_manager");
  const [touched, setTouched] = useState<{ phone?: boolean; name?: boolean }>({});
  const [submitted, setSubmitted] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ManagerRow | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const list = managers ?? [];
  const validation = useMemo(
    () => validateAddManagerInput({ phone, name, role }),
    [phone, name, role],
  );
  const duplicate = useMemo(
    () => (validateManagerPhone(phone) ? null : findDuplicateManager(list, phone)),
    [list, phone],
  );
  const fieldErrors = validation.ok ? {} : validation.errors;
  const phoneError =
    (touched.phone || submitted) &&
    (fieldErrors.phone ?? (duplicate ? duplicateManagerMessage(duplicate) : undefined));
  const nameError = (touched.name || submitted) && fieldErrors.name;
  const phonePreview = !validateManagerPhone(phone) ? formatManagerPhone(phone) : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!validation.ok || duplicate || addPending) return;
    try {
      await onAdd(validation.value);
      setPhone("");
      setName("");
      setRole("booking_manager");
      setTouched({});
      setSubmitted(false);
    } catch {
      // Pesan error ditampilkan oleh pemanggil (addError + toast).
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="@container max-w-5xl space-y-4">
        <Card className="overflow-hidden">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-teal-600" />
                <h2 className="text-lg font-semibold">Daftar Manager</h2>
                {!isLoading && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {list.length}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Nomor WhatsApp di sini dilayani sebagai pengelola. Nomor lain otomatis dianggap
                tamu.
              </p>
            </div>
          </div>

          {/* Form tambah */}
          <form onSubmit={handleSubmit} noValidate className="space-y-3 bg-muted/30 p-4 sm:p-6">
            <h3 className="text-sm font-semibold">Tambah manager</h3>
            {addError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{addError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] @4xl:items-start">
              <div className="space-y-1.5">
                <Label htmlFor="mgr-phone">Nomor WhatsApp</Label>
                <Input
                  id="mgr-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0812 3456 7890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                  aria-invalid={!!phoneError}
                  aria-describedby="mgr-phone-help"
                  className={cn(
                    "bg-white",
                    phoneError && "border-red-400 focus-visible:ring-red-300",
                  )}
                  disabled={addPending}
                />
                <p
                  id="mgr-phone-help"
                  className={cn("text-xs", phoneError ? "text-red-600" : "text-muted-foreground")}
                >
                  {phoneError ||
                    (phonePreview
                      ? `Disimpan sebagai ${phonePreview}`
                      : "Boleh 08…, 62… atau +62…; spasi/strip tidak masalah.")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mgr-name">Nama</Label>
                <Input
                  id="mgr-name"
                  placeholder="mis. Bu Titik"
                  autoComplete="name"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  aria-invalid={!!nameError}
                  className={cn(
                    "bg-white",
                    nameError && "border-red-400 focus-visible:ring-red-300",
                  )}
                  disabled={addPending}
                />
                <p className={cn("text-xs", nameError ? "text-red-600" : "text-muted-foreground")}>
                  {nameError || "Dipakai bot untuk menyapa."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mgr-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => isManagerRoleValue(v) && setRole(v)}
                  disabled={addPending}
                >
                  <SelectTrigger id="mgr-role" className="w-full bg-white">
                    <SelectValue placeholder="Pilih role" />
                  </SelectTrigger>
                  <SelectContent>
                    <RoleSelectItems />
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{MANAGER_ROLE_INFO[role].short}</p>
              </div>

              <div className="@xl:pt-[22px]">
                <Button
                  type="submit"
                  disabled={addPending}
                  className="w-full bg-teal-600 text-white hover:bg-teal-700 @xl:w-auto"
                >
                  {addPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {addPending ? "Menyimpan…" : "Tambah"}
                </Button>
              </div>
            </div>

            {/* Arti role — ringkas */}
            <ul className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
              {MANAGER_ROLES.map((r) => (
                <li key={r} className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", MANAGER_ROLE_INFO[r].dot)} />
                  <span>
                    <strong className="font-medium text-foreground">
                      {MANAGER_ROLE_INFO[r].label}
                    </strong>
                    {" — "}
                    {MANAGER_ROLE_INFO[r].description}
                  </span>
                </li>
              ))}
            </ul>
          </form>

          {/* Daftar */}
          <div className="divide-y divide-border">
            {isLoading &&
              [0, 1].map((i) => (
                <div key={i} className="flex items-center gap-3 p-4 sm:px-6">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}

            {!isLoading && list.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <div className="rounded-full bg-muted p-3">
                  <UserRound className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="font-medium">Belum ada manager</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Tambahkan nomor WhatsApp pengelola di atas. Selama kosong, semua chat masuk
                  dilayani sebagai tamu.
                </p>
              </div>
            )}

            {!isLoading &&
              list.map((m) => {
                const active = m.is_active ?? true;
                const muted = !!m.is_muted;
                const busy = busyIds?.has(m.id) ?? false;
                return (
                  <div
                    key={m.id}
                    data-testid="manager-row"
                    className={cn(
                      "flex flex-col gap-3 p-4 sm:px-6 @3xl:flex-row @3xl:items-center @3xl:justify-between",
                      !active && "bg-muted/40",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                          active ? "bg-teal-50 text-teal-700" : "bg-muted text-muted-foreground",
                        )}
                        aria-hidden
                      >
                        {m.name.trim().charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="break-words font-semibold leading-tight">{m.name}</span>
                          <RoleBadge role={m.role} />
                          {!active && (
                            <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                              Nonaktif
                            </span>
                          )}
                        </div>
                        <a
                          href={`https://wa.me/${normalizeManagerPhone(m.phone)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block whitespace-nowrap font-mono text-sm text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {formatManagerPhone(m.phone)}
                        </a>
                      </div>
                      <DeleteButton
                        name={m.name}
                        busy={busy}
                        onClick={() => setPendingDelete(m)}
                        className="self-start @3xl:hidden"
                      />
                    </div>

                    <div className="grid grid-cols-2 items-center gap-2 border-t border-border pt-3 @md:flex @md:flex-wrap @md:gap-3 @3xl:shrink-0 @3xl:border-t-0 @3xl:pt-0">
                      <Select
                        value={isManagerRoleValue(m.role) ? m.role : undefined}
                        onValueChange={(v) =>
                          isManagerRoleValue(v) && v !== m.role && onChangeRole(m.id, v)
                        }
                        disabled={busy}
                      >
                        <SelectTrigger
                          className="col-span-2 h-9 w-full bg-white text-xs @md:w-[160px]"
                          aria-label={`Role ${m.name}`}
                        >
                          <SelectValue placeholder="Pilih role" />
                        </SelectTrigger>
                        <SelectContent>
                          <RoleSelectItems compact />
                        </SelectContent>
                      </Select>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-white px-2.5 text-xs">
                            <Switch
                              checked={active}
                              disabled={busy}
                              onCheckedChange={(checked) => onToggleActive(m.id, checked)}
                              aria-label={`Aktifkan ${m.name}`}
                            />
                            <span className="w-12 font-medium">
                              {active ? "Aktif" : "Nonaktif"}
                            </span>
                          </label>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[240px]">
                          {active
                            ? "Nomor dikenali sebagai manager. Matikan agar diperlakukan sebagai tamu."
                            : "Nomor saat ini diperlakukan sebagai tamu. Nyalakan untuk akses manager."}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            className={cn(
                              "h-9 w-full gap-1.5 bg-white text-xs @md:w-auto",
                              muted && "border-amber-300 text-amber-700 hover:bg-amber-50",
                            )}
                            aria-pressed={!muted}
                            onClick={() => onToggleMute(m.id, !muted)}
                          >
                            {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                            {muted ? "Notif mati" : "Notif aktif"}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[240px]">
                          {muted
                            ? "Tidak menerima notifikasi booking/pembayaran. Klik untuk menyalakan."
                            : "Menerima notifikasi booking/pembayaran via WhatsApp. Klik untuk membisukan."}
                        </TooltipContent>
                      </Tooltip>

                      <DeleteButton
                        name={m.name}
                        busy={busy}
                        onClick={() => setPendingDelete(m)}
                        className="hidden @3xl:inline-flex"
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        {/* Cara kerja — dilipat agar tidak makan tempat */}
        <Card className="p-0">
          <button
            type="button"
            onClick={() => setShowHowItWorks((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium sm:px-6"
            aria-expanded={showHowItWorks}
          >
            Bagaimana bot membedakan tamu dan manager?
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                showHowItWorks && "rotate-180",
              )}
            />
          </button>
          {showHowItWorks && (
            <ol className="list-decimal space-y-1.5 px-4 pb-4 pl-9 text-sm text-muted-foreground sm:px-6 sm:pl-11">
              <li>Pesan WhatsApp masuk diterima Orchestrator.</li>
              <li>
                Nomor pengirim dicocokkan dengan daftar di atas (format 08/62/+62 dianggap sama).
              </li>
              <li>
                Jika terdaftar dan <strong className="text-foreground">Aktif</strong> → dilayani
                Manager Bot sesuai role, mis. <em>"Halo Bu Titik! Ada yang bisa saya bantu?"</em>
              </li>
              <li>Jika tidak terdaftar atau nonaktif → dilayani sebagai tamu biasa.</li>
            </ol>
          )}
        </Card>

        <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus manager?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDelete
                  ? `${pendingDelete.name} (${formatManagerPhone(pendingDelete.phone)}) akan dihapus dari daftar. Nomor ini selanjutnya dilayani sebagai tamu. Jika hanya ingin menonaktifkan sementara, gunakan tombol Aktif.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={() => {
                  if (pendingDelete) void onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Hapus
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
