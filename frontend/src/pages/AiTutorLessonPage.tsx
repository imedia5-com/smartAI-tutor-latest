import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button, Alert } from "../components/ui";
import { aiTutorApi, type AiTutorSession } from "../services/api";
import LessonView from "../components/ai-tutor/LessonView";
import Mascot from "../components/ai-tutor/Mascot";

const POLL_DELAYS = [800, 1200, 1800, 2500, 3500]; // ms, backs off then holds at the last value

export default function AiTutorLessonPage() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();

  const [session, setSession] = useState<AiTutorSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const pollAttempt = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchSession = useCallback(async () => {
    try {
      const s = await aiTutorApi.getSession(sessionId);
      if (cancelledRef.current) return s;
      setSession(s);
      setError(null);
      return s;
    } catch (e) {
      if (!cancelledRef.current) setError(e instanceof Error ? e.message : "Couldn't load this lesson.");
      return null;
    }
  }, [sessionId]);

  const pollWhileProcessing = useCallback(async () => {
    const s = await fetchSession();
    if (!s || cancelledRef.current) return;
    if (s.status === "draft" || s.status === "processing") {
      const delay = POLL_DELAYS[Math.min(pollAttempt.current, POLL_DELAYS.length - 1)];
      pollAttempt.current += 1;
      timerRef.current = setTimeout(pollWhileProcessing, delay);
      return;
    }
    if (s.status === "ready") {
      // Guided lessons start playing immediately; Q&A-only sessions land straight in Q&A.
      try {
        const started = await aiTutorApi.start(sessionId);
        if (!cancelledRef.current) setSession(started);
      } catch (e) {
        if (!cancelledRef.current) setError(e instanceof Error ? e.message : "Couldn't start the lesson.");
      }
    }
  }, [fetchSession, sessionId]);

  useEffect(() => {
    cancelledRef.current = false;
    pollAttempt.current = 0;
    pollWhileProcessing();
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pollWhileProcessing]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const s = await aiTutorApi.retry(sessionId);
      setSession(s);
      pollAttempt.current = 0;
      pollWhileProcessing();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRetrying(false);
    }
  };

  if (error && !session) {
    return (
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px" }}>
          <Alert tone="danger" title="Couldn't load this lesson">{error}</Alert>
          <Button className="mt-4" variant="secondary" onClick={() => navigate("/ai-tutor")}>Back to AI Tutor</Button>
        </div>
      </div>
    );
  }

  if (!session || session.status === "draft" || session.status === "processing") {
    return (
      <div className="main-content">
        <div className="dashboard-content flex items-center justify-center" style={{ padding: "24px 28px", minHeight: "60vh" }}>
          <div className="flex flex-col items-center text-center max-w-sm">
            <div className="relative mb-4">
              <Mascot size="lg" />
            </div>
            <div className="font-bold text-ink text-[16px]">
              {session?.status === "processing" ? "Reading your material…" : "Getting ready…"}
            </div>
            <div className="text-[13px] text-ink-muted mt-1.5">
              The AI tutor is planning your lesson. This can take up to 20 seconds.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (session.status === "failed") {
    return (
      <div className="main-content">
        <div className="dashboard-content" style={{ padding: "24px 28px" }}>
          <Alert tone="danger" title="This lesson couldn't be generated">
            <div className="mb-2">{session.error_message || "Something went wrong."}</div>
            {session.warnings.length > 0 && (
              <ul className="list-disc ml-4 text-[12.5px]">
                {session.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </Alert>
          <div className="flex items-center gap-2 mt-4">
            <Button loading={retrying} onClick={handleRetry} leftIcon={<AlertTriangle size={15} />}>Retry</Button>
            <Button variant="secondary" onClick={() => navigate("/ai-tutor")}>Back to AI Tutor</Button>
          </div>
        </div>
      </div>
    );
  }

  return <LessonView session={session} onSessionChange={setSession} />;
}
