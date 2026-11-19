import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../ui/cn";
import PdfViewer from "./PdfViewer";
import { aiTutorApi, type AiTutorHighlight, type AiTutorSession, type AiTutorStep } from "../../services/api";

/** Collapse runs of whitespace to a single space while keeping a map back to original indices
 * (so a highlight quote matched against normalised text can still be located in the raw text). */
function buildCollapsedMap(text: string): { collapsed: string; map: number[] } {
  let collapsed = "";
  const map: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      collapsed += " ";
      map.push(i);
      while (i < text.length && /\s/.test(text[i])) i++;
    } else {
      collapsed += ch;
      map.push(i);
      i++;
    }
  }
  return { collapsed, map };
}

function findHighlightRange(text: string, quote: string): [number, number] | null {
  const normQuote = quote.replace(/\s+/g, " ").trim();
  if (!normQuote) return null;
  const { collapsed, map } = buildCollapsedMap(text);
  const idx = collapsed.toLowerCase().indexOf(normQuote.toLowerCase());
  if (idx === -1) return null;
  const start = map[idx];
  const end = (map[idx + normQuote.length - 1] ?? map[map.length - 1]) + 1;
  return [start, end];
}

function PageText({ text, highlight }: { text: string; highlight?: AiTutorHighlight }) {
  const markRef = useRef<HTMLElement>(null);
  const range = highlight ? findHighlightRange(text, highlight.quote) : null;

  useEffect(() => {
    if (range) markRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [range?.[0], range?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!range) {
    return <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-wrap">{text}</p>;
  }
  const [start, end] = range;
  return (
    <p className="text-[13.5px] text-ink-soft leading-relaxed whitespace-pre-wrap">
      {text.slice(0, start)}
      <mark ref={markRef} title={highlight?.note || undefined}
        className="bg-warning-light text-ink rounded px-0.5 ring-2 ring-warning/60">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </p>
  );
}

export default function MaterialPane({ session, step, revealedCount }: {
  session: AiTutorSession; step: AiTutorStep | null; revealedCount: number;
}) {
  const sources = useMemo(() => session.sources.filter((s) => s.pages && s.pages.length > 0), [session.sources]);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(sources[0]?.id ?? null);

  const activeHighlights = useMemo(() => {
    const segments = step?.content?.segments;
    if (!segments || !step?.content) return [];
    const seg = segments[Math.min(revealedCount, segments.length - 1)];
    if (!seg) return [];
    return step.content.highlights.filter((h) => seg.highlight_ids.includes(h.id));
  }, [step, revealedCount]);

  useEffect(() => {
    const h = activeHighlights[0];
    if (h) setActiveSourceId(Number(h.source_id));
  }, [activeHighlights]);

  const activeSource = sources.find((s) => s.id === activeSourceId) ?? sources[0] ?? null;
  const activeSourceHighlight = activeSource
    ? activeHighlights.find((h) => Number(h.source_id) === activeSource.id)
    : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {sources.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-line overflow-x-auto shrink-0">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSourceId(s.id)}
              className={cn(
                "px-2.5 py-1 rounded text-[12px] font-medium whitespace-nowrap",
                s.id === activeSource?.id ? "bg-brand text-white" : "bg-surface-muted text-ink-soft hover:bg-surface-hover",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {!activeSource ? (
        <div className="text-[13px] text-ink-muted text-center mt-8">No material to show yet.</div>
      ) : activeSource.file_type === "pdf" ? (
        <PdfViewer
          key={activeSource.id}
          fileUrl={aiTutorApi.sourceFileUrl(session.id, activeSource.id)}
          targetPage={activeSourceHighlight?.page || 1}
          highlightQuote={activeSourceHighlight?.quote}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {(activeSource.pages || []).map((p) => (
            <div key={p.page} className="mb-6">
              {(activeSource.pages?.length || 0) > 1 && (
                <div className="text-[11px] font-bold text-ink-muted mb-1">Page {p.page}</div>
              )}
              <PageText text={p.text} highlight={activeSourceHighlight && activeSourceHighlight.page === p.page ? activeSourceHighlight : undefined} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
