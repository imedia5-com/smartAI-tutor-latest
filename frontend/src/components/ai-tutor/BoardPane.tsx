import { useMemo } from "react";
import { MessageCircle, PenLine } from "lucide-react";
import { KaTeX } from "../../lib/mathRender";
import type { AiTutorBoardBlock, AiTutorMode, AiTutorSegment, AiTutorStep } from "../../services/api";

function WritingPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <style>{`
        @keyframes ai-tutor-pencil-write { 0%,100% { transform: translate(0,0) rotate(-8deg); } 50% { transform: translate(3px,-2px) rotate(-14deg); } }
        .ai-tutor-pencil { animation: ai-tutor-pencil-write 1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ai-tutor-pencil { animation: none; } }
      `}</style>
      <PenLine size={22} className="text-success ai-tutor-pencil mb-2" />
      <div className="text-[13.5px] text-ink-muted italic">Your teacher is writing…</div>
    </div>
  );
}

function Block({ block }: { block: AiTutorBoardBlock }) {
  switch (block.type) {
    case "heading":
      return <h3 className="text-[20px] font-extrabold text-ink mt-4 mb-1.5 first:mt-0">{block.content}</h3>;
    case "key_term":
      return (
        <div className="my-2 inline-block bg-brand-light border border-brand/30 rounded-xl px-3.5 py-2 text-[15px] font-semibold text-brand">
          {block.content}
        </div>
      );
    case "callout":
      return (
        <div className="my-2 bg-warning-light border-l-4 border-warning rounded-xl px-4 py-2.5 text-[15px] text-ink-soft">
          {block.content}
        </div>
      );
    case "formula":
      return (
        <div className="my-2 text-[18px] text-ink overflow-x-auto">
          <KaTeX tex={block.content || ""} block />
        </div>
      );
    case "code":
      return (
        <pre className="my-2 bg-surface-muted border border-line rounded-xl p-3.5 text-[14px] overflow-x-auto">
          <code>{block.content}</code>
        </pre>
      );
    case "bullets":
      return (
        <ul className="list-disc ml-5 my-2 space-y-1.5 text-[15.5px] text-ink leading-relaxed">
          {(block.items || []).map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "steps":
      return (
        <ol className="list-decimal ml-5 my-2 space-y-1.5 text-[15.5px] text-ink leading-relaxed">
          {(block.items || []).map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      );
    default:
      return <p className="my-2 text-[15.5px] text-ink leading-relaxed">{block.content}</p>;
  }
}

export default function BoardPane({ step, revealedCount, mode }: {
  step: AiTutorStep | null; revealedCount: number; mode?: AiTutorMode;
}) {
  const visibleBlockIds = useMemo(() => {
    const segments: AiTutorSegment[] = step?.content?.segments ?? [];
    const ids = new Set<string>();
    segments.slice(0, revealedCount + 1).forEach((seg) => seg.board_block_ids.forEach((id) => ids.add(id)));
    return ids;
  }, [step, revealedCount]);

  if (!step || step.status !== "ready" || !step.content) {
    if (step?.status === "generating") {
      return <div className="flex-1 flex items-center justify-center text-center p-8"><WritingPlaceholder /></div>;
    }
    // "Just answer my questions" mode never teaches step-by-step, so there's no board content —
    // say so clearly instead of implying something is still coming.
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <MessageCircle size={22} className="text-ink-muted mb-2" />
        <div className="text-[13px] text-ink-muted max-w-[220px]">
          {mode === "qa_only"
            ? "This mode just answers your questions — no whiteboard here. Ask away in the chat!"
            : "The board will appear here."}
        </div>
      </div>
    );
  }

  const visibleBlocks = step.content.board.filter((b) => visibleBlockIds.has(b.id));

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: "repeating-linear-gradient(var(--bg-secondary) 0 100%)" }}>
      <div className="max-w-2xl mx-auto bg-surface border border-line rounded-2xl shadow-sm p-7 min-h-[70%]">
        <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted mb-3">{step.title}</div>
        {visibleBlocks.length === 0 ? (
          <WritingPlaceholder />
        ) : (
          visibleBlocks.map((b) => <Block key={b.id} block={b} />)
        )}
      </div>
    </div>
  );
}
