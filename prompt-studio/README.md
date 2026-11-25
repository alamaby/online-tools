# 🧙‍♀️ Aluna Prompt Studio (Web Edition)

Versi web murni sisi klien (*client-side static web application*) dari **Aluna Prompt Studio**, dirancang khusus untuk menghasilkan teks prompt generasi gambar AI (*image generation prompts*) karakter **Aluna Arundati Buana** (tokoh utama novel *Aroma Kopi dan Mantra Kasir Shift Pagi*) dengan konsistensi visual fisik, atribut kanon, dan busana 100% akurat.

Tool ini dapat diakses langsung secara online melalui GitHub Pages:
👉 **[https://alamaby.github.io/online-tools/prompt-studio/](https://alamaby.github.io/online-tools/prompt-studio/)**

Atau dibuka secara offline langsung di peramban web tanpa memerlukan web server lokal (`file:///.../index.html`).

---

## ✨ Fitur Utama

1. **🎨 Studio Utama (Prompt Generator):**
   * **103 Busana Kanon** dengan filter per klaster kategori (Ritel, Kasual, Pesta/Elegan, Sensual, Arcana/Kultural, Cosplay, Olahraga/Athleisure).
   * **144 Pose Gestur & Aksi** (termasuk pose ritel, mobilitas komuter/moge, pencak silat Sunda, dan duo mature lover).
   * **34 Latar Tempat Sinematik** (BumiMart POS 1, kamar loteng Dago, kebun teh Rancabali, kafe kaca Dipatiukur, Maribaya, onsen, dll).
   * **24 Sudut Pandang Kamera** dengan **Indikator Harmonisasi Bintang ⭐ (Bidirectional Compatibility Matrix)** antara Pose dan Angle.
   * **17 Tata Cahaya & Atmosfer Visual** (sinar fajar keemasan, rembulan malam, kabut monsun Priangan, volumetric god rays, dll).
   * **Multi-Engine Formatting**: Midjourney v6 (`--ar`, `--stylize`, `--cref`, `--cw`), SDXL / Flux (masterpiece, setting, character, negative prompt otomatis), dan Natural Language (Imagen 3 / Gemini / DALL-E 3 / ChatGPT).
   * **Spatial Guard**: Otomatis mendeteksi pose kendaraan roda dua/mobil dan mengadaptasi latar tertutup menjadi area jalan dan pelataran parkir luar gedung.
   * **Pusaka Klan & Lore Toggles**: Kujang Pasak Pangeker Mana limiter, Familiar Aki Bolang (kucing belang tiga), dan Lapisan Lunar Ward.
   * **🎨 Preview Gambar (Free Tier 1 — Beta)**: Pratinjau visual cepat 100% *client-side* tanpa backend dan tanpa API key wajib melalui *cascading fallback* (**Pollinations.ai** &rarr; **AI Horde / Stable Horde**), dilengkapi pemadatan prompt otomatis, hitung mundur cooldown 45 detik Pollinations, progress antrean AI Horde + tombol Batal, opsi AI Horde key lokal di `localStorage`, dan tombol Unduh Gambar. *(Catatan: preview bersifat text-to-image tanpa referensi wajah `--cref` dan Pollinations menyertakan watermark bawaan).*

2. **👗 Modular Wardrobe Mix & Match Studio (Tab 2):**
   * Penyusunan busana kustom per lapisan melalui 6 slot modular:
     1. Pakaian Dalam Atas (*Inner Top*)
     2. Pakaian Dalam Bawah (*Inner Bottom*)
     3. Pakaian Luar Atas / Terusan (*Outer Top / One-Piece Dress*)
     4. Pakaian Luar Bawah (*Outer Bottom*)
     5. Layer & Aksesoris Pinggang / Rompi / Apron (*Layer Accessory*)
     6. Alas Kaki & Sepatu (*Footwear*)
   * **104 Resep Gaya Busana Kanon** siap pakai dengan satu tombol klik.
   * Kontrol visibilitas dalaman (*hidden*, *subtle*, *exposed*).
   * Tombol *Gunakan Busana Ini di Studio Utama* langsung menyuntikkan ramuan busana kustom ke generator utama.

3. **🧙‍♀️ Explore Karakter Studio (Tab 3):**
   * Eksplorasi ciri fisik Aluna: 18 gaya rambut, 10 ekspresi, 10 rona kulit, bentuk wajah, bentuk mata, detail riasan, pilihan shot, dan busana netral.
   * **Dynamic Trait Binding**: Gaya rambut kustom otomatis menimpa deskripsi cepol barista kanon di Studio Utama agar tidak terjadi konflik semantik prompt.
   * Generator prompt potret acuan (*character reference prompt*).

4. **📦 Bulk Vibe & Virtual Fitting Room (Tab 4):**
   * **Bulk Thematic Vibe**: Menghasilkan batch $N = 3, 5, 10, 15, 20,$ atau $30$ prompt sekaligus berdasarkan salah satu dari 15 suasana bertema tanpa duplikasi (*sampling without replacement*), dilengkapi opsi penguncian parameter (*Selective Lock*).
   * **Virtual Fitting Room Matrix**: Evaluasi 103 koleksi busana secara sistematis dengan pose, latar, sudut kamera, dan pencahayaan terkunci mati (*ceteris paribus*).
   * Dilengkapi tombol salin individual, **📋 Salin Semua Batch**, dan **📥 Unduh Berkas Markdown (.md)**.

---

## ⌨️ Pintasan Keyboard (Desktop Hotkeys)

| Tombol | Aksi | Deskripsi |
| :---: | :--- | :--- |
| **`g`** | **Generate Prompt** | Menyusun ulang teks prompt berdasarkan konfigurasi aktif. |
| **`z`** | **🎲 Acak Karakter** | Mengacak Busana, Pose, dan Sudut Pandang Kamera serentak. |
| **`x`** | **✨ Roll Bertema** | Mengacak seluruh parameter berdasarkan 1 dari 15 suasana bertema. |
| **`t`** | **🌐 Acak Total** | Mengacak seluruh parameter visual tanpa batasan tema. |
| **`c`** | **📋 Salin Prompt** | Menyalin teks prompt utama langsung ke clipboard sistem operasi. |
| **`s`** | **📥 Unduh Markdown** | Mengunduh berkas Markdown (.md) berisi prompt snapshot dan metadata. |
| **`r`** | **🔄 Reset Form** | Mengembalikan seluruh form ke setelan default awal. |

*Catatan: Pintasan keyboard dinonaktifkan otomatis saat kursor berada di dalam kotak teks (`input` atau `textarea`).*

---

## 🔄 Sinkronisasi Data dari Repositori Master (`aluna-prompt-studio`)

Jika terdapat penambahan busana baru, pose baru, atau pembaruan atribut kanon di repositori master Python `aluna-prompt-studio`, sinkronisasi ke repositori web ini dapat dilakukan hanya dengan **satu baris perintah**:

```bash
cd "G:\My Drive\DriveSyncFiles\ObsidianVault\Vault01\witch\aluna-prompt-studio"
python export_to_web.py
```

Skrip tersebut akan membaca ulang master file Python (`presets.py`, `wardrobe.py`, `character_traits.py`) dan secara otomatis memperbarui berkas JSON serta bundle `data/data.js` di direktori ini tanpa perlu melakukan kompilasi manual.
