import { useEffect, useRef, useState } from "react";
import { FileText, Presentation, MessageCircle } from "lucide-react";
import ResizablePanels from "../ResizablePanels";
import MaterialPane from "./MaterialPane";
import BoardPane from "./BoardPane";
import ChatPane from "./ChatPane";
import PaneShell from "./PaneShell";
import Mascot from "./Mascot";
import { useLessonPlayback } from "./useLessonPlayback";
import { Alert, Button } from "../ui";
import type { AiTutorSession } from "../../services/api";

// One colour per step dot, cycling — a plain grey progress bar reads as "admin dashboard";
// this reads as "lesson". Picked from the app's own semantic tokens, not new colours.
const STEP_DOT_COLORS = ["bg-brand", "bg-success", "bg-warning", "bg-danger"];
const VOICE_ENABLED_KEY = "ai_tutor_voice_enabled";

export default function LessonView({ session, onSessionChange }: {
  session: AiTutorSession; onSessionChange: (s: AiTutorSession) => void;
}) {
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem(VOICE_ENABLED_KEY) !== "false");
  useEffect(() => { localStorage.setItem(VOICE_ENABLED_KEY, String(voiceEnabled)); }, [voiceEnabled]);

  const { step, stepError, revealedCount, retryStep, voiceBlocked, retrySpeech } =
    useLessonPlayback(session, onSessionChange, voiceEnabled);

  const totalSteps = session.outline?.length ?? 0;
  const stepIndex = session.current_step_index ?? 0;
  const stepNumber = stepIndex + 1;
  const showStepHeader = totalSteps > 0 && session.status !== "qa";

  // Celebrate once, when a guided lesson's steps finish and Q&A begins.
  const [celebrate, setCelebrate] = useState(false);
  const prevStatus = useRef(session.status);
  useEffect(() => {
    if (prevStatus.current !== "qa" && session.status === "qa" && session.mode === "guided" && totalSteps > 0) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 3200);
      return () => clearTimeout(t);
    }
    prevStatus.current = session.status;
  }, [session.status, session.mode, totalSteps]);

  return (
    <div className="main-content" style={{ display: "flex", flexDirection: "column", position: "relative" }}>
      {celebrate && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none animate-fade-in">
          <div className="bg-surface border border-line rounded-2xl shadow-lg px-8 py-6 text-center flex flex-col items-center">
            <Mascot size="lg" />
            <div className="text-[28px] leading-none my-2">🎉</div>
            <div className="text-[17px] font-extrabold text-ink">Nice work — lesson complete!</div>
            <div className="text-[13.5px] text-ink-muted mt-1">Ask me anything else about it below.</div>
          </div>
        </div>
      )}

      {showStepHeader && (
        <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
          <div className="text-[14.5px] font-bold text-ink truncate">{step?.title || "…"}</div>
          <div className="flex items-center gap-2.5 shrink-0 ml-3">
            <div className="flex items-center gap-1">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={`block rounded-full transition-all ${i <= stepIndex ? STEP_DOT_COLORS[i % STEP_DOT_COLORS.length] : "bg-surface-muted"} ${i === stepIndex ? "w-5 h-2.5" : "w-2.5 h-2.5"}`}
                />
              ))}
            </div>
            <div className="text-[12px] text-ink-muted font-semibold">Step {stepNumber} of {totalSteps}</div>
          </div>
        </div>
      )}

      {stepError && (
        <div className="px-5 py-2 border-b border-line">
          <Alert tone="danger">
            <div className="flex items-center justify-between gap-3">
              <span>{stepError}</span>
              <Button size="sm" variant="secondary" onClick={retryStep}>Retry</Button>
            </div>
          </Alert>
        </div>
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        <ResizablePanels
          panels={[
            {
              id: "material", label: "Material", minPct: 18,
              content: (
                <PaneShell tone="brand" icon={FileText} title="Material">
                  <MaterialPane session={session} step={step} revealedCount={revealedCount} />
                </PaneShell>
              ),
            },
            {
              id: "board", label: "Board", minPct: 18,
              content: (
                <PaneShell tone="success" icon={Presentation} title="Board">
                  <BoardPane step={step} revealedCount={revealedCount} mode={session.mode} />
                </PaneShell>
              ),
            },
            {
              id: "chat", label: "Chat", minPct: 22,
              content: (
                <PaneShell tone="warning" icon={MessageCircle} title="Chat">
                  <ChatPane
                    session={session} onSessionChange={onSessionChange} step={step} revealedCount={revealedCount}
                    voiceEnabled={voiceEnabled} onVoiceEnabledChange={setVoiceEnabled}
                    voiceBlocked={voiceBlocked} onRetrySpeech={retrySpeech}
                  />
                </PaneShell>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
