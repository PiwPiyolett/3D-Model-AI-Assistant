/* Text-to-speech (voice output).
 * Two engines:
 *   - "edge"    : Microsoft Edge neural voices via the backend /api/tts (free,
 *                 no key, natural). Plays real MP3 audio and drives accurate
 *                 lip-sync from the audio amplitude (onAmplitude -> setMouthAmplitude).
 *   - "browser" : Web Speech API SpeechSynthesis (offline fallback).
 * A sentence queue lets Yuki speak sentence-by-sentence as the LLM streams. */
(function () {
  const synth = window.speechSynthesis;

  const FEMALE_HINTS = /female|wanita|perempuan|gadis|zira|hazel|susan|aria|jenny|clara|maria|sinta|damayanti|nanami|ayumi|haruka|sayaka|mayu|google|natural|neural|online/i;
  const MALE_HINTS = /\bmale\b|pria|laki|andika|ardi|gadang|david|mark|guy|ravi|thomas|george|james|william|ichiro|keita/i;
  const QUALITY_HINTS = /google|natural|neural|online|enhanced|premium/i;

  const TTS = {
    engine: "edge",            // "edge" | "browser"
    supported: true,
    browserSupported: Boolean(synth),
    voices: [],
    voiceURI: null,
    edgeVoice: null,           // null = auto by language (JA=Nanami, EN=Aria, ID=Gadis)
    edgePitchHz: 27,           // Edge pitch shift in Hz (higher = cuter)
    rate: 1,                   // speaking rate multiplier (1 = normal)

    // Streaming callbacks (wired by main.js):
    onStreamStart: null,
    onUtteranceStart: null,
    onUtteranceEnd: null,
    onDrained: null,
    onAmplitude: null,         // (0..1) per frame while edge audio plays

    // Web Audio (edge lip-sync):
    _ctx: null,
    _analyser: null,

    init() {
      const load = () => { this.voices = synth ? synth.getVoices() : []; };
      load();
      if (synth) synth.onvoiceschanged = load;
    },

    // AudioContext must be created/resumed after a user gesture (autoplay policy).
    resumeAudio() {
      try {
        this._ensureCtx();
        if (this._ctx.state === "suspended") this._ctx.resume();
      } catch (_) {}
    },
    _ensureCtx() {
      if (!this._ctx) {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = 256;
        this._analyser.connect(this._ctx.destination);
      }
      return this._ctx;
    },

    detectLang(text) {
      const s = text || "";
      // Japanese: any hiragana / katakana / CJK kanji.
      if (/[぀-ヿ㐀-䶿一-鿿]/.test(s)) return "ja-JP";
      const t = s.toLowerCase();
      const idHints = /\b(aku|kamu|kita|nggak|tidak|iya|banget|dong|sih|apa|kenapa|terima kasih|halo|selamat|yang|dengan|saya|bisa|nih|kok|deh)\b/;
      return idHints.test(t) ? "id-ID" : "en-US";
    },
    _edgeVoiceFor(lang) {
      const l = (lang || "").toLowerCase();
      // Japanese always uses the Japanese voice, even if a different voice is
      // selected — otherwise the wrong-language voice mangles the reading.
      if (l.startsWith("ja")) return "ja-JP-NanamiNeural";
      if (this.edgeVoice) return this.edgeVoice;
      if (l.startsWith("id")) return "id-ID-GadisNeural";
      return "en-US-AriaNeural";
    },

    /* ---- browser voice ranking (fallback engine) ---- */
    _score(v, base) {
      let s = 0;
      const lang = v.lang.toLowerCase();
      const name = v.name || "";
      if (lang.startsWith(base)) s += 100;
      else if (base === "id" && lang.startsWith("en")) s += 10;
      if (FEMALE_HINTS.test(name)) s += 50;
      if (MALE_HINTS.test(name)) s -= 80;
      if (QUALITY_HINTS.test(name)) s += 25;
      if (!v.localService) s += 8;
      return s;
    },
    _pickVoice(lang) {
      if (this.voiceURI) {
        const chosen = this.voices.find((v) => v.voiceURI === this.voiceURI);
        if (chosen) return chosen;
      }
      const base = (lang || "id").slice(0, 2).toLowerCase();
      if (!this.voices.length) return null;
      const ranked = this.voices.map((v) => ({ v, s: this._score(v, base) })).sort((a, b) => b.s - a.s);
      return (ranked[0] && ranked[0].s > 0 ? ranked[0].v : null) || this.voices[0];
    },

    /* ---- streaming queue ---- */
    _queue: [],
    _playing: false,
    _streamOpen: false,
    _startedOnce: false,

    startStream() {
      this.cancelStream();
      this._streamOpen = true;
      this._startedOnce = false;
    },
    enqueue(text, langHint) {
      if (!text) return;
      this._queue.push({ text, lang: langHint || this.detectLang(text) });
      this._pump();
    },
    endStream() {
      this._streamOpen = false;
      this._pump();
    },
    cancelStream() {
      this._queue = [];
      this._streamOpen = false;
      this._playing = false;
      this._curSource && (() => { try { this._curSource.onended = null; this._curSource.stop(); } catch (_) {} })();
      this._curSource = null;
      if (synth) synth.cancel();
    },
    speak(text, langHint) {
      this.startStream();
      this.enqueue(text, langHint);
      this.endStream();
    },

    _notifyStart() {
      if (!this._startedOnce) {
        this._startedOnce = true;
        this.onStreamStart && this.onStreamStart();
      }
      this.onUtteranceStart && this.onUtteranceStart();
    },

    _pump() {
      if (this._playing) return;
      const item = this._queue.shift();
      if (!item) {
        if (!this._streamOpen) this.onDrained && this.onDrained();
        return;
      }
      this._playing = true;
      this._playItem(item).then(() => {
        this._playing = false;
        this._pump();
      });
    },

    _playItem(item) {
      // Edge is a cloud voice; when offline, fall back to local browser voices.
      const online = navigator.onLine !== false;
      if (this.engine === "edge" && online) return this._playEdge(item);
      return this._playBrowser(item);
    },

    // Convert the Edge pitch (Hz) to the browser SpeechSynthesis pitch scale
    // (0..2, 1 = normal) so the "cute" setting carries over offline.
    _browserPitch() {
      return Math.max(0, Math.min(2, 1 + (this.edgePitchHz || 0) / 100));
    },

    _playEdge(item) {
      return new Promise((resolve) => {
        const done = () => { this.onUtteranceEnd && this.onUtteranceEnd(); resolve(); };
        (async () => {
          try {
            const voice = this._edgeVoiceFor(item.lang);
            const ratePct = Math.round((this.rate - 1) * 100);
            const rateStr = (ratePct >= 0 ? "+" : "") + ratePct + "%";
            const pitchStr = (this.edgePitchHz >= 0 ? "+" : "") + this.edgePitchHz + "Hz";
            const url = `/api/tts?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rateStr)}&pitch=${encodeURIComponent(pitchStr)}&text=${encodeURIComponent(item.text)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error("tts http " + res.status);
            const arr = await res.arrayBuffer();
            const ctx = this._ensureCtx();
            if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
            const buf = await ctx.decodeAudioData(arr);

            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this._analyser);
            this._curSource = src;

            const data = new Uint8Array(this._analyser.fftSize);
            let raf, finished = false;
            const loop = () => {
              this._analyser.getByteTimeDomainData(data);
              let sum = 0;
              for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
              const rms = Math.sqrt(sum / data.length);
              this.onAmplitude && this.onAmplitude(Math.min(1, rms * 3.6));
              raf = requestAnimationFrame(loop);
            };
            const finish = () => {
              if (finished) return;
              finished = true;
              clearTimeout(wd);
              cancelAnimationFrame(raf);
              this.onAmplitude && this.onAmplitude(0);
              this._curSource = null;
              done();
            };
            src.onended = finish;
            // Watchdog in case onended never fires (buffer duration + buffer).
            const wd = setTimeout(finish, buf.duration * 1000 + 2000);
            this._notifyStart();
            src.start();
            loop();
          } catch (e) {
            console.error("[edge tts]", e);
            this._playBrowser(item).then(resolve); // fall back for this sentence
          }
        })();
      });
    },

    _playBrowser(item) {
      return new Promise((resolve) => {
        if (!this.browserSupported) { resolve(); return; }
        const u = new SpeechSynthesisUtterance(item.text);
        const voice = this._pickVoice(item.lang);
        if (voice) u.voice = voice;
        u.lang = voice ? voice.lang : item.lang;
        u.rate = this.rate;
        u.pitch = this._browserPitch(); // carry the +Hz "cute" setting over

        let finished = false;
        const fin = () => {
          if (finished) return;
          finished = true;
          clearTimeout(watchdog);
          this.onUtteranceEnd && this.onUtteranceEnd();
          resolve();
        };
        u.onstart = () => this._notifyStart();
        u.onend = fin;
        u.onerror = fin;
        const watchdog = setTimeout(fin, Math.max(2000, (item.text.length / 11) * 1000 / (this.rate || 1)) + 3000);
        synth.speak(u);
      });
    },

    stop() {
      this.cancelStream();
    },
  };

  window.TTS = TTS;
})();
