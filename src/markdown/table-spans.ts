export type TableSpan = { start: number; end: number };

const SEPARATOR_RE = /^\s*\|?[\s:-]+\|/;

function isSeparatorLine(line: string): boolean {
  if (!SEPARATOR_RE.test(line)) {
    return false;
  }
  const stripped = line.replace(/[|\s:-]/g, "");
  return stripped.length === 0 && line.includes("-");
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.startsWith("|") && countPipes(trimmed) >= 2;
}

function countPipes(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === "|") {
      count++;
    }
  }
  return count;
}

function isInsideFence(offset: number, fenceSpans: { start: number; end: number }[]): boolean {
  for (const span of fenceSpans) {
    if (offset > span.start && offset < span.end) {
      return true;
    }
  }
  return false;
}

function mergeSpans(candidates: TableSpan[]): TableSpan[] {
  if (candidates.length === 0) {
    return [];
  }
  const sorted = candidates.toSorted((a, b) => a.start - b.start);
  const merged: TableSpan[] = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

export function parseTableSpans(
  buffer: string,
  fenceSpans: { start: number; end: number }[] = [],
): TableSpan[] {
  const candidates: TableSpan[] = [];
  const lines = buildLineIndex(buffer);

  const firstLevelUsed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const { start: lineStart, text } = lines[i];
    if (isInsideFence(lineStart, fenceSpans)) {
      continue;
    }
    if (!isSeparatorLine(text)) {
      continue;
    }

    let headerStart = i;
    while (headerStart > 0) {
      const prev = lines[headerStart - 1];
      if (prev && countPipes(prev.text) >= 2 && !isInsideFence(prev.start, fenceSpans)) {
        headerStart--;
      } else {
        break;
      }
    }

    let bodyEnd = i;
    while (bodyEnd + 1 < lines.length) {
      const next = lines[bodyEnd + 1];
      if (next && countPipes(next.text) >= 2 && !isInsideFence(next.start, fenceSpans)) {
        bodyEnd++;
      } else {
        break;
      }
    }

    for (let k = headerStart; k <= bodyEnd; k++) {
      firstLevelUsed.add(k);
    }

    candidates.push({ start: lines[headerStart].start, end: lines[bodyEnd].end });
    i = bodyEnd;
  }

  for (let i = 0; i < lines.length; i++) {
    if (firstLevelUsed.has(i)) {
      continue;
    }
    const { start: lineStart, text } = lines[i];
    if (isInsideFence(lineStart, fenceSpans)) {
      continue;
    }
    if (!isTableRow(text)) {
      continue;
    }

    let groupEnd = i;
    while (groupEnd + 1 < lines.length) {
      const next = lines[groupEnd + 1];
      if (
        !firstLevelUsed.has(groupEnd + 1) &&
        next &&
        isTableRow(next.text) &&
        !isInsideFence(next.start, fenceSpans)
      ) {
        groupEnd++;
      } else {
        break;
      }
    }

    if (groupEnd > i) {
      for (let k = i; k <= groupEnd; k++) {
        firstLevelUsed.add(k);
      }
      candidates.push({ start: lines[i].start, end: lines[groupEnd].end });
      i = groupEnd;
    }
  }

  return mergeSpans(candidates);
}

function buildLineIndex(buffer: string): Array<{ start: number; end: number; text: string }> {
  const lines: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;
  while (offset <= buffer.length) {
    const nextNewline = buffer.indexOf("\n", offset);
    const lineEnd = nextNewline === -1 ? buffer.length : nextNewline;
    lines.push({ start: offset, end: lineEnd, text: buffer.slice(offset, lineEnd) });
    if (nextNewline === -1) {
      break;
    }
    offset = nextNewline + 1;
  }
  return lines;
}
