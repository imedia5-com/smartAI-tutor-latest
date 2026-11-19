/** Safety net for the LLM's own short-reply formatting: splits a teacher message into chunks of
 * at most a few lines each, so a reply that comes back long still renders as several short chat
 * bubbles instead of one wall of text. A contiguous run of list lines is kept together so a
 * numbered/bulleted list never gets split mid-list. */

const MAX_LINES_PER_CHUNK = 5;

function isListLine(line: string): boolean {
  return /^\s*([-*]|\d+[.)])\s+/.test(line);
}

export function splitIntoChunks(text: string): string[] {
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

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
  return chunks.map((c) => c.join("\n"));
}
