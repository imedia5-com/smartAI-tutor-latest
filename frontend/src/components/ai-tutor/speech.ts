/**
 * Browser-native text-to-speech for the AI Tutor chat teacher (window.speechSynthesis — no
 * backend involved, deliberately separate from the Kokoro TTS used by the curriculum session
 * pipeline). A module-level singleton: there is only ever one "currently speaking" utterance,
 * which is what lets any component call stopSpeaking() to interrupt narration regardless of
 * which component started it.
 */

let currentUtterance: SpeechSynthesisUtterance | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let generation = 0;

export type SpeechSpeed = "slow" | "normal" | "fast";
const SPEED_KEY = "ai_tutor_speech_speed";

// Baseline rate by lesson level, then adjusted by the learner's own slow/normal/fast choice —
// kids need a slightly slower default than the browser's native 1.0, but not a crawl.
const LEVEL_BASE_RATE: Record<string, number> = { low: 0.88, medium: 0.95, high: 1.0 };
const SPEED_MULTIPLIER: Record<SpeechSpeed, number> = { slow: 0.85, normal: 1, fast: 1.15 };
const SENTENCE_PAUSE_MS = 250;

export function getSpeechSpeed(): SpeechSpeed {
  const v = typeof window !== "undefined" ? window.localStorage.getItem(SPEED_KEY) : null;
  return v === "slow" || v === "fast" ? v : "normal";
}

export function setSpeechSpeed(speed: SpeechSpeed): void {
  window.localStorage.setItem(SPEED_KEY, speed);
}

function computeRate(level: string): number {
  const base = LEVEL_BASE_RATE[level] ?? LEVEL_BASE_RATE.medium;
  const rate = base * SPEED_MULTIPLIER[getSpeechSpeed()];
  return Math.min(1.3, Math.max(0.5, rate));
}

/** Split already-markdown-stripped text into sentence/list-item pieces so speak() can insert a
 * short pause between them — the Web Speech API has no SSML-style pause markup of its own. */
function splitIntoSpeechPieces(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
  return cachedVoices;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  loadVoices();
  // Voices often load asynchronously on first page load.
  window.speechSynthesis.onvoiceschanged = () => loadVoices();
}

/** Strip markdown and LaTeX so speech doesn't read out symbols like "asterisk" or "dollar sign". */
export function toSpeechText(raw: string): string {
  let t = raw || "";
  t = t.replace(/\$\$[\s\S]*?\$\$/g, " ");
  t = t.replace(/\$[^$\n]*\$/g, " ");
  t = t.replace(/\\\[[\s\S]*?\\\]/g, " ");
  t = t.replace(/\\\([\s\S]*?\\\)/g, " ");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/[*_#>~]+/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/** Arabic script (Urdu) or Devanagari (Hindi) — anything else falls back to English. */
function isUrduOrHindiText(text: string): boolean {
  return /[؀-ۿऀ-ॿ]/.test(text);
}

function pickVoice(text: string): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (!voices.length) return null;
  if (isUrduOrHindiText(text)) {
    const match = voices.find((v) => /^(ur|hi)/i.test(v.lang));
    if (match) return match;
  }
  // A few well-known friendly-sounding voices, if installed; otherwise any English voice.
  const preferred = ["Google US English", "Samantha", "Microsoft Aria Online (Natural)", "Microsoft Jenny Online (Natural)"];
  for (const name of preferred) {
    const m = voices.find((v) => v.name === name);
    if (m) return m;
  }
  return voices.find((v) => /^en/i.test(v.lang)) || voices[0];
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Fires a near-silent utterance synchronously inside a click handler, to register the page's
 * use of speechSynthesis under a real user gesture as early as possible (Chrome is more likely
 * to allow later async speak() calls — e.g. once a lesson finishes generating — if the page has
 * already used speech synthesis under a direct click). Safe to call even where unsupported. */
export function primeSpeech(): void {
  if (!isSpeechSupported()) return;
  try {
    const utter = new SpeechSynthesisUtterance(" ");
    utter.volume = 0;
    window.speechSynthesis.speak(utter);
  } catch { /* best-effort only */ }
}

function speakPiece(text: string, rate: number): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(text);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = isUrduOrHindiText(text) ? "ur-PK" : "en-US";
    }
    utter.rate = rate;
    utter.pitch = 1.05; // slightly warmer than the default monotone

    let settled = false;
    const blockedTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false });
    }, 1200);

    utter.onstart = () => clearTimeout(blockedTimer);
    utter.onend = () => {
      if (settled) return;
      settled = true;
      clearTimeout(blockedTimer);
      if (currentUtterance === utter) currentUtterance = null;
      resolve({ ok: true });
    };
    utter.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(blockedTimer);
      if (currentUtterance === utter) currentUtterance = null;
      resolve({ ok: false });
    };

    currentUtterance = utter;
    try {
      window.speechSynthesis.speak(utter);
    } catch {
      settled = true;
      clearTimeout(blockedTimer);
      resolve({ ok: false });
    }
  });
}

/**
 * Speaks text, resolving once it finishes (or fails). Cancels anything currently speaking first.
 * Splits into sentences/list items with a short pause between them, and paces the rate from the
 * lesson level plus the learner's own slow/normal/fast choice.
 * `ok: false` means the browser likely blocked audio (no `onstart`/`onend` within the timeout) —
 * callers should surface a "tap to hear the teacher" affordance in that case.
 */
export function speak(rawText: string, level: string = "medium"): Promise<{ ok: boolean }> {
  const myGeneration = ++generation;
  return new Promise((resolve) => {
    if (!isSpeechSupported()) { resolve({ ok: false }); return; }
    const text = toSpeechText(rawText);
    if (!text) { resolve({ ok: true }); return; } // nothing to say isn't a failure

    window.speechSynthesis.cancel();
    const pieces = splitIntoSpeechPieces(text);
    const rate = computeRate(level);

    (async () => {
      for (let i = 0; i < pieces.length; i++) {
        if (generation !== myGeneration) { resolve({ ok: true }); return; } // interrupted, not blocked
        const { ok } = await speakPiece(pieces[i], rate);
        if (generation !== myGeneration) { resolve({ ok: true }); return; }
        if (i === 0 && !ok) { resolve({ ok: false }); return; } // first piece blocked = real failure
        if (i < pieces.length - 1) {
          await delay(SENTENCE_PAUSE_MS);
          if (generation !== myGeneration) { resolve({ ok: true }); return; }
        }
      }
      resolve({ ok: true });
    })();
  });
}

export function stopSpeaking(): void {
  generation++;
  currentUtterance = null;
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

export function pauseSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.pause();
}

export function resumeSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.resume();
}
