import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  analyzeVideo,
  captureCurrentPose,
  formatTime,
  type DetectedPose,
  type Sensitivity,
} from "@/lib/pose-analyzer";

const SENSITIVITY_LEVELS: { value: Sensitivity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Stillframe — Dance practice" },
      {
        name: "description",
        content:
          "Upload a dance video and auto-detect key poses to study frame by frame.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [poses, setPoses] = useState<DetectedPose[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sensitivity, setSensitivity] = useState(0.5);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const onFile = (file: File) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setPoses([]);
    setVideoUrl(URL.createObjectURL(file));
  };

  const runAnalysis = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 1) {
      await new Promise<void>((r) => {
        const cb = () => {
          video.removeEventListener("loadedmetadata", cb);
          r();
        };
        video.addEventListener("loadedmetadata", cb);
      });
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setAnalyzing(true);
    setProgress(0);
    try {
      const result = await analyzeVideo(video, {
        sensitivity,
        onProgress: setProgress,
        signal: ctrl.signal,
      });
      setPoses((prev) =>
        [...prev, ...result].sort((a, b) => a.time - b.time),
      );
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
      setProgress(1);
    }
  }, [sensitivity]);

  const addCurrent = async () => {
    const video = videoRef.current;
    if (!video) return;
    const pose = await captureCurrentPose(video);
    setPoses((prev) => [...prev, pose].sort((a, b) => a.time - b.time));
  };

  const jumpTo = (t: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    video.pause();
  };

  const removePose = (id: string) => {
    setPoses((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between px-6 py-5">
          <h1 className="font-serif text-2xl tracking-tight">Stillframe</h1>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Dance practice
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {!videoUrl ? (
          <Uploader onFile={onFile} />
        ) : (
          <div className="space-y-8">
            <div className="overflow-hidden rounded-md bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="aspect-video w-full"
              />
            </div>

            <section className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Sensitivity
                  </label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {Math.round(sensitivity * 100)}
                  </span>
                </div>
                <Slider
                  value={[sensitivity]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => setSensitivity(v[0])}
                  disabled={analyzing}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={addCurrent}
                  disabled={analyzing}
                >
                  Mark current frame
                </Button>
                <Button onClick={runAnalysis} disabled={analyzing}>
                  {analyzing
                    ? `Analyzing ${Math.round(progress * 100)}%`
                    : poses.length
                      ? "Re-analyze"
                      : "Detect poses"}
                </Button>
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-serif text-lg">Poses</h2>
                <span className="text-xs text-muted-foreground">
                  {poses.length} {poses.length === 1 ? "frame" : "frames"}
                </span>
              </div>
              {poses.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  No poses yet. Run detection or mark a frame manually.
                </p>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {poses.map((p) => (
                    <PoseCard
                      key={p.id}
                      pose={p}
                      onJump={() => jumpTo(p.time)}
                      onDelete={() => removePose(p.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Uploader({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border bg-card px-6 py-24 text-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("video/")) onFile(file);
      }}
    >
      <h2 className="font-serif text-3xl tracking-tight">
        Study your dance, frame by frame.
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Upload a video. We&rsquo;ll find the still moments — the shapes
        between motion — and lay them out for you to scrub through.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <Button className="mt-2" onClick={() => inputRef.current?.click()}>
        Choose a video
      </Button>
      <p className="text-xs text-muted-foreground">or drop a file here</p>
    </div>
  );
}

function PoseCard({
  pose,
  onJump,
  onDelete,
}: {
  pose: DetectedPose;
  onJump: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative shrink-0">
      <button
        onClick={onJump}
        className="block overflow-hidden rounded-md border border-border bg-card transition hover:border-foreground/40"
      >
        <img
          src={pose.thumbnail}
          alt={`Pose at ${formatTime(pose.time)}`}
          className="h-28 w-auto"
        />
        <div className="flex items-center justify-between px-2 py-1 font-mono text-[10px] text-muted-foreground">
          <span>{formatTime(pose.time)}</span>
        </div>
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete pose"
        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-background/90 text-xs text-foreground shadow-sm group-hover:flex"
      >
        ×
      </button>
    </div>
  );
}
