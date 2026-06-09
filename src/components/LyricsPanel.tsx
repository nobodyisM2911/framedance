import { useEffect, useMemo, useRef, useState } from "react";
import { currentLyricIndex, parseLrc, type LyricLine } from "@/lib/lrc-parser";
import { findLyrics, transcribeAudio } from "@/lib/lyrics-provider";

export type LyricsPanelProps = {
  lyrics: LyricLine[];
  currentTime: number;
  /** Source audio file (used for transcription fallback). */
  audioFile?: File | null;
  /** Best-known duration in seconds (helps LRCLIB match the right edit). */
  duration?: number;
  onChange: (lines: LyricLine[]) => void;
  onSeek?: (time: number) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; message: string }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "transcribing" };

export function LyricsPanel({
  lyrics,
  currentTime,
  audioFile,
  duration,
  onChange,
  onSeek,
}: LyricsPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [editing, setEditing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const idx = useMemo(() => currentLyricIndex(lyrics, currentTime), [lyrics, currentTime]);

  useEffect(() => {
    if (editing) return;
    const list = listRef.current;
    if (!list || idx < 0) return;
    const active = list.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx, editing]);

  const handleSearch = async () => {
    if (!title.trim() || !artist.trim()) {
      setStatus({ kind: "error", message: "Enter song title and artist." });
      return;
    }
    setStatus({ kind: "searching" });
    try {
      const r = await findLyrics(title, artist, duration);
      if (r.status === "synced") {
        onChange(r.lines);
        setStatus({
          kind: "found",
          message: `Synced lyrics from LRCLIB · ${r.meta.artistName} — ${r.meta.trackName}`,
        });
      } else if (r.status === "plain") {
        // Distribute plain lines evenly across the track as a starting point.
        const split = r.text.split(/\r?\n/).filter((l) => l.trim());
        const total = Math.max(duration ?? 0, 1);
        const step = total / Math.max(split.length, 1);
        onChange(split.map((text, i) => ({ time: i * step, text })));
        setStatus({
          kind: "found",
          message: "Plain lyrics found · timings estimated, edit to refine.",
        });
      } else {
        setStatus({ kind: "not_found" });
      }
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Lookup failed.",
      });
    }
  };

  const handleTranscribe = async () => {
    if (!audioFile) return;
    setStatus({ kind: "transcribing" });
    try {
      const lines = await transcribeAudio(audioFile);
      onChange(lines);
      setStatus({ kind: "found", message: "Transcribed from audio." });
    } catch (e) {
      setStatus({
        kind: "error",
        message:
          e instanceof Error
            ? e.message
            : "Transcription unavailable. Use search or upload a .lrc.",
      });
    }
  };

  const handleUpload = async (f: File) => {
    const text = await f.text();
    onChange(parseLrc(text));
    setStatus({ kind: "found", message: `Loaded ${f.name}` });
  };

  const updateLine = (i: number, patch: Partial<LyricLine>) => {
    const next = lyrics.map((l, j) => (j === i ? { ...l, ...patch } : l));
    next.sort((a, b) => a.time - b.time);
    onChange(next);
  };
  const removeLine = (i: number) => {
    onChange(lyrics.filter((_, j) => j !== i));
  };
  const addLine = () => {
    const t = Math.max(0, currentTime);
    onChange(
      [...lyrics, { time: t, text: "" }].sort((a, b) => a.time - b.time),
    );
  };

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Lyrics
        </h3>
        <div className="flex items-center gap-3">
          {lyrics.length > 0 && (
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              {editing ? "Done" : "Edit"}
            </button>
          )}
          {lyrics.length > 0 && (
            <button
              onClick={() => {
                onChange([]);
                setStatus({ kind: "idle" });
              }}
              className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Auto-detect controls */}
      <div className="space-y-2 border-b border-border px-3 py-3">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist"
            className="rounded border border-border bg-background px-2 py-1 text-xs"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSearch}
            disabled={status.kind === "searching"}
            className="rounded-md bg-foreground px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-background disabled:opacity-50"
          >
            {status.kind === "searching" ? "Searching…" : "Find lyrics"}
          </button>
          <button
            onClick={handleTranscribe}
            disabled={!audioFile || status.kind === "transcribing"}
            title="Speech-to-text fallback (requires STT provider)"
            className="rounded-md border border-border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {status.kind === "transcribing" ? "Transcribing…" : "Transcribe audio"}
          </button>
        </div>
        {status.kind !== "idle" && (
          <p className="text-[11px] text-muted-foreground">
            {status.kind === "found" && status.message}
            {status.kind === "not_found" &&
              "No lyrics found. Try a different spelling, transcribe, or upload a .lrc."}
            {status.kind === "error" && status.message}
            {status.kind === "searching" && "Searching LRCLIB…"}
            {status.kind === "transcribing" && "Transcribing audio…"}
          </p>
        )}

        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? "− Advanced" : "+ Advanced"}
        </button>
        {advancedOpen && (
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".lrc,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              Upload .lrc fallback
            </button>
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-4 text-sm leading-relaxed"
        style={{ maxHeight: 360 }}
      >
        {lyrics.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Enter the song title and artist above to auto-detect synced lyrics.
            Beat and pose timelines still work without lyrics.
          </p>
        ) : editing ? (
          <div className="space-y-1.5">
            {lyrics.map((line, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  step={0.05}
                  value={line.time.toFixed(2)}
                  onChange={(e) =>
                    updateLine(i, { time: parseFloat(e.target.value) || 0 })
                  }
                  className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-[11px]"
                />
                <input
                  value={line.text}
                  onChange={(e) => updateLine(i, { text: e.target.value })}
                  className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs"
                />
                <button
                  onClick={() => removeLine(i)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={addLine}
              className="mt-2 w-full rounded border border-dashed border-border py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              + Add line at {currentTime.toFixed(2)}s
            </button>
          </div>
        ) : (
          lyrics.map((line, i) => (
            <button
              key={`${line.time}-${i}`}
              data-i={i}
              onClick={() => onSeek?.(line.time)}
              className={`block w-full rounded px-2 py-1 text-left transition ${
                i === idx
                  ? "bg-foreground/5 font-serif text-base text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {line.text || <span className="italic opacity-60">·</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
