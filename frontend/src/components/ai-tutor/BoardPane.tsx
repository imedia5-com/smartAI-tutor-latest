import { useMemo } from "react";
import { KaTeX } from "../../lib/mathRender";
import type { AiTutorBoardBlock, AiTutorSegment, AiTutorStep } from "../../services/api";

function Block({ block }: { block: AiTutorBoardBlock }) {
  switch (block.type) {
    case "heading":
      return <h3 className="text-[17px] font-extrabold text-ink mt-4 mb-1 first:mt-0">{block.content}</h3>;
    case "key_term":
      return (
        <div className="my-2 inline-block bg-brand-light border border-brand/30 rounded-md px-3 py-1.5 text-[13px] font-semibold text-brand">
          {block.content}
        </div>
      );
    case "callout":
      return (
        <div className="my-2 bg-warning-light border-l-4 border-warning rounded-md px-3 py-2 text-[13px] text-ink-soft">
          {block.content}
        </div>
      );
    case "formula":
      return (
        <div className="my-2 text-[16px] text-ink overflow-x-auto">
          <KaTeX tex={block.content || ""} block />
        </div>
      );
    case "code":
      return (
        <pre className="my-2 bg-surface-muted border border-line rounded-md p-3 text-[12.5px] overflow-x-auto">
          <code>{block.content}</code>
        </pre>
      );
    case "bullets":
      return (
        <ul className="list-disc ml-5 my-2 space-y-1 text-[13.5px] text-ink">
          {(block.items || []).map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "steps":
      return (
        <ol className="list-decimal ml-5 my-2 space-y-1 text-[13.5px] text-ink">
          {(block.items || []).map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      );
    default:
      return <p className="my-2 text-[13.5px] text-ink leading-relaxed">{block.content}</p>;
  }
}

export default function BoardPane({ step, revealedCount }: { step: AiTutorStep | null; revealedCount: number }) {
  const visibleBlockIds = useMemo(() => {
    const segments: AiTutorSegment[] = step?.content?.segments ?? [];
    const ids = new Set<string>();
    segments.slice(0, revealedCount + 1).forEach((seg) => seg.board_block_ids.forEach((id) => ids.add(id)));
    return ids;
  }, [step, revealedCount]);

  if (!step || step.status !== "ready" || !step.content) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div className="text-[13px] text-ink-muted">
          {step?.status === "generating" ? "Writing on the board…" : "The board will appear here."}
        </div>
      </div>
    );
  }

  const visibleBlocks = step.content.board.filter((b) => visibleBlockIds.has(b.id));

  return (
    <div className="flex-1 overflow-y-auto p-6" style={{ background: "repeating-linear-gradient(var(--bg-secondary) 0 100%)" }}>
      <div className="max-w-2xl mx-auto bg-surface border border-line rounded-xl shadow-sm p-6 min-h-[70%]">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">{step.title}</div>
        {visibleBlocks.length === 0 ? (
          <div className="text-[13px] text-ink-muted italic">…</div>
        ) : (
          visibleBlocks.map((b) => <Block key={b.id} block={b} />)
        )}
      </div>
    </div>
  );
}
