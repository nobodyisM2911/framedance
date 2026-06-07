import { useEffect, useRef } from "react";
import { currentLyricIndex, type LyricLine } from "@/lib/lrc-parser";

export type LyricsPanelProps = {
  lyrics: LyricLine[];
  currentTime: number;
  onUpload?: (file: File) => void;
  onClear?: () => void;
  onSeek?: (time: number) => void;
  /** When no .lrc has been provided, show this CTA / placeholder. */
  placeholder?: string;
};

export function LyricsPanel({
  lyrics,
  currentTime,
  onUpload,
  onClear,
  onSeek,
  placeholder = "Upload a .lrc file to see synced lyrics here. Speech-to-text generation coming soon.",
}: LyricsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idx = currentLyricIndex(lyrics, currentTime);

  useEffect(() => {
    const list = listRef.current;
    if (!list || idx < 0) return;
    const active = list.querySelector<HTMLElement>(`[data-i="${idx}"]`);
    if (active) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [idx]);

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Lyrics
        </h3>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".lrc,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload?.(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {lyrics.length ? "Replace" : "Upload .lrc"}
          </button>
          {lyrics.length > 0 && (
            <button
              onClick={onClear}
              className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-4 text-sm leading-relaxed"
        style={{ maxHeight: 360 }}
      >
        {lyrics.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {placeholder}
          </p>
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
