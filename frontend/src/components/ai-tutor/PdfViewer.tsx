import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
// Vite's `?url` suffix guarantees this is bundled as a static asset and resolved to the final
// build URL at import time — `new URL(bareSpecifier, import.meta.url)` isn't reliably rewritten
// by Vite's build analysis for a bare node_modules specifier (worked in dev, broke in prod).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Spinner } from "../ui";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Find which text-layer item indices a (normalised) quote spans, so only those exact
 * DOM spans get highlighted. Returns null if the quote can't be located on this page. */
function findQuoteItemRange(itemsStr: string[], quote: string): [number, number] | null {
  const normQuote = quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normQuote) return null;

  let joined = "";
  const charToItem: number[] = [];
  itemsStr.forEach((s, i) => {
    for (const _ch of s) charToItem.push(i);
    joined += s;
    joined += " ";
    charToItem.push(i);
  });

  const idx = joined.toLowerCase().indexOf(normQuote);
  if (idx === -1) return null;
  const start = charToItem[idx];
  const end = charToItem[Math.min(idx + normQuote.length - 1, charToItem.length - 1)];
  return [start, end];
}

export default function PdfViewer({ fileUrl, targetPage, highlightQuote }: {
  fileUrl: string; targetPage: number; highlightQuote?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const layerInfoRef = useRef<{ textDivs: HTMLElement[]; textContentItemsStr: string[] } | null>(null);
  const highlightedRef = useRef<HTMLElement[]>([]);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(targetPage || 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the document (authenticated fetch — a plain <iframe src> can't carry the Bearer token).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    (async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(fileUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) throw new Error("Couldn't load the PDF.");
        const data = await res.arrayBuffer();
        if (cancelled) return;
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) return;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load the PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fileUrl]);

  // Jump to whatever page the active highlight is on.
  useEffect(() => {
    if (targetPage) setPage(targetPage);
  }, [targetPage]);

  // Render the canvas + text layer for the current page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;
      try {
        const pageProxy = await pdfDoc.getPage(page);
        if (cancelled) return;

        const containerWidth = containerRef.current?.clientWidth || 700;
        const baseViewport = pageProxy.getViewport({ scale: 1 });
        const scale = Math.min(containerWidth / baseViewport.width, 1.6) || 1;
        const viewport = pageProxy.getViewport({ scale });

        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await pageProxy.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        const textLayerDiv = textLayerRef.current;
        textLayerDiv.innerHTML = "";
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        highlightedRef.current = [];

        const textContent = await pageProxy.getTextContent();
        const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
        await textLayer.render();
        if (cancelled) return;

        layerInfoRef.current = { textDivs: textLayer.textDivs, textContentItemsStr: textLayer.textContentItemsStr };
        applyHighlight();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't render this page.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, page]);

  // Re-apply just the highlight when the quote changes but the page doesn't (no full re-render).
  useEffect(() => { applyHighlight(); }, [highlightQuote]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyHighlight() {
    highlightedRef.current.forEach((el) => el.classList.remove("ai-tutor-pdf-highlight"));
    highlightedRef.current = [];
    const info = layerInfoRef.current;
    if (!info || !highlightQuote) return;
    const range = findQuoteItemRange(info.textContentItemsStr, highlightQuote);
    if (!range) return;
    const [start, end] = range;
    let first: HTMLElement | null = null;
    for (let i = start; i <= end; i++) {
      const el = info.textDivs[i];
      if (el) {
        el.classList.add("ai-tutor-pdf-highlight");
        highlightedRef.current.push(el);
        if (!first) first = el;
      }
    }
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
      <style>{".ai-tutor-pdf-highlight { background-color: rgba(250, 204, 21, 0.45); border-radius: 2px; }"}</style>
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-1.5 border-b border-line shrink-0 text-[12px] text-ink-soft">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page" className="disabled:opacity-30">
            <ChevronLeft size={16} />
          </button>
          Page {page} of {numPages}
          <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages} aria-label="Next page" className="disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto flex items-start justify-center p-3">
        {loading && <div className="flex items-center gap-2 text-[13px] text-ink-muted mt-8"><Spinner className="h-4 w-4" /> Loading PDF…</div>}
        {error && <div className="text-[13px] text-danger mt-8">{error}</div>}
        {!loading && !error && (
          <div style={{ position: "relative" }}>
            <canvas ref={canvasRef} />
            <div ref={textLayerRef} className="textLayer" />
          </div>
        )}
      </div>
    </div>
  );
}
