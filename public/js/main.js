/* Orchestrator: wires the mic, Claude, voice and the Live2D model together. */
(function () {
  const L = window.Live2DController;
  const $ = (id) => document.getElementById(id);

  const el = {
    loading: $("loading"),
    loadingText: $("loading-text"),
    canvas: $("live2d-canvas"),
    micBtn: $("mic-btn"),
    micLabel: document.querySelector(".mic-label"),
    textInput: $("text-input"),
    settingsBtn: $("settings-btn"),
    settingsPanel: $("settings-panel"),
    settingsClose: $("settings-close"),
    providerSelect: $("provider-select"),
    localModelRow: $("local-model-row"),
    localModelSelect: $("local-model-select"),
    ttsEngineSelect: $("tts-engine-select"),
    edgeVoiceRow: $("edge-voice-row"),
    edgeVoiceSelect: $("edge-voice-select"),
    edgePitchRow: $("edge-pitch-row"),
    edgePitchRange: $("edge-pitch-range"),
    edgePitchVal: $("edge-pitch-val"),
    voiceSelect: $("voice-select"),
    rateRange: $("rate-range"),
    sttLang: $("stt-lang"),
    autoListen: $("auto-listen"),
    captionBox: $("caption-box"),
    captionRole: $("caption-role"),
    captionText: $("caption-text"),
    captionTranslation: $("caption-translation"),
    replyLangSelect: $("reply-lang-select"),
    statusPill: $("status-pill"),
  };

  let state = "idle"; // idle | listening | thinking | speaking
  let busy = false;   // true while thinking/speaking (mic disabled)

  function setStatus(s, label) {
    state = s;
    el.statusPill.className = s;
    el.statusPill.textContent = label || s;
  }

  function showCaption(role, text) {
    el.captionRole.textContent = role;
    el.captionText.textContent = text;
    el.captionBox.classList.add("show");
  }
  function showTranslation(text) {
    el.captionTranslation.textContent = text ? "↳ " + text : "";
    el.captionTranslation.classList.toggle("show", Boolean(text));
  }
  function hideCaption() {
    el.captionBox.classList.remove("show");
    showTranslation("");
  }

  /* ---------- Core pipeline (streaming) ---------- */
  async function handleUserText(text) {
    if (!text || busy) return;
    busy = true;
    showCaption("Kamu", text);
    setStatus("thinking", "berpikir…");
    setMicListening(false);
    L.setThinking && L.setThinking(true);

    let captionText = "";
    let spoke = false;

    window.TTS.startStream();

    try {
      await window.Chat.sendStream(text, {
        onEmotion: (emotion) => {
          L.setThinking && L.setThinking(false);
          L.playExpression(emotion || "neutral");
          captionText = "";
          showCaption("Yuki", "");
          showTranslation("");
        },
        onSentence: (sentence) => {
          spoke = true;
          captionText = (captionText + " " + sentence).trim();
          showCaption("Yuki", captionText);
          window.TTS.enqueue(sentence);
        },
        onTranslation: (text) => showTranslation(text),
        onDone: () => {
          window.TTS.endStream(); // let the queue drain, then finishTurn
          if (!spoke) finishTurn(); // nothing was spoken (empty reply)
        },
        onError: (err) => {
          console.error(err);
          L.setThinking && L.setThinking(false);
          window.TTS.cancelStream();
          showCaption("Error", err.message || "Terjadi kesalahan.");
          setStatus("error", "error");
          L.playExpression("sad");
          busy = false;
        },
      });
    } catch (err) {
      console.error(err);
      L.setThinking && L.setThinking(false);
      busy = false;
      setStatus("error", "error");
    }
  }

  function finishTurn() {
    busy = false;
    setStatus("idle", "siap");
    if (el.autoListen.checked && window.STT.supported) {
      setTimeout(() => startListening(), 350);
    }
  }

  // Wire the TTS callbacks once. Mouth is driven by real audio amplitude for the
  // edge engine, or procedurally for the browser engine.
  function wireTTS() {
    window.TTS.onStreamStart = () => setStatus("speaking", "berbicara…");
    window.TTS.onUtteranceStart = () => { if (window.TTS.engine !== "edge") L.startSpeaking(); };
    window.TTS.onUtteranceEnd = () => L.stopSpeaking();
    window.TTS.onAmplitude = (a) => L.setMouthAmplitude(a);
    window.TTS.onDrained = () => {
      L.stopSpeaking();
      if (busy) finishTurn(); // ignore for the boot greeting (not a turn)
    };
  }

  /* ---------- Listening ---------- */
  function currentSttLang() {
    const v = el.sttLang.value;
    return v === "auto" ? "id-ID" : v;
  }

  function setMicListening(on) {
    el.micBtn.classList.toggle("listening", on);
    el.micLabel.textContent = on ? "Mendengar…" : "Bicara";
  }

  function startListening() {
    if (busy || window.STT.recognizing) return;
    if (navigator.onLine === false) {
      // Mic recognition needs the internet (browser sends audio to the cloud).
      showCaption("Yuki", "Mikrofonku lagi butuh internet nih... ketik aja dulu, ya!");
      showTranslation("(My mic needs internet — please type for now.)");
      return;
    }
    if (!window.STT.supported) return;
    window.STT.setLang(currentSttLang());
    window.STT.start();
  }

  function wireSTT() {
    if (!window.STT.supported) {
      el.micLabel.textContent = "Ketik saja";
      el.micBtn.title = "Browser ini tak mendukung mikrofon. Pakai kotak teks.";
      return;
    }
    window.STT.onStart = () => {
      setMicListening(true);
      setStatus("listening", "mendengar…");
      hideCaption();
    };
    window.STT.onPartial = (t) => showCaption("Kamu", t + "…");
    window.STT.onResult = (t) => handleUserText(t);
    window.STT.onEnd = () => {
      setMicListening(false);
      if (state === "listening") setStatus("idle", "siap");
    };
    window.STT.onError = (e) => {
      setMicListening(false);
      if (e === "no-speech") setStatus("idle", "siap");
      else setStatus("error", "mic: " + e);
    };
  }

  function toggleMic() {
    if (window.STT.recognizing) window.STT.stop();
    else startListening();
  }

  /* ---------- Settings ---------- */
  async function populateProviders() {
    try {
      const { providers, default: def } = await window.Chat.fetchProviders();
      el.providerSelect.innerHTML = "";
      providers.forEach((p) => {
        const o = document.createElement("option");
        o.value = p.id;
        const why = p.id === "local" ? " (Ollama belum jalan)" : " (no key)";
        o.textContent = p.label + (p.available ? "" : why);
        o.disabled = !p.available;
        el.providerSelect.appendChild(o);
      });
      el.providerSelect.value = def;
      window.Chat.provider = def;
      await populateModels();
      updateLocalModelVisibility();
    } catch (_) {}
  }

  // The list of local Ollama models (e.g. qwen2.5:7b, qwen2.5:3b).
  async function populateModels() {
    try {
      const { models, default: def } = await window.Chat.fetchModels();
      el.localModelSelect.innerHTML = "";
      (models || []).forEach((name) => {
        const o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        el.localModelSelect.appendChild(o);
      });
      const chosen = window.Chat.localModel || def;
      if (chosen && models.includes(chosen)) el.localModelSelect.value = chosen;
      window.Chat.localModel = el.localModelSelect.value || null;
    } catch (_) {}
  }

  // Only show the local-model picker when the local provider is selected.
  function updateLocalModelVisibility() {
    const isLocal = el.providerSelect.value === "local";
    el.localModelRow.style.display = isLocal ? "" : "none";
  }

  // Edge neural voices (from the backend).
  async function populateEdgeVoices() {
    try {
      const res = await fetch("/api/voices/edge");
      const { voices, default: def } = await res.json();
      el.edgeVoiceSelect.innerHTML = "";
      const auto = document.createElement("option");
      auto.value = ""; auto.textContent = "Otomatis (per bahasa)";
      el.edgeVoiceSelect.appendChild(auto);
      (voices || []).forEach((v) => {
        const o = document.createElement("option");
        o.value = v.id; o.textContent = v.label;
        el.edgeVoiceSelect.appendChild(o);
      });
      el.edgeVoiceSelect.value = window.TTS.edgeVoice || "";
    } catch (_) {}
  }
  function updateEngineVisibility() {
    const isEdge = window.TTS.engine === "edge";
    el.edgeVoiceRow.style.display = isEdge ? "" : "none";
    el.edgePitchRow.style.display = isEdge ? "" : "none";
  }

  function populateVoices() {
    const voices = window.TTS.voices;
    el.voiceSelect.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Otomatis (rekomendasi: cewek)";
    el.voiceSelect.appendChild(auto);
    // Indonesian first, then English; within each, best (female/quality) first.
    voices
      .filter((v) => /^(id|en)/i.test(v.lang))
      .map((v) => ({ v, s: window.TTS._score(v, v.lang.toLowerCase().startsWith("id") ? "id" : "en") }))
      .sort((a, b) => {
        const ai = a.v.lang.toLowerCase().startsWith("id") ? 0 : 1;
        const bi = b.v.lang.toLowerCase().startsWith("id") ? 0 : 1;
        return ai - bi || b.s - a.s;
      })
      .forEach(({ v, s }) => {
        const o = document.createElement("option");
        o.value = v.voiceURI;
        const tag = s >= 150 ? " ⭐" : ""; // female + language match
        o.textContent = `${v.name} (${v.lang})${tag}`;
        el.voiceSelect.appendChild(o);
      });
  }

  function wireUI() {
    // Any first user gesture unlocks audio playback (browser autoplay policy).
    const unlock = () => window.TTS.resumeAudio && window.TTS.resumeAudio();
    document.addEventListener("pointerdown", unlock, { once: false });

    el.micBtn.addEventListener("click", () => { unlock(); toggleMic(); });

    el.textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && el.textInput.value.trim()) {
        unlock();
        const t = el.textInput.value.trim();
        el.textInput.value = "";
        handleUserText(t);
      }
    });

    // Spacebar = push to talk (when not typing).
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && document.activeElement !== el.textInput) {
        e.preventDefault();
        if (!window.STT.recognizing) startListening();
      }
    });

    el.settingsBtn.addEventListener("click", () => {
      populateVoices();
      populateProviders();
      populateEdgeVoices();
      el.ttsEngineSelect.value = window.TTS.engine;
      updateEngineVisibility();
      el.settingsPanel.classList.toggle("hidden");
    });
    el.replyLangSelect.value = window.Chat.replyLang;
    el.replyLangSelect.addEventListener("change", () => {
      window.Chat.replyLang = el.replyLangSelect.value;
    });
    el.ttsEngineSelect.addEventListener("change", () => {
      window.TTS.engine = el.ttsEngineSelect.value;
      updateEngineVisibility();
    });
    el.edgeVoiceSelect.addEventListener("change", () => {
      window.TTS.edgeVoice = el.edgeVoiceSelect.value || null;
    });
    const syncPitch = () => {
      window.TTS.edgePitchHz = parseInt(el.edgePitchRange.value, 10);
      el.edgePitchVal.textContent = (window.TTS.edgePitchHz >= 0 ? "+" : "") + window.TTS.edgePitchHz + "Hz";
    };
    el.edgePitchRange.addEventListener("input", syncPitch);
    el.edgePitchRange.value = window.TTS.edgePitchHz;
    syncPitch();
    el.providerSelect.addEventListener("change", () => {
      window.Chat.provider = el.providerSelect.value;
      window.Chat.reset();
      updateLocalModelVisibility();
    });
    el.localModelSelect.addEventListener("change", () => {
      window.Chat.localModel = el.localModelSelect.value || null;
      window.Chat.reset();
    });
    el.settingsClose.addEventListener("click", () =>
      el.settingsPanel.classList.add("hidden")
    );
    el.voiceSelect.addEventListener("change", () => {
      window.TTS.voiceURI = el.voiceSelect.value || null;
    });
    el.rateRange.addEventListener("input", () => {
      window.TTS.rate = parseFloat(el.rateRange.value);
    });
  }

  /* ---------- Boot ---------- */
  async function boot() {
    window.TTS.init();
    wireTTS();
    wireSTT();
    wireUI();

    try {
      el.loadingText.textContent = "Memuat model…";
      await L.init(el.canvas);
      el.loading.classList.add("hidden");
      setStatus("idle", "siap");

      // A tsundere opener. Default persona speaks Japanese with an English sub.
      L.greet();
      setTimeout(() => {
        const helloJa = "ふん、やっと来たわね。べ、別にあんたを待ってたわけじゃないんだから！";
        const helloEn = "Hmph, you finally came. I-it's not like I was waiting for you or anything!";
        showCaption("Yuki", helloJa);
        showTranslation(helloEn);
        window.TTS.speak(helloJa, "ja-JP");
      }, 600);
    } catch (err) {
      console.error(err);
      el.loadingText.textContent = "Gagal memuat model. Cek console (F12).";
    }
  }

  window.addEventListener("DOMContentLoaded", boot);
})();
