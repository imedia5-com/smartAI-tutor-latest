import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin wrapper over the browser's native SpeechRecognition (Web Speech API) for the
 * AI Tutor "Speak" option. No server STT — if the browser doesn't support it, `supported`
 * is false and the caller should fall back to typing.
 */
export type SpeechState = "idle" | "listening" | "error";

interface Options {
  onError?: (message: string) => void;
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useSpeechRecognition(opts: Options = {}) {
  const [state, setState] = useState<SpeechState>("idle");
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const finalTextRef = useRef("");
  const onErrorRef = useRef(opts.onError);
  onErrorRef.current = opts.onError;

  const supported = !!getSpeechRecognitionCtor();

  const start = useCallback((lang: string = "en-US") => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      onErrorRef.current?.("Speech recognition isn't supported in this browser. Try typing instead.");
      return;
    }
    finalTextRef.current = "";
    setTranscript("");

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTextRef.current += text + " ";
        else interim += text;
      }
      setTranscript((finalTextRef.current + interim).trim());
    };
    rec.onerror = (e: any) => {
      const messages: Record<string, string> = {
        "not-allowed": "Microphone access was denied — allow it in your browser's site settings and try again.",
        "no-speech": "No speech was detected. Try again and speak clearly into the mic.",
        "audio-capture": "No microphone was found.",
        network: "A network error interrupted speech recognition.",
      };
      setState("error");
      onErrorRef.current?.(messages[e.error] || `Speech recognition error: ${e.error}`);
    };
    rec.onend = () => setState((s) => (s === "listening" ? "idle" : s));

    recognitionRef.current = rec;
    try {
      rec.start();
      setState("listening");
    } catch {
      onErrorRef.current?.("Could not start the microphone.");
    }
  }, []);

  const stop = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    setState("idle");
  }, []);

  const reset = useCallback(() => {
    finalTextRef.current = "";
    setTranscript("");
  }, []);

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

  return { supported, state, transcript, setTranscript, start, stop, reset };
}
