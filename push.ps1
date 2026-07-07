# push.ps1 — commit semua perubahan lalu push ke GitHub.
# Lovable akan sync otomatis dari branch `main`.
#
# Pakai (di PowerShell, dari folder project):
#   ./push.ps1                    -> pesan commit otomatis (pakai tanggal/jam)
#   ./push.ps1 "pesan commit"     -> pesan commit sendiri
#
# Catatan:
#   - .env dan .dev.vars tidak ikut ter-commit (sudah di .gitignore).
#   - Jalankan dari mesin Windows Anda (bukan dari Cowork), karena ini
#     membaca file di disk asli.

param([string]$Message)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $Message -or $Message.Trim() -eq "") {
  $Message = "update " + (Get-Date -Format "yyyy-MM-dd HH:mm")
}

Write-Host "-> git add -A" -ForegroundColor Cyan
git add -A

$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host "Tidak ada perubahan untuk di-commit." -ForegroundColor Yellow
  exit 0
}

Write-Host "File yang akan di-commit:" -ForegroundColor Cyan
$staged | ForEach-Object { Write-Host "   $_" }

Write-Host "-> git commit -m `"$Message`"" -ForegroundColor Cyan
git commit -m $Message

Write-Host "-> git push" -ForegroundColor Cyan
git push

Write-Host "Selesai. Sudah di-push ke main — Lovable akan sync otomatis." -ForegroundColor Green
