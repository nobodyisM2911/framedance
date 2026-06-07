import { useEffect, useMemo, useRef } from "react";
import { countForTime } from "@/lib/audio-analyzer";

export type BeatPoseMarker = {
  id: string;
  time: number;
};

export type BeatTimelineProps = {
  beats: number[];
  accents: number[];
  duration: number;
  currentTime: number;
  poses: BeatPoseMarker[];
  selectedPoseId?: string | null;
  beatsPerBar?: number;
  pxPerBeat?: number;
  onPoseSelect?: (id: string) => void;
  onPoseDrag?: (id: string, newTime: number) => void;
  onSeek?: (time: number) => void;
};

export function BeatTimeline({
  beats,
  accents,
  duration,
  currentTime,
  poses,
  selectedPoseId,
  beatsPerBar = 8,
  pxPerBeat = 36,
  onPoseSelect,
  onPoseDrag,
  onSeek,
}: BeatTimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const accentSet = useMemo(() => new Set(accents), [accents]);

  const period = beats.length > 1 ? beats[1] - beats[0] : 60 / 120;
  const pxPerSec = pxPerBeat / period;
  const totalWidth = Math.max(
    600,
    Math.ceil(((beats.length ? beats[beats.length - 1] : duration) + period) *
      pxPerSec),
  );

  const current = countForTime(currentTime, beats, beatsPerBar);
  const currentIdx = current?.index ?? -1;

  // Auto-scroll to keep current beat in view.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || currentIdx < 0) return;
    const x = currentIdx * pxPerBeat;
    const left = x - el.clientWidth / 2;
    el.scrollTo({ left, behavior: "smooth" });
  }, [currentIdx, pxPerBeat]);

  // Pose drag handling
  const dragState = useRef<{
    id: string;
    startX: number;
    startTime: number;
  } | null>(null);

  const startDrag = (e: React.PointerEvent, marker: BeatPoseMarker) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragState.current = {
      id: marker.id,
      startX: e.clientX,
      startTime: marker.time,
    };
    onPoseSelect?.(marker.id);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    const dt = (e.clientX - st.startX) / pxPerSec;
    const next = Math.max(0, Math.min(duration, st.startTime + dt));
    onPoseDrag?.(st.id, next);
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    dragState.current = null;
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    const el = scrollerRef.current;
    if (!el || !onSeek) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    onSeek(Math.max(0, Math.min(duration, x / pxPerSec)));
  };

  return (
    <div
      ref={scrollerRef}
      className="relative overflow-x-auto rounded-md border border-border bg-card"
    >
      <div
        className="relative h-24 select-none"
        style={{ width: totalWidth }}
        onClick={handleTrackClick}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Beat ticks + count labels */}
        {beats.map((t, i) => {
          const isAccent = accentSet.has(t) || i % beatsPerBar === 0;
          const isDownbeat = i % beatsPerBar === 0;
          const isCurrent = i === currentIdx;
          return (
            <div
              key={i}
              className="absolute top-0 flex h-full flex-col items-center"
              style={{ left: t * pxPerSec, transform: "translateX(-50%)" }}
            >
              <div
                className={`mt-6 w-px ${
                  isDownbeat
                    ? "h-10 bg-foreground"
                    : isAccent
                      ? "h-8 bg-foreground/70"
                      : "h-5 bg-border"
                }`}
              />
              <span
                className={`mt-1 font-mono text-[10px] ${
                  isCurrent
                    ? "text-foreground"
                    : isDownbeat
                      ? "text-foreground/70"
                      : "text-muted-foreground"
                }`}
              >
                {(i % beatsPerBar) + 1}
              </span>
              {isCurrent && (
                <div className="pointer-events-none absolute -top-1 h-full w-[2px] bg-foreground/80" />
              )}
            </div>
          );
        })}

        {/* Pose markers (draggable) */}
        {poses.map((p) => {
          const selected = p.id === selectedPoseId;
          return (
            <button
              key={p.id}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                startDrag(e, p);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPoseSelect?.(p.id);
              }}
              title="Drag to refine timing"
              className={`absolute top-1 -translate-x-1/2 cursor-grab active:cursor-grabbing rounded-full px-1.5 py-0.5 font-mono text-[10px] shadow-sm ${
                selected
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground border border-foreground/40"
              }`}
              style={{ left: p.time * pxPerSec }}
            >
              ◆
            </button>
          );
        })}
      </div>
    </div>
  );
}
