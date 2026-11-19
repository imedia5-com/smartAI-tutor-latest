/** Safety net for the LLM's own short-reply formatting: splits a teacher message into chunks of
 * at most a few lines each, so a reply that comes back long still renders as several short chat
 * bubbles instead of one wall of text. A contiguous run of list lines is kept together so a
 * numbered/bulleted list never gets split mid-list. Also catches a reply that ignored the "one
 * idea per line" instruction and came back as one long prose paragraph with no line breaks at
 * all — that gets split into sentences first, so it still chunks into several short bubbles. */

const MAX_LINES_PER_CHUNK = 5;

function isListLine(line: string): boolean {
  return /^\s*([-*]|\d+[.)])\s+/.test(line);
}

function splitIntoSentences(line: string): string[] {
  const sentences = line.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!sentences) return [line];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

export function splitIntoChunks(text: string): string[] {
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const rawLines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) return [];

  // Expand any long prose line (no newlines of its own, several sentences) into one entry per
  // sentence, so it's still eligible for chunking below — a list line is left alone.
  const lines: string[] = [];
  for (const line of rawLines) {
    if (isListLine(line)) { lines.push(line); continue; }
    const sentences = splitIntoSentences(line);
    if (sentences.length > 1) lines.push(...sentences);
    else lines.push(line);
  }

  const chunks: string[][] = [];
  let current: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isListLine(lines[i])) {
      const listBlock: string[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        listBlock.push(lines[i]);
        i++;
      }
      if (current.length > 0 && current.length + listBlock.length > MAX_LINES_PER_CHUNK) {
        chunks.push(current);
        current = [];
      }
      current.push(...listBlock);
      if (current.length >= MAX_LINES_PER_CHUNK) {
        chunks.push(current);
        current = [];
      }
      continue;
    }
    if (current.length >= MAX_LINES_PER_CHUNK) {
      chunks.push(current);
      current = [];
    }
    current.push(lines[i]);
    i++;
  }
  if (current.length > 0) chunks.push(current);
  // Joined with "\n", not a space: list lines need their own line to parse as a markdown list;
  // plain CommonMark collapses a lone "\n" between prose sentences back to a space anyway.
  return chunks.map((c) => c.join("\n"));
}
