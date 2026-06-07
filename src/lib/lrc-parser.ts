export type LyricLine = {
  time: number;
  text: string;
};

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[[a-zA-Z]+:.*\]$/;

/**
 * Parse an .lrc file into timestamped lines, sorted by time.
 * Supports multiple time tags per line (e.g. [00:01.00][00:05.00]hi).
 * Skips metadata-only lines like [ti:Title] / [ar:Artist].
 */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Pure metadata line with no trailing text → skip.
    const noTags = line.replace(TIME_TAG, "").trim();
    if (META_TAG.test(line) && !noTags) continue;

    const times: number[] = [];
    let m: RegExpExecArray | null;
    TIME_TAG.lastIndex = 0;
    while ((m = TIME_TAG.exec(line)) !== null) {
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
      times.push(mm * 60 + ss + frac);
    }
    if (times.length === 0) continue;
    const content = noTags;
    for (const t of times) out.push({ time: t, text: content });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export function currentLyricIndex(
  lyrics: LyricLine[],
  time: number,
): number {
  if (lyrics.length === 0) return -1;
  let lo = 0;
  let hi = lyrics.length - 1;
  if (time < lyrics[0].time) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lyrics[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
