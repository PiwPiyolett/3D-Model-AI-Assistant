# IceGirl · AI Voice Assistant 🧊

Asisten AI dengan model **Live2D** yang bisa **mendengar** (mikrofon) dan
**menjawab dengan suara**, lengkap dengan **gerak mulut (lip-sync)**, **kedip
mata otomatis**, dan **ekspresi wajah** yang menyesuaikan emosi jawaban.

- **Otak AI:** Claude (Anthropic)
- **Dengar (STT) & Suara (TTS):** Web Speech API bawaan browser (gratis) — dibuat
  modular agar mudah di-upgrade ke premium (ElevenLabs/Azure) nanti.
- **Bahasa:** Bilingual — Bahasa Indonesia + English (mengikuti bahasamu).

---

## 1. Persiapan (sekali saja)

### a. Masukkan API key Claude
1. Ambil API key di <https://console.anthropic.com/settings/keys>
2. Salin file `server/.env.example` menjadi `server/.env`
3. Buka `server/.env`, ganti nilai `ANTHROPIC_API_KEY` dengan key milikmu.

```powershell
# dari folder proyek
Copy-Item server/.env.example server/.env
notepad server/.env
```

### b. Install dependencies (sudah dilakukan, ulangi bila perlu)
```powershell
cd server
npm install
```

## 2. Menjalankan

```powershell
cd server
npm start
```

Lalu buka **<http://localhost:3000>** di **Google Chrome** (STT paling andal di Chrome).

## 3. Cara pakai
- Klik tombol **🎤 Bicara** (atau tekan **Spasi**) lalu bicara.
- Atau ketik di kotak teks dan tekan **Enter**.
- Klik **⚙️** untuk memilih suara, kecepatan bicara, bahasa mikrofon, dan mode
  "dengarkan otomatis".

> Catatan: browser memblokir suara otomatis sampai ada interaksi pertama —
> sapaan pembuka mungkin baru terdengar setelah kamu klik pertama kali. Izinkan
> akses **mikrofon** saat diminta.

---

## Struktur proyek

```
3D Model Ai Assistant/
├── server/
│   ├── server.js        # Express: sajikan web + model, proxy ke Claude, augmentasi model3.json
│   ├── .env.example     # template API key  → salin ke .env
│   └── package.json
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── config.js    # pemetaan emosi → ekspresi model, id parameter
│       ├── live2d.js    # render model, lip-sync, kedip, ekspresi
│       ├── stt.js       # pendengaran (swappable)
│       ├── tts.js       # suara (swappable)
│       ├── chat.js      # riwayat + panggil backend
│       └── main.js      # orkestrasi semuanya
└── 2D Model/            # aset Live2D IceGirl milikmu (tidak diubah)
```

## Ganti model Claude
Di `server/.env`:
- `claude-haiku-4-5-20251001` — tercepat & termurah (default, bagus untuk suara real-time)
- `claude-sonnet-5` — persona lebih pintar, sedikit lebih lambat

## Upgrade ke suara premium (nanti)
Ganti isi `public/js/tts.js` agar mengambil audio dari ElevenLabs/Azure dan
memutarnya lewat `<audio>` + Web Audio `AnalyserNode`, lalu panggil
`Live2DController.setMouthAmplitude(rms)` tiap frame untuk lip-sync dari amplitudo
suara asli (interface `setMouthAmplitude` sudah disiapkan di `live2d.js`).

## Kredit model
Live2D "IceGirl" oleh **TianyeLulu** (lisensi komersial penuh — lihat
`2D Model/Read me.txt`).
