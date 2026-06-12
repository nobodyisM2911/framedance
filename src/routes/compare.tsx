import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Stillframe — Compare" },
      {
        name: "description",
        content:
          "Compare teacher and student dance videos side by side with sync offset and export.",
      },
    ],
  }),
  component: ComparePage,
});

function fmt(t: number) {
  if (!isFinite(t)) return "0:00.00";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function ComparePage() {
  const teacherRef = useRef<HTMLVideoElement>(null);
  const studentRef = useRef<HTMLVideoElement>(null);
  const [teacherUrl, setTeacherUrl] = useState<string | null>(null);
  const [studentUrl, setStudentUrl] = useState<string | null>(null);
  const teacherFile = useRef<File | null>(null);
  const studentFile = useRef<File | null>(null);
  // Offset in seconds: positive = student starts later (student waits)
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string>("");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);

  useEffect(() => () => {
    if (teacherUrl) URL.revokeObjectURL(teacherUrl);
  }, [teacherUrl]);
  useEffect(() => () => {
    if (studentUrl) URL.revokeObjectURL(studentUrl);
  }, [studentUrl]);
  useEffect(() => () => {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
  }, [exportUrl]);

  const onTeacher = (f: File) => {
    teacherFile.current = f;
    if (teacherUrl) URL.revokeObjectURL(teacherUrl);
    setTeacherUrl(URL.createObjectURL(f));
  };
  const onStudent = (f: File) => {
    studentFile.current = f;
    if (studentUrl) URL.revokeObjectURL(studentUrl);
    setStudentUrl(URL.createObjectURL(f));
  };

  // Apply offset: student.currentTime = teacher.currentTime - offset
  const syncStudentToTeacher = useCallback(() => {
    const t = teacherRef.current;
    const s = studentRef.current;
    if (!t || !s) return;
    const target = Math.max(0, t.currentTime - offset);
    if (Math.abs(s.currentTime - target) > 0.05) s.currentTime = target;
  }, [offset]);

  useEffect(() => {
    syncStudentToTeacher();
  }, [offset, syncStudentToTeacher]);

  const togglePlay = useCallback(async () => {
    const t = teacherRef.current;
    const s = studentRef.current;
    if (!t || !s) return;
    if (t.paused) {
      syncStudentToTeacher();
      await Promise.all([t.play().catch(() => {}), s.play().catch(() => {})]);
      setPlaying(true);
    } else {
      t.pause();
      s.pause();
      setPlaying(false);
    }
  }, [syncStudentToTeacher]);

  const restart = useCallback(() => {
    const t = teacherRef.current;
    const s = studentRef.current;
    if (!t || !s) return;
    t.currentTime = 0;
    s.currentTime = Math.max(0, -offset);
  }, [offset]);

  // Keep student in sync when teacher seeks.
  useEffect(() => {
    const t = teacherRef.current;
    if (!t) return;
    const onSeek = () => syncStudentToTeacher();
    t.addEventListener("seeked", onSeek);
    return () => t.removeEventListener("seeked", onSeek);
  }, [teacherUrl, syncStudentToTeacher]);

  // Mute student so we hear only teacher track during preview.
  useEffect(() => {
    if (studentRef.current) studentRef.current.muted = true;
  }, [studentUrl]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay]);

  const exportSideBySide = useCallback(async () => {
    const tFile = teacherFile.current;
    const sFile = studentFile.current;
    if (!tFile || !sFile) return;
    setExporting(true);
    setExportProgress(0);
    setExportMsg("Preparing videos…");
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl);
      setExportUrl(null);
    }

    teacherRef.current?.pause();
    studentRef.current?.pause();
    setPlaying(false);

    const tVid = document.createElement("video");
    const sVid = document.createElement("video");
    tVid.src = URL.createObjectURL(tFile);
    sVid.src = URL.createObjectURL(sFile);
    tVid.muted = false;
    sVid.muted = true;
    tVid.playsInline = true;
    sVid.playsInline = true;

    const cleanupVids = () => {
      URL.revokeObjectURL(tVid.src);
      URL.revokeObjectURL(sVid.src);
    };

    try {
      if (
        typeof MediaRecorder === "undefined" ||
        !HTMLCanvasElement.prototype.captureStream
      ) {
        throw new Error(
          "Export is not supported in this browser. Please try Chrome desktop.",
        );
      }

      await Promise.all([
        new Promise<void>((res, rej) => {
          tVid.onloadedmetadata = () => res();
          tVid.onerror = () => rej(new Error("Failed to load teacher video"));
        }),
        new Promise<void>((res, rej) => {
          sVid.onloadedmetadata = () => res();
          sVid.onerror = () => rej(new Error("Failed to load student video"));
        }),
      ]);

      const tStart = offset > 0 ? offset : 0;
      const sStart = offset < 0 ? -offset : 0;
      const tDur = Math.max(0, tVid.duration - tStart);
      const sDur = Math.max(0, sVid.duration - sStart);
      const totalDur = Math.min(tDur, sDur);
      if (!isFinite(totalDur) || totalDur <= 0) {
        throw new Error("Videos do not overlap with the current sync offset.");
      }

      tVid.currentTime = tStart;
      sVid.currentTime = sStart;
      await Promise.all([
        new Promise<void>((res) => {
          tVid.onseeked = () => res();
        }),
        new Promise<void>((res) => {
          sVid.onseeked = () => res();
        }),
      ]);

      const cellW = 960;
      const cellH = 1080;
      const canvas = document.createElement("canvas");
      canvas.width = cellW * 2;
      canvas.height = cellH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cover-fit: scale so the video fills the cell, cropping equally from
      // the longer axis. Removes black bars so dancers fill the frame.
      const drawFitted = (
        v: HTMLVideoElement,
        x: number,
        y: number,
        w: number,
        h: number,
      ) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(x, y, w, h);
        if (!v.videoWidth || !v.videoHeight) return;
        const srcAspect = v.videoWidth / v.videoHeight;
        const dstAspect = w / h;
        let sx = 0;
        let sy = 0;
        let sw = v.videoWidth;
        let sh = v.videoHeight;
        if (srcAspect > dstAspect) {
          sw = v.videoHeight * dstAspect;
          sx = (v.videoWidth - sw) / 2;
        } else {
          sh = v.videoWidth / dstAspect;
          sy = (v.videoHeight - sh) / 2;
        }
        ctx.drawImage(v, sx, sy, sw, sh, x, y, w, h);
      };

      const fps = 30;
      const stream = canvas.captureStream(fps);

      try {
        const AC: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (AC) {
          const ac = new AC();
          const src = ac.createMediaElementSource(tVid);
          const dest = ac.createMediaStreamDestination();
          src.connect(dest);
          dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
        }
      } catch (err) {
        console.warn("[export] audio capture skipped", err);
      }

      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mimeType =
        mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      setExportMsg("Recording side-by-side video…");

      const stopped = new Promise<void>((res) => {
        recorder.onstop = () => res();
      });

      recorder.start(250);
      await Promise.all([tVid.play(), sVid.play()]);

      const startWall = performance.now();
      let stopping = false;

      await new Promise<void>((resolve) => {
        const tick = () => {
          drawFitted(tVid, 0, 0, cellW, cellH);
          drawFitted(sVid, cellW, 0, cellW, cellH);
          const elapsed = (performance.now() - startWall) / 1000;
          const progress = Math.min(1, elapsed / totalDur);
          setExportProgress(progress);
          if (!stopping && (elapsed >= totalDur || tVid.ended || sVid.ended)) {
            stopping = true;
            tVid.pause();
            sVid.pause();
            try {
              recorder.stop();
            } catch (err) {
              console.warn("[export] recorder.stop failed", err);
            }
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await stopped;

      const blob = new Blob(chunks, { type: mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      setExportUrl(url);
      setExportProgress(1);
      setExportMsg("Export complete");
    } catch (e) {
      console.error("[export] failed", e);
      setExportMsg(
        `Export failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setExporting(false);
    }
  }, [offset, exportUrl]);


  const both = teacherUrl && studentUrl;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between px-6 py-7">
          <div className="flex items-baseline gap-8">
            <Link to="/" className="font-serif text-[1.75rem] font-normal leading-none tracking-normal">
              Stillframe
            </Link>
            <nav className="flex gap-6 text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground">
              <Link to="/" className="hover:text-foreground">
                Practice
              </Link>
              <Link
                to="/compare"
                className="text-foreground"
                activeProps={{ className: "text-foreground" }}
              >
                Compare
              </Link>
            </nav>
          </div>
          <p className="text-[0.7rem] uppercase tracking-[0.28em] text-muted-foreground">
            Side by side
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="grid gap-4 md:grid-cols-2">
          <VideoSlot
            label="Teacher"
            url={teacherUrl}
            onFile={onTeacher}
            videoRef={teacherRef}
          />
          <VideoSlot
            label="Student"
            url={studentUrl}
            onFile={onStudent}
            videoRef={studentRef}
          />
        </div>

        {both && (
          <>
            <section className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div className="flex-1 min-w-[280px] space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Sync offset
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {offset >= 0 ? "+" : ""}
                    {offset.toFixed(2)}s
                  </span>
                </div>
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.05}
                  value={offset}
                  onChange={(e) => setOffset(parseFloat(e.target.value))}
                  className="w-full accent-foreground"
                />
                <div className="flex gap-2">
                  {[-0.5, -0.1, 0, 0.1, 0.5].map((d) => (
                    <button
                      key={d}
                      onClick={() =>
                        setOffset((o) =>
                          d === 0
                            ? 0
                            : Math.max(-5, Math.min(5, +(o + d).toFixed(2))),
                        )
                      }
                      className="rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {d === 0 ? "reset" : `${d > 0 ? "+" : ""}${d}s`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={restart}>
                  Restart
                </Button>
                <Button onClick={togglePlay}>
                  {playing ? "Pause both" : "Play both"}
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-serif text-lg">Export</h2>
                <span className="text-xs text-muted-foreground">
                  Side-by-side WebM via Canvas + MediaRecorder
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={exportSideBySide} disabled={exporting}>
                  {exporting
                    ? `Exporting ${Math.round(exportProgress * 100)}%`
                    : "Export comparison"}
                </Button>
                {exportMsg && (
                  <span className="text-xs text-muted-foreground">
                    {exportMsg}
                  </span>
                )}
                {exportUrl && (
                  <a
                    href={exportUrl}
                    download="comparison.webm"
                    className="text-xs underline underline-offset-4 hover:text-foreground"
                  >
                    Download comparison.webm
                  </a>
                )}
              </div>
              {exportUrl && (
                <video
                  src={exportUrl}
                  controls
                  className="w-full rounded-md bg-black"
                />
              )}
            </section>
          </>
        )}

        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Space play · drag slider to align student with teacher
        </p>
      </main>
    </div>
  );
}

function VideoSlot({
  label,
  url,
  onFile,
  videoRef,
}: {
  label: string;
  url: string | null;
  onFile: (f: File) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </h3>
        {url && (
          <button
            onClick={() => inputRef.current?.click()}
            className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            Replace
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {url ? (
        <div className="overflow-hidden rounded-md bg-black">
          <video
            ref={videoRef}
            src={url}
            className="aspect-video w-full"
            playsInline
          />
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f && f.type.startsWith("video/")) onFile(f);
          }}
          className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card text-center text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground"
        >
          <span className="font-serif text-xl text-foreground">
            Upload {label.toLowerCase()} video
          </span>
          <span className="text-xs">Click or drop a file</span>
        </button>
      )}
    </div>
  );
}

// Avoid unused import warning for fmt during incremental dev.
void fmt;
