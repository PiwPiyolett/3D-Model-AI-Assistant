/* Speech-to-text (listening).
 * Default: browser Web Speech API. Swap this module to upgrade to a premium
 * provider later — keep the same interface: start(), stop(), and the
 * on* callbacks. */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  const STT = {
    supported: Boolean(SR),
    recognizing: false,
    lang: "id-ID",
    _rec: null,

    // Callbacks (assigned by main.js)
    onStart: null,
    onResult: null,   // (finalText)
    onPartial: null,  // (interimText)
    onEnd: null,
    onError: null,    // (message)

    _make() {
      const rec = new SR();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.recognizing = true;
        this.onStart && this.onStart();
      };
      rec.onresult = (e) => {
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim && this.onPartial) this.onPartial(interim);
        if (final && this.onResult) this.onResult(final.trim());
      };
      rec.onerror = (e) => {
        this.onError && this.onError(e.error || "speech-error");
      };
      rec.onend = () => {
        this.recognizing = false;
        this.onEnd && this.onEnd();
      };
      return rec;
    },

    setLang(lang) {
      this.lang = lang;
    },

    start() {
      if (!this.supported || this.recognizing) return;
      this._rec = this._make();
      try {
        this._rec.start();
      } catch (e) {
        this.onError && this.onError(String(e));
      }
    },

    stop() {
      if (this._rec && this.recognizing) {
        try { this._rec.stop(); } catch (_) {}
      }
    },
  };

  window.STT = STT;
})();
