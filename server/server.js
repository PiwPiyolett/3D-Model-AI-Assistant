import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// --- Static assets -------------------------------------------------------
app.use(express.static(path.join(ROOT, "public")));

const MODEL_DIR = path.join(ROOT, "2D Model", "IceGIrl Live2D");

app.get("/model/IceGirl.model3.json", (_req, res) => {
  try {
    const raw = fs.readFileSync(path.join(MODEL_DIR, "IceGirl.model3.json"), "utf8");
    const json = JSON.parse(raw);
    const files = fs.readdirSync(MODEL_DIR);

    const expressions = files
      .filter((f) => f.endsWith(".exp3.json"))
      .map((f) => ({ Name: f.replace(/\.exp3\.json$/, ""), File: f }));

    const motions = {};
    for (const f of files.filter((f) => f.endsWith(".motion3.json"))) {
      const name = f.replace(/\.motion3\.json$/, "");
      const group = name === "DaiJi" ? "Idle" : name;
      (motions[group] ||= []).push({ File: f });
    }

    json.FileReferences.Expressions = expressions;
    json.FileReferences.Motions = motions;
    json.Groups = [
      { Target: "Parameter", Name: "EyeBlink", Ids: ["ParamEyeLOpen", "ParamEyeROpen"] },
      { Target: "Parameter", Name: "LipSync", Ids: ["ParamMouthOpenY"] },
    ];

    res.type("application/json").send(JSON.stringify(json));
  } catch (err) {
    console.error("[model3.json augment]", err?.message || err);
    res.sendFile(path.join(MODEL_DIR, "IceGirl.model3.json"));
  }
});

app.use("/model", express.static(MODEL_DIR));

// --- Personality engine --------------------------------------------------
// Yuki's character lives in personality.json so it can be tuned without code.
// We compile that config into the system prompt sent to every model.
function loadPersonality() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "personality.json"), "utf8"));
  } catch (e) {
    console.error("[personality] failed to load personality.json:", e?.message || e);
    return null;
  }
}

function buildSystemPrompt(p) {
  if (!p) return "You are Yuki, a cute tsundere anime companion. Reply in 1-2 short spoken sentences.";
  const L = [];
  L.push(`You are "${p.name}", a ${p.archetype}. Theme: ${p.theme}.`);
  if (p.backstory) L.push(p.backstory);
  L.push("", "LANGUAGE:", "- " + p.language);
  if (p.personality) {
    L.push("", "PERSONALITY DIALS (0-10, higher = stronger):");
    L.push("- " + Object.entries(p.personality).map(([k, v]) => `${k}: ${v}`).join(", "));
  }
  if (p.speakingStyle) {
    L.push("", "HOW YOU SPEAK:");
    if (p.speakingStyle.responseLength) L.push("- " + p.speakingStyle.responseLength);
    if (p.speakingStyle.noText) L.push("- " + p.speakingStyle.noText);
    (p.speakingStyle.quirks || []).forEach((q) => L.push("- " + q));
  }
  L.push("", "ABSOLUTE RULES (never break these):");
  (p.hardRules || []).forEach((r) => L.push("- " + r));
  L.push("", "EMOTION TAG (required):");
  L.push(`- Start EVERY reply with exactly ONE tag from: ${(p.emotionTags || []).map((e) => `[${e}]`).join(" ")}`);
  L.push("- Put it once, at the very beginning, then a space, then your spoken words. A tsundere often feels [shy], [angry], or [playful].");
  if (p.fewShot && p.fewShot.length) {
    L.push("", "EXAMPLES — match this tsundere vibe (do NOT reuse the lines verbatim):");
    p.fewShot.forEach((ex) => {
      L.push(`User: ${ex.user}`);
      L.push(`${p.name}: ${ex.yuki}`);
    });
  }
  return L.join("\n");
}

let personality = loadPersonality();
let SYSTEM_PROMPT = buildSystemPrompt(personality);

// =========================================================================
// AI PROVIDERS — modular multi-provider system
// =========================================================================

// --- Provider: Gemini (Google AI Studio) ----------------------------------
async function chatGemini(messages, opts = {}) {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY belum di-set di server/.env");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    systemInstruction: opts.system || SYSTEM_PROMPT,
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content ?? "") }],
  }));

  const chat = model.startChat({ history });
  const last = messages[messages.length - 1];
  const result = await chat.sendMessage(String(last.content ?? ""));
  return result.response.text();
}

// --- Provider: Claude (Anthropic) -----------------------------------------
async function chatClaude(messages, opts = {}) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY belum di-set di server/.env");

  const anthropic = new Anthropic({ apiKey: key });
  const trimmed = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? ""),
  }));

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: opts.system || SYSTEM_PROMPT,
    messages: trimmed,
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// --- Provider: OpenAI (ChatGPT) -------------------------------------------
async function chatOpenAI(messages, opts = {}) {
  const { default: OpenAI } = await import("openai");
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY belum di-set di server/.env");

  const openai = new OpenAI({ apiKey: key });
  const msgs = [
    { role: "system", content: opts.system || SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    })),
  ];

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    max_tokens: 400,
    messages: msgs,
  });

  return response.choices[0].message.content;
}

// --- Provider: Local (Ollama, e.g. Qwen 2.5) ------------------------------
// Ollama exposes an OpenAI-compatible API at /v1, so we reuse the OpenAI SDK
// pointed at localhost. No API key needed (runs entirely on this machine).
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

async function chatLocal(messages, opts = {}) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: `${OLLAMA_BASE}/v1`, apiKey: "ollama" });

  const msgs = [
    { role: "system", content: opts.system || SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    })),
  ];

  const response = await client.chat.completions.create({
    model: opts.model || OLLAMA_MODEL, // caller can pick which local model
    messages: msgs,
    max_tokens: 400,
    temperature: 0.8,
  });

  return response.choices[0].message.content;
}

// List the local models installed in Ollama (for the settings model picker).
async function listOllamaModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name).sort();
  } catch {
    return [];
  }
}

// Is the local Ollama server reachable (and does it have the model)?
async function pingOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Provider router -------------------------------------------------------
// Each provider reports availability: local pings Ollama, cloud checks its key.
const PROVIDERS = {
  local: {
    fn: chatLocal,
    label: `Local · ${OLLAMA_MODEL} (Ollama)`,
    available: pingOllama,
  },
  gemini: {
    fn: chatGemini,
    label: "Gemini",
    available: async () => Boolean(process.env.GEMINI_API_KEY),
  },
  claude: {
    fn: chatClaude,
    label: "Claude",
    available: async () => Boolean(process.env.ANTHROPIC_API_KEY),
  },
  openai: {
    fn: chatOpenAI,
    label: "OpenAI (ChatGPT)",
    available: async () => Boolean(process.env.OPENAI_API_KEY),
  },
};

// First available provider (object order = priority: local first, then cloud).
async function resolveDefaultProvider() {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (await p.available()) return id;
  }
  return "local";
}

// Per-request language directive appended to the system prompt. For Japanese we
// ask for the spoken line, then " @@ ", then an Indonesian translation.
const TRANSLATION_MARK = "@@";
function systemFor(replyLang) {
  if (replyLang === "ja") {
    return SYSTEM_PROMPT +
      `\n\n==================== CRITICAL OUTPUT RULE (overrides EVERYTHING above) ====================\n` +
      `The example lines and language rules above only define your PERSONALITY and TONE — NOT the language.\n` +
      `No matter what language the user writes in, your reply MUST be written in JAPANESE. Do NOT reply in Indonesian or English.\n` +
      `Exact format for EVERY reply:\n` +
      `[emotion] <your line ONLY in natural casual anime-style Japanese, 1-2 short sentences, tsundere> ${TRANSLATION_MARK} <an ENGLISH translation of that Japanese line>\n` +
      `The Japanese part before ${TRANSLATION_MARK} must contain Japanese characters (ひらがな/カタカナ/漢字). The part after ${TRANSLATION_MARK} must be English.\n` +
      `Example: [shy] べ、別にあんたのために来たわけじゃないんだからね！ ${TRANSLATION_MARK} I-it's not like I came here for you or anything!`;
  }
  if (replyLang === "id") return SYSTEM_PROMPT + "\n\nLANGUAGE OVERRIDE: Reply in Bahasa Indonesia.";
  if (replyLang === "en") return SYSTEM_PROMPT + "\n\nLANGUAGE OVERRIDE: Reply in English.";
  return SYSTEM_PROMPT; // auto -> follow the user's language
}

// Extract the emotion and clean the spoken text. Robust to smaller local
// models that place the tag anywhere (or repeat it), or prefix a name.
const EMOTIONS = ["neutral", "happy", "excited", "love", "shy", "angry", "sad", "surprised", "confused", "playful"];
// Map the non-standard tags smaller models sometimes invent onto our set.
const EMOTION_SYNONYMS = {
  hesitant: "shy", nervous: "shy", embarrassed: "shy", blush: "shy", flustered: "shy",
  thinking: "confused", curious: "confused", pensive: "confused",
  annoyed: "angry", mad: "angry", tsun: "angry", pouting: "angry", grumpy: "angry",
  cheerful: "happy", smile: "happy", warm: "happy",
  laugh: "playful", teasing: "playful", smug: "playful", mischievous: "playful",
  cry: "sad", down: "sad",
  shocked: "surprised", amazed: "surprised",
  affection: "love", fond: "love",
};
function parseReply(raw) {
  // First bracketed tag anywhere, e.g. [shy] or [Hesitant].
  const first = raw.match(/\[\s*([a-zA-Z][a-zA-Z\s\-]{0,20})\s*\]/);
  let emotion = "neutral";
  if (first) {
    const t = first[1].trim().toLowerCase().split(/\s|-/)[0];
    emotion = EMOTIONS.includes(t) ? t : (EMOTION_SYNONYMS[t] || "neutral");
  }
  const reply = raw
    .replace(/\[\/?[a-zA-Z][a-zA-Z\s\-]{0,20}\]/g, " ")  // strip ALL tag-like brackets
    .replace(/^\s*(yuki|assistant|ai)\s*[:：]\s*/i, "")   // strip a leading name prefix
    .replace(/\s{2,}/g, " ")
    .trim();
  return { reply, emotion };
}

// Strip tag-like brackets and collapse whitespace (for spoken text).
// Handles opening [tag] and closing [/tag] variants.
function stripTags(s) {
  return s.replace(/\[\/?[a-zA-Z][a-zA-Z\s\-]{0,20}\]/g, " ").replace(/\s{2,}/g, " ").trim();
}
// Split a full reply into sentences (fallback path). Handles Japanese too.
function splitSentences(t) {
  return t.split(/(?<=[.!?…])\s+|(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
}
// Index to cut the buffer at the end of the first complete sentence, else -1.
// Japanese enders (。！？) cut immediately; ASCII enders need a trailing space/end.
function sentenceCut(s) {
  const jp = s.search(/[。！？]/);
  const m = s.match(/[.!?…]+(?=\s|$)/);
  const asc = m ? m.index + m[0].length - 1 : -1;
  let idx = -1;
  if (jp !== -1) idx = jp;
  if (asc !== -1 && (idx === -1 || asc < idx)) idx = asc;
  return idx >= 1 ? idx : -1;
}
function tagToEmotion(tag) {
  const t = tag.trim().toLowerCase().split(/\s|-/)[0];
  return EMOTIONS.includes(t) ? t : (EMOTION_SYNONYMS[t] || "neutral");
}
// Split a reply into [spokenText, translationText] on the @@ marker.
function splitTranslation(text) {
  const i = text.indexOf(TRANSLATION_MARK);
  if (i === -1) return [text.trim(), ""];
  return [text.slice(0, i).trim(), text.slice(i + TRANSLATION_MARK.length).trim()];
}

// Translate text to a target language via the LLM (used to guarantee Japanese
// speech + an English subtitle even if the model doesn't comply on its own).
async function translateTo(providerName, text, targetLangName, model) {
  const sys = `You are a translator. Translate the given text into natural, casual ${targetLangName}. ` +
    `Output ONLY the ${targetLangName} translation — no quotes, no notes, no original text, no romaji, no explanations.`;
  const fn = (PROVIDERS[providerName] && PROVIDERS[providerName].fn) || chatLocal;
  const out = await fn([{ role: "user", content: text }], { model, system: sys });
  return stripTags(String(out || "")).trim();
}
function hasJapanese(s) {
  return /[぀-ヿ㐀-䶿一-鿿]/.test(s || "");
}
// Hiragana/katakana presence — the reliable signal that text is really Japanese
// (not Chinese, which shares kanji). Used to reject mixed-language replies.
function hasKana(s) {
  return /[぀-ゟ゠-ヿ]/.test(s || "");
}
function looksJapanese(s) {
  if (!hasKana(s)) return false;
  const jp = (s.match(/[぀-ヿ㐀-䶿一-鿿]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  return jp >= latin; // at least as much Japanese as Latin
}

// Streaming chat for providers with an OpenAI-compatible streaming API
// (local Ollama + OpenAI). Returns an async-iterable stream, or null.
async function streamChat(providerName, messages, opts = {}) {
  const { default: OpenAI } = await import("openai");
  let client, model;
  if (providerName === "local") {
    client = new OpenAI({ baseURL: `${OLLAMA_BASE}/v1`, apiKey: "ollama" });
    model = opts.model || OLLAMA_MODEL;
  } else if (providerName === "openai") {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY belum di-set.");
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  } else {
    return null; // provider has no streaming here -> caller falls back
  }
  const msgs = [
    { role: "system", content: opts.system || SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content ?? ""),
    })),
  ];
  return client.chat.completions.create({
    model, messages: msgs, max_tokens: 400, temperature: 0.85, stream: true,
  });
}

// --- Streaming chat endpoint (Server-Sent Events) ------------------------
// Emits: `emotion` (once, early), `sentence` (each complete sentence),
// `done`, or `error`. Lets Yuki start speaking before the reply finishes.
app.post("/api/chat/stream", async (req, res) => {
  const { messages, provider: reqProvider, model, replyLang } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages (array) diperlukan." });
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const providerName = reqProvider || (await resolveDefaultProvider());
    const system = systemFor(replyLang);
    const trimmed = messages.slice(-20);

    // Japanese mode: generate fully, then guarantee Japanese speech + English
    // subtitle (translate if the model didn't comply). Replies are short.
    if (replyLang === "ja") {
      const raw = (await PROVIDERS[providerName].fn(trimmed, { model, system })).trim();
      const { reply, emotion } = parseReply(raw);
      let [spoken, modelTrans] = splitTranslation(reply);
      spoken = spoken || reply;
      // Guarantee clean Japanese speech: if the reply isn't predominantly
      // Japanese (mixed/other language), translate the whole thing to Japanese.
      if (!looksJapanese(spoken)) {
        const jp = await translateTo(providerName, spoken, "Japanese", model).catch(() => "");
        if (jp) spoken = jp;
      }
      // Guarantee an ENGLISH subtitle: trust the model's only if it's clean
      // Latin-script English; otherwise translate the Japanese ourselves.
      let translation = modelTrans && !hasJapanese(modelTrans) ? modelTrans : "";
      if (!translation && spoken) {
        translation = await translateTo(providerName, spoken, "English", model).catch(() => "");
      }
      send("emotion", { emotion });
      for (const s of splitSentences(spoken)) send("sentence", { text: s });
      if (translation) send("translation", { text: translation });
      send("done", { text: spoken });
      return res.end();
    }

    let stream = null;
    try {
      stream = await streamChat(providerName, trimmed, { model, system });
    } catch (e) {
      console.error("[stream] falling back:", e?.message || e);
    }

    if (!stream) {
      const raw = (await PROVIDERS[providerName].fn(trimmed, { model, system })).trim();
      const { reply, emotion } = parseReply(raw);
      const [spoken, translation] = splitTranslation(reply);
      send("emotion", { emotion });
      for (const s of splitSentences(spoken)) send("sentence", { text: s });
      if (translation) send("translation", { text: translation });
      send("done", { text: reply });
      return res.end();
    }

    let buffer = "", emotionSent = false, sawMark = false, transBuf = "", full = "";
    const flushSentences = () => {
      let cut;
      while ((cut = sentenceCut(buffer)) !== -1) {
        const piece = stripTags(buffer.slice(0, cut + 1));
        buffer = buffer.slice(cut + 1);
        if (piece) { send("sentence", { text: piece }); full += piece + " "; }
      }
    };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (!delta) continue;

      if (sawMark) { transBuf += delta; continue; } // everything after @@ = translation
      buffer += delta;

      if (!emotionSent) {
        const m = buffer.match(/\[\s*([a-zA-Z][a-zA-Z\s\-]{0,20})\s*\]/);
        if (m) {
          send("emotion", { emotion: tagToEmotion(m[1]) });
          emotionSent = true;
          buffer = buffer.slice(0, m.index) + buffer.slice(m.index + m[0].length);
        } else if (buffer.length > 48) {
          send("emotion", { emotion: "neutral" });
          emotionSent = true;
        } else {
          continue; // wait for the emotion tag
        }
      }

      const mi = buffer.indexOf(TRANSLATION_MARK);
      if (mi !== -1) {
        transBuf += buffer.slice(mi + TRANSLATION_MARK.length);
        buffer = buffer.slice(0, mi);
        sawMark = true;
        flushSentences();
        const rest = stripTags(buffer);
        if (rest) { send("sentence", { text: rest }); full += rest + " "; }
        buffer = "";
        continue;
      }
      flushSentences();
    }

    if (!emotionSent) send("emotion", { emotion: "neutral" });
    if (!sawMark) {
      const rest = stripTags(buffer);
      if (rest) { send("sentence", { text: rest }); full += rest; }
    }
    const translation = stripTags(transBuf);
    if (translation) send("translation", { text: translation });
    send("done", { text: full.trim() });
  } catch (err) {
    console.error("[/api/chat/stream]", err?.message || err);
    try { send("error", { error: err?.message || "stream error" }); } catch (_) {}
  }
  res.end();
});

// --- Chat endpoint (non-streaming) ---------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, provider: reqProvider, model, replyLang } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages (array) diperlukan." });
    }

    const providerName = reqProvider || (await resolveDefaultProvider());
    const provider = PROVIDERS[providerName];
    if (!provider) {
      return res.status(400).json({ error: `Provider "${providerName}" tidak dikenal.` });
    }

    const trimmed = messages.slice(-20);

    const raw = (await provider.fn(trimmed, { model, system: systemFor(replyLang) })).trim();
    const { reply, emotion } = parseReply(raw);
    let [spoken, modelTrans] = splitTranslation(reply);
    spoken = spoken || reply;
    let translation = modelTrans;
    if (replyLang === "ja") {
      if (!looksJapanese(spoken)) {
        const jp = await translateTo(providerName, spoken, "Japanese", model).catch(() => "");
        if (jp) spoken = jp;
      }
      translation = modelTrans && !hasJapanese(modelTrans) ? modelTrans : "";
      if (!translation && spoken) translation = await translateTo(providerName, spoken, "English", model).catch(() => "");
    }

    res.json({ reply: spoken, translation, emotion, provider: providerName, model: model || undefined });
  } catch (err) {
    console.error("[/api/chat]", err?.message || err);
    res.status(500).json({ error: err?.message || "Gagal memanggil AI." });
  }
});

// --- Info endpoint: tells the frontend which providers are usable ---------
app.get("/api/providers", async (_req, res) => {
  const list = await Promise.all(
    Object.entries(PROVIDERS).map(async ([id, p]) => ({
      id,
      label: p.label,
      available: await p.available(),
    }))
  );
  const def = list.find((p) => p.available)?.id || "local";
  res.json({ providers: list, default: def });
});

// Local models installed in Ollama, for the settings model picker.
app.get("/api/models", async (_req, res) => {
  const models = await listOllamaModels();
  res.json({ models, default: OLLAMA_MODEL });
});

// --- Edge TTS (free Microsoft neural voices, no API key) ------------------
// Curated voices for Yuki (female neural). Frontend picks by language/choice.
const EDGE_VOICES = [
  { id: "id-ID-GadisNeural", label: "Gadis — Indonesian (female)", lang: "id" },
  { id: "en-US-AriaNeural", label: "Aria — English US (female)", lang: "en" },
  { id: "en-US-JennyNeural", label: "Jenny — English US (female)", lang: "en" },
  { id: "ja-JP-NanamiNeural", label: "Nanami — Japanese (female, anime-ish)", lang: "ja" },
  { id: "en-GB-SoniaNeural", label: "Sonia — English UK (female)", lang: "en" },
];

app.get("/api/voices/edge", (_req, res) => {
  res.json({ voices: EDGE_VOICES, default: "id-ID-GadisNeural" });
});

// Synthesize one utterance to an MP3 Buffer via Edge TTS.
async function synthEdge(voice, text, rate, pitch) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  // Prosody (rate/pitch) belongs on toStream, not setMetadata.
  const { audioStream } = tts.toStream(text, { rate, pitch });
  return await new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on("data", (c) => chunks.push(c));
    audioStream.on("end", () => resolve(Buffer.concat(chunks)));
    audioStream.on("error", reject);
    setTimeout(() => reject(new Error("edge tts timeout")), 15000);
  });
}

// Synthesize text -> MP3. Buffered with a retry so a transient DNS/network
// blip to Microsoft's endpoint doesn't drop the sentence.
app.get("/api/tts", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 1200).trim();
  const voice = String(req.query.voice || "id-ID-GadisNeural");
  const rate = String(req.query.rate || "+0%");
  const pitch = String(req.query.pitch || "+8Hz"); // slightly higher = cuter
  if (!text) return res.status(400).json({ error: "text diperlukan." });

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buf = await synthEdge(voice, text, rate, pitch);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.end(buf);
    } catch (e) {
      lastErr = e;
      console.error(`[/api/tts] attempt ${attempt} failed:`, e?.message || e);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  res.status(500).json({ error: lastErr?.message || "tts error" });
});

// Reload personality.json without restarting (handy while tuning Yuki).
app.post("/api/personality/reload", (_req, res) => {
  personality = loadPersonality();
  SYSTEM_PROMPT = buildSystemPrompt(personality);
  res.json({ ok: Boolean(personality), name: personality?.name, archetype: personality?.archetype });
});

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, defaultProvider: await resolveDefaultProvider() });
});

app.listen(PORT, () => {
  console.log(`\n  IceGirl AI Assistant`);
  console.log(`  ➜  http://localhost:${PORT}`);
  console.log(`  Local model: ${OLLAMA_MODEL}  (Ollama @ ${OLLAMA_BASE})`);
  console.log(`  Cloud keys: ${["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"].filter((k) => process.env[k]).join(", ") || "(none)"}\n`);
});
