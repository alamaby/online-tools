# Instagram Extractor

Ambil caption dan semua gambar slide dari postingan Instagram publik — tanpa login Instagram. Dipakai dari GitHub Pages.

**Coba di:** `https://alamaby.github.io/online-tools/instagram-extractor/`

## Cara kerja

GitHub Pages murni tidak bisa mengambil data Instagram langsung: browser memblokirnya karena CORS, dan halaman Instagram hanya berisi JavaScript tanpa data di HTML-nya. Jadi tool ini memakai dua bagian:

1. **Halaman web** (`index.html`, di-host GitHub Pages) — tempel link, tekan tombol. Halaman ini memicu workflow GitHub Actions lewat API, lalu membaca hasilnya.
2. **GitHub Actions** (`.github/workflows/instagram-extract.yml`) — membuka postingan di Chromium headless (Playwright, tanpa login), membaca caption, mengunduh tiap slide, lalu commit hasilnya ke `instagram-extractor/results/<job-id>/`.

## Setup (sekali saja)

1. **Aktifkan GitHub Pages:** repo → Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.
2. **Buat token GitHub** (fine-grained): https://github.com/settings/personal-access-tokens → New token → pilih repo `online-tools` → Permissions:
   - Actions: **Read and write** (ini saja sudah cukup untuk memicu workflow dari halaman tool)
   - Masa berlaku: pilih yang paling lama (maksimal 1 tahun) supaya jarang mengulang.
3. **Izinkan Actions menulis ke repo:** repo → Settings → Actions → General → Workflow permissions → **Read and write permissions** (atau workflow akan gagal saat `git push`).
4. Buka halaman tool, tempel token di kolom token (token hanya disimpan di `localStorage` browser kamu, tidak pernah masuk repo).

## Cara pakai

1. Tempel link postingan publik, mis. `https://www.instagram.com/p/XXXX/`
2. Tekan **Ambil postingan**. Workflow berjalan 1–3 menit.
3. Caption tampil di halaman (ada tombol salin), tiap slide bisa diunduh satu per satu, atau semuanya sekaligus sebagai ZIP.

Hasil tiap job tersimpan di `instagram-extractor/results/<job-id>/`:

```
results/<job-id>/
  result.json     # metadata, caption, daftar slide
  slide-01.jpg    # satu file per slide
  slide-02.jpg
  ...
```

`result.json` berisi: `job_id`, `post_url`, `shortcode`, `type` (`carousel` / `image` / `video`), `author` (`username`, `display_name`, `verified`), `posted_at`, `likes`, `comments`, `caption`, `slide_count`, `slides` (`index`, `kind`, `file`, `width`, `height`). Kalau gagal, ada field `error` dan `error_code`.

## Menjalankan extractor di laptop (tanpa Actions)

Panduan lengkap (Windows, langkah demi langkah): [RUN-LOCALLY.md](RUN-LOCALLY.md).
Berguna saat jalan via web gagal dengan `LOGIN_WALL` — IP rumah jauh
lebih jarang kena dinding login daripada IP runner GitHub Actions.

```sh
cd instagram-extractor
npm install
npx playwright install chromium
node extract.mjs --url https://www.instagram.com/p/XXXX/ --job test-1 --out results/test-1
```

## Batasan

- Hanya postingan **publik**. Postingan privat, terhapus, atau dibatasi tidak bisa diambil.
- Instagram kadang menampilkan dinding login untuk IP pusat data (termasuk runner GitHub Actions). Kalau gagal dengan kode `LOGIN_WALL`, tunggu beberapa menit lalu coba lagi.
- Reel/video: video diunduh kalau URL mp4-nya tersedia; kalau tidak, yang tersimpan hanya thumbnail-nya.
- Jangan dipakai untuk mengunduh konten berhak cipta secara massal atau melanggar ketentuan Instagram.
