import { Mic, Square } from "lucide-react";
import { cn } from "../ui/cn";
import type { SpeechState } from "../../hooks/useSpeechRecognition";

export default function MicButton({ state, onClick }: { state: SpeechState; onClick: () => void }) {
  const listening = state === "listening";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={listening ? "Stop listening" : "Start speaking"}
      className={cn(
        "relative inline-flex h-20 w-20 items-center justify-center rounded-full border-2 transition-colors",
        listening ? "border-danger bg-danger-light" : "border-brand bg-brand-light hover:bg-brand/20",
      )}
    >
      {listening && (
        <span className="absolute inset-0 rounded-full bg-danger/30 animate-ping" aria-hidden="true" />
      )}
      {listening ? <Square size={26} className="text-danger relative" /> : <Mic size={28} className="text-brand relative" />}
    </button>
  );
}
