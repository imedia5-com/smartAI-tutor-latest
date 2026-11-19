import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Mic, Keyboard, FileType2, Trash2, Check, X } from "lucide-react";
import { Spinner } from "../ui";
import { aiTutorApi, type AiTutorSessionSummary, type AiTutorStatus } from "../../services/api";
import { primeSpeech } from "./speech";

const TYPE_ICON = { pdf: FileText, voice: Mic, text: Keyboard, word: FileType2 } as const;

// One accent per card, cycling through the app's own semantic tones — not new colours.
const ACCENTS = ["brand", "success", "warning", "danger"] as const;
const ACCENT_BAR: Record<(typeof ACCENTS)[number], string> = {
  brand: "bg-brand", success: "bg-success", warning: "bg-warning", danger: "bg-danger",
};
const ACCENT_CHIP: Record<(typeof ACCENTS)[number], string> = {
  brand: "bg-brand-light text-brand", success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning", danger: "bg-danger-light text-danger",
};

const STATUS_LABEL: Record<AiTutorStatus, string> = {
  draft: "Draft", processing: "Preparing…", ready: "Ready", teaching: "In progress",
  paused: "Paused", qa: "Q&A", failed: "Failed",
};

function fallbackTitle(s: AiTutorSessionSummary): string {
  const raw = s.title || { pdf: "PDF lesson", word: "Word document lesson", voice: "Spoken question", text: "Typed question" }[s.input_type];
  // LLM-generated titles sometimes wrap the verbatim question in quotes — strip them for display.
  return raw.trim().replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "");
}

export default function MyLessonsList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AiTutorSessionSummary[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    aiTutorApi.listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await aiTutorApi.deleteSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    } catch {
      /* leave it in the list — the learner can retry */
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  if (sessions === null) {
    return <div className="flex items-center gap-2 text-[13px] text-ink-muted mb-6"><Spinner className="h-4 w-4" /> Loading your lessons…</div>;
  }
  if (sessions.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="text-[13px] font-bold text-ink-soft mb-2.5">My lessons</div>
      <div className="flex gap-3.5 overflow-x-auto pb-2 -mx-1 px-1">
        {sessions.slice(0, 8).map((s, i) => {
          const Icon = TYPE_ICON[s.input_type];
          const accent = ACCENTS[i % ACCENTS.length];
          const hasProgress = !!(s.total_steps && s.current_step_index != null);
          const stepNum = hasProgress ? Math.min(s.current_step_index! + 1, s.total_steps!) : 0;
          const pct = hasProgress ? Math.round((stepNum / s.total_steps!) * 100) : 0;
          const confirming = confirmingId === s.id;

          return (
            <div
              key={s.id}
              className="relative min-w-[230px] max-w-[230px] shrink-0 rounded-2xl border-2 border-line bg-surface shadow-sm overflow-hidden transition-transform hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0"
            >
              <div className={`h-1.5 ${ACCENT_BAR[accent]}`} />
              <button
                type="button"
                onClick={() => { primeSpeech(); navigate(`/ai-tutor/${s.id}`); }}
                className="w-full text-left p-3.5 pb-2.5"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${ACCENT_CHIP[accent]}`}>
                    <Icon size={15} />
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${ACCENT_CHIP[accent]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <div className="text-[14px] font-bold text-ink leading-snug line-clamp-2 min-h-[36px]">{fallbackTitle(s)}</div>
                {hasProgress ? (
                  <div className="mt-2.5">
                    <div className="h-1.5 rounded-full bg-surface-muted overflow-hidden">
                      <div className={`h-full rounded-full ${ACCENT_BAR[accent]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[11px] text-ink-muted mt-1">Step {stepNum} of {s.total_steps}</div>
                  </div>
                ) : (
                  <div className="text-[11px] text-ink-muted mt-2.5">{new Date(s.updated_at).toLocaleDateString()}</div>
                )}
              </button>

              <div className="flex items-center justify-between px-3.5 pb-3 pt-1">
                {confirming ? (
                  <div className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
                    Delete?
                    <button
                      type="button"
                      aria-label="Confirm delete"
                      disabled={deletingId === s.id}
                      onClick={() => handleDelete(s.id)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-danger text-white disabled:opacity-50"
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel delete"
                      onClick={() => setConfirmingId(null)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-muted text-ink-muted"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label="Delete this lesson"
                    onClick={() => setConfirmingId(s.id)}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-full text-ink-muted hover:bg-danger-light hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { primeSpeech(); navigate(`/ai-tutor/${s.id}`); }}
                  className={`text-[12px] font-bold px-3 py-1.5 rounded-full ${ACCENT_CHIP[accent]} hover:opacity-80 transition-opacity`}
                >
                  Continue ▶
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
