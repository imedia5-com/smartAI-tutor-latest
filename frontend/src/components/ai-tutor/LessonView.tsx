import ResizablePanels from "../ResizablePanels";
import MaterialPane from "./MaterialPane";
import BoardPane from "./BoardPane";
import ChatPane from "./ChatPane";
import { useLessonPlayback } from "./useLessonPlayback";
import { Alert, Button } from "../ui";
import type { AiTutorSession } from "../../services/api";

export default function LessonView({ session, onSessionChange }: {
  session: AiTutorSession; onSessionChange: (s: AiTutorSession) => void;
}) {
  const { step, stepError, revealedCount, retryStep } = useLessonPlayback(session, onSessionChange);

  const totalSteps = session.outline?.length ?? 0;
  const stepNumber = (session.current_step_index ?? 0) + 1;
  const showStepHeader = totalSteps > 0 && session.status !== "qa";

  return (
    <div className="main-content" style={{ display: "flex", flexDirection: "column" }}>
      {showStepHeader && (
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-line shrink-0">
          <div className="text-[13px] font-semibold text-ink truncate">{step?.title || "…"}</div>
          <div className="text-[11.5px] text-ink-muted font-medium shrink-0 ml-3">Step {stepNumber} of {totalSteps}</div>
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
              content: <MaterialPane session={session} step={step} revealedCount={revealedCount} />,
            },
            {
              id: "board", label: "Board", minPct: 18,
              content: <BoardPane step={step} revealedCount={revealedCount} />,
            },
            {
              id: "chat", label: "Chat", minPct: 22,
              content: <ChatPane session={session} onSessionChange={onSessionChange} step={step} revealedCount={revealedCount} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
