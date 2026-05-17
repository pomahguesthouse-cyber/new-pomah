## Tujuan
Upload seluruh codebase project ini ke Google Drive di dalam folder bernama `new-pomah`, menggunakan koneksi **New Pomah G-Drive** yang sudah tersedia di workspace.

## Pendekatan
Ini bukan fitur aplikasi — tidak ada UI atau route yang ditambahkan. Ini adalah task one-off yang dijalankan langsung dari sandbox via `code--exec` menggunakan Google Drive connector gateway.

## Langkah

1. **Link koneksi Google Drive ke project**
   Pakai connector `google_drive` (connection: *New Pomah G-Drive*) supaya `LOVABLE_API_KEY` dan `GOOGLE_DRIVE_API_KEY` tersedia di environment sandbox.

2. **Siapkan arsip codebase**
   - Buat archive `.zip` dari project root, mengecualikan: `node_modules`, `.git`, `dist`, `build`, `.cache`, `.vite`, `.wrangler`, `.turbo`, `.next`, `bun.lock`, file binary cache.
   - Simpan sementara di `/tmp/new-pomah-codebase.zip`.
   - Tujuannya: 1 file upload, jauh lebih cepat & andal dibanding upload ribuan file kecil satu-per-satu lewat REST API.

3. **Buat folder `new-pomah` di Drive (jika belum ada)**
   - `GET /files?q=name='new-pomah' and mimeType='application/vnd.google-apps.folder' and trashed=false`
   - Jika kosong → `POST /files` dengan `mimeType: application/vnd.google-apps.folder`, name `new-pomah`.
   - Simpan `folderId` hasilnya.

4. **Upload zip ke folder tersebut**
   - Gunakan multipart upload endpoint: `POST /upload/drive/v3/files?uploadType=multipart`
   - Metadata: `{ name: "new-pomah-codebase-<timestamp>.zip", parents: [folderId] }`
   - Body: zip binary dengan boundary multipart.
   - Verifikasi response berisi `id` file.

5. **Konfirmasi ke user**
   Tampilkan: nama folder, nama file, ukuran zip, dan link `https://drive.google.com/drive/folders/<folderId>`.

## Catatan
- Codebase di-upload sebagai **single zip**, bukan tree mirror. Kalau Anda lebih suka folder mirror (tiap file/folder asli direplikasi di Drive), beri tahu — itu butuh ratusan-ribuan API call dan jauh lebih lambat.
- Secret API key tetap di server (`process.env`), tidak ada perubahan kode aplikasi.