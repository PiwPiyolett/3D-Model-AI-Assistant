<div align="center">

# 🧊 IceGirl · AI Voice Assistant

**Asisten AI dengan model Live2D yang bisa mendengar, menjawab dengan suara, dan berekspresi.**

Lip-sync gerak mulut · kedip mata otomatis · ekspresi wajah mengikuti emosi jawaban · bilingual (ID + EN).

![Claude](https://img.shields.io/badge/AI-Claude_(Anthropic)-D97757?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![Live2D](https://img.shields.io/badge/Live2D-Cubism-FF69B4?style=flat-square)
![Web Speech API](https://img.shields.io/badge/Speech-Web_Speech_API-4285F4?style=flat-square)

<img src="Screenshot%202026-09-02%20134128.png" alt="IceGirl AI Assistant" width="720">

</div>

---

## ✨ Fitur

- 🎙️ **Mendengar (STT)**, menangkap suaramu lewat mikrofon dengan Web Speech API.
- 🔊 **Menjawab dengan suara (TTS)**, modular, mudah di-upgrade ke premium (ElevenLabs/Azure/msedge-tts).
- 👄 **Lip-sync**, gerak mulut model menyesuaikan suara yang keluar.
- 😊 **Ekspresi & kedip otomatis**, wajah bereaksi sesuai emosi dari jawaban AI.
- 🌏 **Bilingual**, Bahasa Indonesia + English, mengikuti bahasamu.
- 🧠 **Otak fleksibel**, Claude sebagai default, siap dialihkan ke Gemini / OpenAI.

## 🛠️ Tech Stack

| Bagian | Teknologi |
|---|---|
| Model karakter | Live2D Cubism (Web) |
| Suara | Web Speech API (STT/TTS), msedge-tts |
| Backend | Node.js + Express |
| AI | Claude (Anthropic SDK), Google Generative AI, OpenAI |
| Konfigurasi | dotenv, CORS |

## 🚀 Menjalankan

```bash
# 1. Masuk ke folder server & pasang dependency
cd server
npm install

# 2. Siapkan API key
cp .env.example .env      # lalu isi ANTHROPIC_API_KEY di dalam .env

# 3. Jalankan server
npm run dev
```

Buka halaman frontend di browser, izinkan akses mikrofon, dan mulai mengobrol dengan IceGirl. 🎧

> API key diambil di <https://console.anthropic.com/settings/keys>. File `.env` sengaja **tidak** ikut ke repo demi keamanan.

---

<div align="center">

**Ariqo Banyusila Abrar** · [@PiwPiyolett](https://github.com/PiwPiyolett)

</div>
