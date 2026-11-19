import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Pause, Play, Send, AlertCircle, Volume2, VolumeX, Ear } from "lucide-react";
import { Button } from "../ui";
import Mascot from "./Mascot";
import { normalizeMathText } from "../../lib/mathText";
import { aiTutorApi, type AiTutorMessage, type AiTutorSegment, type AiTutorSession, type AiTutorStep } from "../../services/api";
import { pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from "./speech";

const QUICK_REPLIES = ["Explain again simply", "Give me an example", "Quiz me"];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Bubble({ role, children, muted, time }: {
  role: "user" | "assistant"; children: React.ReactNode; muted?: boolean; time?: string;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} items-end gap-1.5 mb-3`}>
      {!isUser && <Mascot size="sm" className="mb-0.5" />}
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} max-w-[85%]`}>
        <div
          className={
            isUser
              ? "rounded-xl rounded-br-sm bg-brand text-white px-3.5 py-2 text-[13.5px]"
              : `rounded-xl rounded-bl-sm px-3.5 py-2 text-[13.5px] ${muted ? "bg-transparent text-ink-muted italic" : "bg-surface-muted text-ink"}`
          }
        >
          {children}
        </div>
        {time && <div className="text-[10.5px] text-ink-muted mt-0.5 px-1">{time}</div>}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start items-end gap-1.5 mb-3">
      <Mascot size="sm" className="mb-0.5" />
      <div className="rounded-xl rounded-bl-sm bg-surface-muted px-4 py-3 flex items-center gap-1">
        <style>{`
          @keyframes ai-tutor-typing-dot { 0%,80%,100% { transform: translateY(0); opacity: 0.4; } 40% { transform: translateY(-3px); opacity: 1; } }
          .ai-tutor-typing-dot { animation: ai-tutor-typing-dot 1.1s ease-in-out infinite; }
        `}</style>
        {[0, 0.15, 0.3].map((delay) => (
          <span key={delay} className="ai-tutor-typing-dot w-1.5 h-1.5 rounded-full bg-ink-muted" style={{ animationDelay: `${delay}s` }} />
        ))}
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

  const handleSend = async (override?: string) => {
    const content = (override ?? draft).trim();
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
      <div className="flex items-center justify-end px-3 py-2 border-b border-line shrink-0">
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
        {step && step.status === "generating" && <TypingIndicator />}

        {messages.map((m) => {
          const isQuestionPrompt = m.role === "assistant" && m.content.trim() === "Do you have any questions?";
          if (isQuestionPrompt) {
            return (
              <div key={m.id} className="mb-3 bg-brand-light border border-brand/30 rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 mb-2">
                  <Mascot size="sm" />
                  <span className="text-[13.5px] font-semibold text-ink">{m.content}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => handleSend(reply)}
                      disabled={sending}
                      className="px-3 py-1.5 rounded-full bg-surface border border-brand/40 text-[12.5px] font-semibold text-brand hover:bg-brand-light transition-colors disabled:opacity-50"
                    >
                      {reply}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <Bubble key={m.id} role={m.role === "user" ? "user" : "assistant"} muted={m.role === "event"} time={formatTime(m.created_at)}>
              {m.meta?.error && <AlertCircle size={13} className="inline mr-1 text-danger" />}
              <ReactMarkdown>{normalizeMathText(m.content)}</ReactMarkdown>
            </Bubble>
          );
        })}
        {sending && <TypingIndicator />}
      </div>

      {sendError && <div className="px-3 py-1.5 text-[12px] text-danger border-t border-line">{sendError}</div>}

      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="flex items-center gap-1.5 p-2.5 border-t border-line shrink-0"
      >
        <div className="flex-1 flex items-center gap-1.5 h-11 rounded-full border border-line bg-surface pl-4 pr-1.5 focus-within:border-brand transition-colors">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question any time…"
            className="flex-1 h-full bg-transparent text-ink text-[13.5px] placeholder:text-ink-muted focus:outline-none"
          />
          <Button type="submit" size="sm" className="rounded-full w-8 h-8 p-0" disabled={!draft.trim()} loading={sending} aria-label="Send">
            <Send size={14} />
          </Button>
        </div>
      </form>
    </div>
  );
}
