/**
 * Browser-native text-to-speech for the AI Tutor chat teacher (window.speechSynthesis — no
 * backend involved, deliberately separate from the Kokoro TTS used by the curriculum session
 * pipeline). A module-level singleton: there is only ever one "currently speaking" utterance,
 * which is what lets any component call stopSpeaking() to interrupt narration regardless of
 * which component started it.
 */

let currentUtterance: SpeechSynthesisUtterance | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];

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

/**
 * Speaks text, resolving once it finishes (or fails). Cancels anything currently speaking first.
 * `ok: false` means the browser likely blocked audio (no `onstart`/`onend` within the timeout) —
 * callers should surface a "tap to hear the teacher" affordance in that case.
 */
export function speak(rawText: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) { resolve({ ok: false }); return; }
    const text = toSpeechText(rawText);
    if (!text) { resolve({ ok: true }); return; } // nothing to say isn't a failure

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(text);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = isUrduOrHindiText(text) ? "ur-PK" : "en-US";
    }
    utter.rate = 1.0;
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

export function stopSpeaking(): void {
  currentUtterance = null;
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

export function pauseSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.pause();
}

export function resumeSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.resume();
}
