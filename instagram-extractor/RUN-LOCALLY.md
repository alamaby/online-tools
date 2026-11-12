# Menjalankan Extractor di Laptop Sendiri (Windows)

Jalan lokal ini ada karena Instagram kadang menampilkan dinding login
(`LOGIN_WALL`) ke IP server GitHub Actions. IP rumah jauh lebih jarang
kena dinding itu, jadi cara ini biasanya berhasil saat jalan via web
gagal. Script-nya sama persis dengan yang dipakai workflow
(`extract.mjs`), tanpa login Instagram dan tanpa token GitHub.

## Sekali saja: persiapan

1. **Install Node.js 20 LTS** dari https://nodejs.org (pilih LTS,
   bukan Current). Setelah install, tutup lalu buka lagi PowerShell.
   Cek dengan:

   ```powershell
   node --version
   ```

   Harus muncul `v20.x.x` (atau lebih baru). Kalau muncul error
   `'node' is not recognized`, tutup semua jendela PowerShell lalu
   buka lagi; kalau masih error, Node belum masuk PATH — install
   ulang dengan opsi "Add to PATH" dicentang.

2. **Ambil repo ini** (sekali saja; kalau sudah pernah clone,
   ganti langkah ini dengan `git pull`):

   ```powershell
   git clone https://github.com/alamaby/online-tools.git
   cd online-tools\instagram-extractor
   ```

3. **Install dependensi + browser Chromium** (sekali saja, sekitar
   500 MB):

   ```powershell
   npm install
   npx playwright install chromium
   ```

## Setiap kali mau extract

Dari folder `online-tools\instagram-extractor`, jalankan:

```powershell
node extract.mjs --url "https://www.instagram.com/p/DfJ7wohlEY-/"
```

Cukup itu saja. Tanpa `--job` dan `--out`, script otomatis membuat
job id `job-<waktu>` dan menyimpan hasil ke `results\<job-id>\`.

Kalau mau nama job sendiri (supaya gampang dicari), pakai bentuk
lengkap:

```powershell
node extract.mjs --url "https://www.instagram.com/p/DfJ7wohlEY-/" --job "20261112-skillspace" --out "results\20261112-skillspace"
```

Jendela terminal akan menampilkan prosesnya. Biasanya selesai dalam
30 detik – 2 menit.

Alternatif: `npm run extract -- --url "https://..."` — sama saja,
hanya lebih panjang.

## Membaca hasilnya

Di dalam `results\<job-id>\`:

- `result.json` — metadata + caption lengkap. Buka dengan Notepad
  atau VS Code. Isinya antara lain `author`, `posted_at`, `likes`,
  `comments`, `caption`, dan daftar `slides`.
- `slide-01.jpg`, `slide-02.jpg`, … — satu file per slide, sesuai
  urutan di postingan. Video jadi `slide-NN.mp4` beserta
  `slide-NN-poster.jpg`. Buka langsung dengan Photos / pemutar video.

## Kalau gagal

- `LOGIN_WALL` — Instagram menampilkan dinding login bahkan dari IP
  rumah. Tunggu beberapa jam lalu coba lagi, atau coba lewat
  hotspot HP (IP lain). Ini bukan error script.
- `NOT_FOUND` — link salah, postingan dihapus, atau dibatasi.
  Periksa lagi link-nya.
- `DOWNLOAD_FAILED` / `NO_MEDIA` — postingan ketemu tapi slide
  gagal diunduh. Coba lagi sekali; kalau tetap gagal, catat job id
  dan link-nya untuk di-debug.
- Hasil selalu tersimpan: walau gagal, `result.json` tetap ditulis
  dengan field `error` dan `error_code`, jadi tidak perlu menebak.

## Catatan

- **Tidak butuh token GitHub** untuk jalan lokal. Token hanya
  dipakai halaman web untuk memicu workflow.
- Hasil jalan lokal **hanya tersimpan di laptop**, tidak otomatis
  naik ke repo. Kalau mau hasil itu tampil di halaman web, commit
  manual folder `results\<job-id>\` ke repo.
- Kalau script di repo diperbarui, jalankan `git pull` di folder
  repo, lalu `npm install` lagi kalau `package.json` berubah.
- Script ini tidak memakai proxy. Kalau laptopmu memakai proxy
  (mis. ProtonVPN dalam mode tertentu), set variabel `HTTPS_PROXY`
  sebelum menjalankan — script sudah menghormatinya.
