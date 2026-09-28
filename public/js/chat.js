/* Talks to the backend AI. Supports multiple providers (Gemini, Claude, OpenAI). */
(function () {
  const cfg = window.APP_CONFIG;

  const Chat = {
    history: [],
    provider: null,   // null = server picks default
    localModel: null, // which Ollama model to use (when provider = local)
    replyLang: "ja", // "auto" | "id" | "en" | "ja" (default: Japanese + English subs)

    async send(userText) {
      this.history.push({ role: "user", content: userText });

      const body = { messages: this.history };
      if (this.provider) body.provider = this.provider;
      if (this.localModel) body.model = this.localModel;

      const res = await fetch(cfg.chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      this.history.push({ role: "assistant", content: data.reply });
      return data;
    },

    // Streaming send: reads Server-Sent Events and fires callbacks as Yuki's
    // reply is generated (emotion first, then each sentence).
    async sendStream(userText, { onEmotion, onSentence, onTranslation, onDone, onError } = {}) {
      this.history.push({ role: "user", content: userText });
      const body = { messages: this.history };
      if (this.provider) body.provider = this.provider;
      if (this.localModel) body.model = this.localModel;
      if (this.replyLang && this.replyLang !== "auto") body.replyLang = this.replyLang;

      let full = "";
      try {
        const res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            const ev = /event:\s*(.*)/.exec(block)?.[1]?.trim();
            const dataLine = /data:\s*([\s\S]*)/.exec(block)?.[1];
            if (!ev || !dataLine) continue;
            let data;
            try { data = JSON.parse(dataLine); } catch { continue; }
            if (ev === "emotion") onEmotion && onEmotion(data.emotion);
            else if (ev === "sentence") { full += data.text + " "; onSentence && onSentence(data.text); }
            else if (ev === "translation") onTranslation && onTranslation(data.text);
            else if (ev === "error") throw new Error(data.error);
            // "done" handled after loop
          }
        }
        this.history.push({ role: "assistant", content: full.trim() });
        onDone && onDone(full.trim());
      } catch (e) {
        onError && onError(e);
      }
    },

    async fetchProviders() {
      const res = await fetch("/api/providers");
      return res.json();
    },

    async fetchModels() {
      const res = await fetch("/api/models");
      return res.json();
    },

    reset() {
      this.history = [];
    },
  };

  window.Chat = Chat;
})();
