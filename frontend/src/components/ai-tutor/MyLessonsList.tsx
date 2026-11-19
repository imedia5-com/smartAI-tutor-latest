import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Mic, Keyboard, FileType2 } from "lucide-react";
import { Badge, Card, Spinner } from "../ui";
import { aiTutorApi, type AiTutorSessionSummary, type AiTutorStatus } from "../../services/api";

const TYPE_ICON = { pdf: FileText, voice: Mic, text: Keyboard, word: FileType2 } as const;

const STATUS_BADGE: Record<AiTutorStatus, { label: string; tone: "neutral" | "brand" | "success" | "warning" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" },
  processing: { label: "Preparing…", tone: "neutral" },
  ready: { label: "Ready", tone: "brand" },
  teaching: { label: "In progress", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  qa: { label: "Q&A", tone: "brand" },
  failed: { label: "Failed", tone: "danger" },
};

function fallbackTitle(s: AiTutorSessionSummary): string {
  if (s.title) return s.title;
  const label = { pdf: "PDF lesson", word: "Word document lesson", voice: "Spoken question", text: "Typed question" }[s.input_type];
  return label;
}

export default function MyLessonsList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AiTutorSessionSummary[] | null>(null);

  useEffect(() => {
    aiTutorApi.listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  if (sessions === null) {
    return <div className="flex items-center gap-2 text-[13px] text-ink-muted mb-6"><Spinner className="h-4 w-4" /> Loading your lessons…</div>;
  }
  if (sessions.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="text-[12.5px] font-semibold text-ink-soft mb-2">My lessons</div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {sessions.slice(0, 8).map((s) => {
          const Icon = TYPE_ICON[s.input_type];
          const badge = STATUS_BADGE[s.status];
          return (
            <Card
              key={s.id}
              onClick={() => navigate(`/ai-tutor/${s.id}`)}
              className="p-3.5 min-w-[220px] max-w-[220px] cursor-pointer hover:bg-surface-hover transition-colors shrink-0"
            >
              <div className="flex items-center justify-between mb-1.5">
                <Icon size={16} className="text-ink-muted" />
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <div className="text-[13px] font-semibold text-ink truncate">{fallbackTitle(s)}</div>
              <div className="text-[11.5px] text-ink-muted mt-1">
                {s.total_steps && s.current_step_index != null
                  ? `Step ${Math.min(s.current_step_index + 1, s.total_steps)} of ${s.total_steps}`
                  : new Date(s.updated_at).toLocaleDateString()}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
