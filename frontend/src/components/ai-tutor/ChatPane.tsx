import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Pause, Play, Send, AlertCircle, Volume2, VolumeX, Ear } from "lucide-react";
import { Button, Spinner } from "../ui";
import { normalizeMathText } from "../../lib/mathText";
import { aiTutorApi, type AiTutorMessage, type AiTutorSegment, type AiTutorSession, type AiTutorStep } from "../../services/api";
import { pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from "./speech";

function Bubble({ role, children, muted }: { role: "user" | "assistant"; children: React.ReactNode; muted?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={
          isUser
            ? "max-w-[85%] rounded-xl rounded-br-sm bg-brand text-white px-3.5 py-2 text-[13.5px]"
            : `max-w-[90%] rounded-xl rounded-bl-sm px-3.5 py-2 text-[13.5px] ${muted ? "bg-transparent text-ink-muted italic" : "bg-surface-muted text-ink"}`
        }
      >
        {children}
      </div>
    </div>
  );
}

export default function ChatPane({
  session, onSessionChange, step, revealedCount,
  voiceEnabled, onVoiceEnabledChange, voiceBlocked, onRetrySpeech,
}: {
  session: AiTutorSession; onSessionChange: (s: AiTutorSession) => void; step: AiTutorStep | null; revealedCount: number;
  voiceEnabled: boolean; onVoiceEnabledChange: (v: boolean) => void; voiceBlocked: boolean; onRetrySpeech: () => void;
}) {
  const [messages, setMessages] = useState<AiTutorMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSpokenMessageIdRef = useRef<number | null>(null);

  const loadMessages = useCallback(async () => {
    try {
      setMessages(await aiTutorApi.listMessages(session.id));
    } catch { /* keep showing whatever we already have */ }
  }, [session.id]);

  useEffect(() => { loadMessages(); }, [loadMessages, session.status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, revealedCount]);

  // Speak freshly-arrived assistant answers (Q&A), but never re-speak on a plain reload/refresh.
  useEffect(() => {
    if (!voiceEnabled) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenMessageIdRef.current === last.id) return;
    lastSpokenMessageIdRef.current = last.id;
    speak(last.content);
  }, [messages, voiceEnabled]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    stopSpeaking(); // the learner asking a question interrupts whatever the teacher was saying
    setSending(true);
    setSendError(null);
    setDraft("");
    try {
      await aiTutorApi.sendMessage(session.id, content, session.status === "teaching" ? revealedCount : undefined);
      await loadMessages();
      const refreshed = await aiTutorApi.getSession(session.id);
      onSessionChange(refreshed);
    } catch (e) {
      setDraft(content);
      setSendError(e instanceof Error ? e.message : "Couldn't send that — please try again.");
    } finally {
      setSending(false);
    }
  };

  const togglePause = async () => {
    setActionBusy(true);
    try {
      if (session.status === "teaching") {
        pauseSpeaking();
        const updated = await aiTutorApi.pause(session.id);
        onSessionChange(updated);
      } else {
        const updated = await aiTutorApi.resume(session.id);
        onSessionChange(updated);
        resumeSpeaking();
      }
    } catch { /* ignore — a stale control is harmless */ }
    finally { setActionBusy(false); }
  };

  const narrationSegments: AiTutorSegment[] = step?.content?.segments.slice(0, revealedCount + 1) ?? [];
  const canTogglePause = session.status === "teaching" || session.status === "paused";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
        <div className="text-[12px] font-bold text-ink-muted uppercase tracking-wide">Chat</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onVoiceEnabledChange(!voiceEnabled)}
            aria-label={voiceEnabled ? "Turn off the teacher's voice" : "Turn on the teacher's voice"}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? "Teacher's voice is on" : "Teacher's voice is off"}
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${voiceEnabled ? "bg-brand-light text-brand" : "bg-surface-muted text-ink-muted"}`}
          >
            {voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          {canTogglePause && (
            <Button size="sm" variant="secondary" loading={actionBusy} onClick={togglePause}
              leftIcon={session.status === "teaching" ? <Pause size={14} /> : <Play size={14} />}>
              {session.status === "teaching" ? "Pause" : session.pause_reason === "question" ? "Continue lesson" : "Resume"}
            </Button>
          )}
        </div>
      </div>

      {voiceEnabled && voiceBlocked && (
        <div className="px-3 py-2 border-b border-line bg-warning-light">
          <button
            type="button"
            onClick={onRetrySpeech}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warning"
          >
            <Ear size={14} /> Tap to hear the teacher
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3" aria-live="polite">
        {narrationSegments.map((seg) => (
          <Bubble key={seg.id} role="assistant">
            <ReactMarkdown>{normalizeMathText(seg.text)}</ReactMarkdown>
          </Bubble>
        ))}
        {step && step.status === "generating" && (
          <div className="flex items-center gap-2 text-[12px] text-ink-muted py-2"><Spinner className="h-3.5 w-3.5" /> Preparing the next step…</div>
        )}

        {messages.map((m) => (
          <Bubble key={m.id} role={m.role === "user" ? "user" : "assistant"} muted={m.role === "event"}>
            {m.meta?.error && <AlertCircle size={13} className="inline mr-1 text-danger" />}
            <ReactMarkdown>{normalizeMathText(m.content)}</ReactMarkdown>
          </Bubble>
        ))}
      </div>

      {sendError && <div className="px-3 py-1.5 text-[12px] text-danger border-t border-line">{sendError}</div>}

      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="flex items-center gap-2 p-2.5 border-t border-line shrink-0"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask a question any time…"
          className="flex-1 h-10 rounded-md border border-line bg-surface text-ink text-[13.5px] px-3 placeholder:text-ink-muted focus:outline-none focus:border-brand"
        />
        <Button type="submit" size="md" disabled={!draft.trim()} loading={sending} aria-label="Send">
          <Send size={16} />
        </Button>
      </form>
    </div>
  );
}
