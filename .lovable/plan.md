## Tujuan

Satu project Lovable, dua domain:
- `pomahguesthouse.com` → halaman publik (`/`, `/rooms`, `/book`, `/login`)
- `admin.pomahguesthouse.com` → dashboard (`/admin/*`)

Backend (server functions, database) tetap satu — memang harus, karena halaman publik juga perlu booking/WhatsApp.

## Yang akan dibangun

### 1. Hook deteksi hostname
File baru: `src/hooks/use-hostname.ts`
- Return hostname saat ini (SSR-safe — pakai `request.url` lewat root context atau `window.location.hostname` di client).
- Helper: `isAdminHost(hostname)` → true jika hostname diawali `admin.` atau hostname dev preview yang ditandai sebagai admin.

### 2. Host-aware redirect di `__root.tsx`
Tambah logic di `RootComponent` (atau lebih baik di `beforeLoad` root):
- Jika hostname = `admin.*` DAN pathname = `/` → redirect ke `/admin`.
- Jika hostname = `pomahguesthouse.com` (non-admin) DAN pathname diawali `/admin` → redirect ke `/` (atau tampilkan 404).
- Untuk preview Lovable (`*.lovable.app`) — semua route tetap bisa diakses (developer convenience).

### 3. Sembunyikan link admin di situs publik
Komponen header/nav publik: jangan render link "Admin" jika `!isAdminHost`.

### 4. SEO per-host
- `sitemap.xml` & `robots.txt`: hanya expose route publik di domain utama; di `admin.*` set `robots.txt` → `Disallow: /`.
- Implementasi: server route `sitemap[.]xml.ts` baca `request.headers.host`, balikkan content sesuai host. Sama untuk `robots.txt` (route baru `robots[.]txt.ts`).
- Set `<meta name="robots" content="noindex">` di root jika `isAdminHost`.

### 5. Hubungkan domain (manual oleh user)
Di **Project Settings → Domains**:
- Tambah `pomahguesthouse.com` (sudah ada / connect ulang sebagai primary publik)
- Tambah `admin.pomahguesthouse.com` sebagai subdomain
- Atur DNS: A record `admin` → `185.158.133.1`, plus TXT verifikasi yang Lovable sediakan
- Tunggu propagasi + SSL otomatis

Saya tidak bisa otomatisasi langkah DNS — itu di registrar Anda. Tapi setelah DNS jalan, kode di atas otomatis aktif.

## Catatan teknis

- Pendekatan ini **bukan pemisahan keamanan keras** — kalau seseorang tahu URL `pomahguesthouse.com/admin` mereka tetap di-redirect, tapi assets JS admin sudah ter-bundle ke browser publik. Auth + RLS di Supabase tetap pertahanan utama (sudah ada).
- Kalau nanti butuh pemisahan bundle (admin tidak ke-download di situs publik), perlu pindah ke **2 project terpisah** (Opsi 2). Sekarang belum perlu.
- SSR-aware: redirect harus dilakukan di `beforeLoad` root supaya jalan saat first request, bukan flash di client.

## File yang berubah

- `src/hooks/use-hostname.ts` (baru)
- `src/routes/__root.tsx` (tambah `beforeLoad` host check + meta robots conditional)
- `src/routes/sitemap[.]xml.ts` (host-aware)
- `src/routes/robots[.]txt.ts` (baru, host-aware)
- Komponen nav publik (sembunyikan link admin)
