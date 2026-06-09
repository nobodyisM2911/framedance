import { parseLrc, type LyricLine } from "./lrc-parser";

export type LyricsLookupResult =
  | { status: "synced"; lines: LyricLine[]; source: "lrclib"; meta: LrcLibTrack }
  | { status: "plain"; text: string; source: "lrclib"; meta: LrcLibTrack }
  | { status: "not_found" };

export type LrcLibTrack = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
};

const LRCLIB_BASE = "https://lrclib.net/api";

/**
 * Look up synced lyrics from LRCLIB (free, no key). Tries exact GET first, then
 * falls back to the search endpoint.
 */
export async function findLyrics(
  trackName: string,
  artistName: string,
  durationSec?: number,
): Promise<LyricsLookupResult> {
  const params = new URLSearchParams({
    track_name: trackName.trim(),
    artist_name: artistName.trim(),
  });
  if (durationSec && Number.isFinite(durationSec)) {
    params.set("duration", Math.round(durationSec).toString());
  }

  try {
    const direct = await fetch(`${LRCLIB_BASE}/get?${params.toString()}`);
    if (direct.ok) {
      const data = await direct.json();
      return toResult(data);
    }
  } catch {
    /* fall through */
  }

  // Fallback: search by free-text query
  try {
    const q = `${trackName} ${artistName}`.trim();
    const search = await fetch(
      `${LRCLIB_BASE}/search?${new URLSearchParams({ q }).toString()}`,
    );
    if (search.ok) {
      const list = (await search.json()) as Array<Record<string, unknown>>;
      const best = list?.[0];
      if (best) return toResult(best);
    }
  } catch {
    /* ignore */
  }
  return { status: "not_found" };
}

function toResult(data: Record<string, unknown>): LyricsLookupResult {
  const meta: LrcLibTrack = {
    id: Number(data.id ?? 0),
    trackName: String(data.trackName ?? ""),
    artistName: String(data.artistName ?? ""),
    albumName: (data.albumName as string | null | undefined) ?? null,
    duration: (data.duration as number | null | undefined) ?? null,
  };
  const synced = (data.syncedLyrics as string | null | undefined) ?? null;
  const plain = (data.plainLyrics as string | null | undefined) ?? null;
  if (synced && synced.trim()) {
    return { status: "synced", lines: parseLrc(synced), source: "lrclib", meta };
  }
  if (plain && plain.trim()) {
    return { status: "plain", text: plain, source: "lrclib", meta };
  }
  return { status: "not_found" };
}

/**
 * Placeholder for future speech-to-text transcription. The UI calls this so the
 * flow is wired even before an STT provider is connected.
 */
export async function transcribeAudio(_file: File): Promise<LyricLine[]> {
  throw new Error(
    "Speech-to-text transcription is not enabled yet. Connect an STT provider to unlock automatic lyrics.",
  );
}
