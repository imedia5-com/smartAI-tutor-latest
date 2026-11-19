import { useCallback, useEffect, useRef, useState } from "react";
import { aiTutorApi, type AiTutorSession, type AiTutorStep } from "../../services/api";

const BASE_SEGMENT_MS = 1400;
const MS_PER_CHAR = 25;
const MAX_SEGMENT_MS = 9000;
const AUTO_ADVANCE_DELAY_MS = 2200;

/**
 * Drives step-by-step playback for a "teaching" AI Tutor session: lazily loads each step,
 * reveals its narration segments one at a time (typing-speed delay), then auto-advances.
 * Deliberately does NOT reset `revealedCount` when the session pauses/resumes for a question
 * — "resumes from where it stopped" means the already-shown segments stay shown.
 */
export function useLessonPlayback(session: AiTutorSession, onSessionChange: (s: AiTutorSession) => void) {
  const [step, setStep] = useState<AiTutorStep | null>(null);
  const [stepLoading, setStepLoading] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);

  const loadedIndexRef = useRef<number | null>(null);
  const advancingRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the latest resume point the server recorded for this step (set when a mid-lesson
  // question auto-paused the lesson). Read via ref so `loadStep` doesn't need to change identity
  // every time the session object is refetched.
  const resumeSegmentRef = useRef<number | null>(session.resume_segment_index);
  resumeSegmentRef.current = session.resume_segment_index;

  const stepIndex = session.current_step_index;

  const loadStep = useCallback(async (index: number) => {
    setStepLoading(true);
    setStepError(null);
    try {
      const s = await aiTutorApi.getStep(session.id, index);
      setStep(s);
      loadedIndexRef.current = index;
      // Resume from the segment the server last recorded for THIS step (e.g. after a page
      // reload mid-question), rather than always restarting the step from the top.
      setRevealedCount(resumeSegmentRef.current ?? 0);
    } catch (e) {
      setStepError(e instanceof Error ? e.message : "Couldn't generate this step.");
    } finally {
      setStepLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    if (stepIndex == null) return;
    if (loadedIndexRef.current === stepIndex) return;
    loadStep(stepIndex);
  }, [stepIndex, loadStep]);

  // Reveal one segment at a time while actively teaching.
  useEffect(() => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    const segments = step?.content?.segments;
    if (session.status !== "teaching" || !segments || revealedCount >= segments.length) return;

    const text = segments[revealedCount]?.text || "";
    const delay = Math.min(BASE_SEGMENT_MS + text.length * MS_PER_CHAR, MAX_SEGMENT_MS);
    revealTimerRef.current = setTimeout(() => setRevealedCount((c) => c + 1), delay);
    return () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); };
  }, [session.status, step, revealedCount]);

  // Once every segment of the current step has played, move on automatically.
  useEffect(() => {
    const segments = step?.content?.segments;
    if (session.status !== "teaching" || !segments || revealedCount < segments.length) return;
    if (advancingRef.current) return;
    advancingRef.current = true;

    const t = setTimeout(async () => {
      try {
        const updated = await aiTutorApi.advance(session.id, step!.step_index);
        onSessionChange(updated);
      } catch {
        // A stale/already-advanced state resolves itself on the next session refresh.
      } finally {
        advancingRef.current = false;
      }
    }, AUTO_ADVANCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [session.status, session.id, step, revealedCount, onSessionChange]);

  const retryStep = useCallback(() => {
    if (stepIndex != null) loadStep(stepIndex);
  }, [stepIndex, loadStep]);

  return { step, stepLoading, stepError, revealedCount, retryStep };
}
