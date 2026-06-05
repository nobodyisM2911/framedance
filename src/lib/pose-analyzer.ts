import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
    })();
  }
  return landmarkerPromise;
}

export type PoseSample = {
  time: number;
  movement: number;
};

export type DetectedPose = {
  id: string;
  time: number;
  thumbnail: string;
};

function landmarksDistance(
  a: PoseLandmarkerResult,
  b: PoseLandmarkerResult,
): number {
  const la = a.landmarks[0];
  const lb = b.landmarks[0];
  if (!la || !lb) return Number.POSITIVE_INFINITY;
  let sum = 0;
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    const dx = la[i].x - lb[i].x;
    const dy = la[i].y - lb[i].y;
    const dz = (la[i].z ?? 0) - (lb[i].z ?? 0);
    sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return sum / n;
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.min(time, video.duration - 0.001);
  });
}

function captureThumbnail(
  video: HTMLVideoElement,
  width = 240,
): string {
  const ratio = video.videoHeight / video.videoWidth || 0.5625;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}

export type AnalyzeOptions = {
  fps?: number;
  sensitivity: number; // 0..1; higher = more poses
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

export async function analyzeVideo(
  video: HTMLVideoElement,
  opts: AnalyzeOptions,
): Promise<DetectedPose[]> {
  const landmarker = await getPoseLandmarker();
  const fps = opts.fps ?? 8;
  const dt = 1 / fps;
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const samples: { time: number; movement: number }[] = [];
  let prev: PoseLandmarkerResult | null = null;
  const wasPaused = video.paused;
  video.pause();

  for (let t = 0; t < duration; t += dt) {
    if (opts.signal?.aborted) break;
    await seekTo(video, t);
    const result = landmarker.detectForVideo(video, performance.now());
    if (prev) {
      const d = landmarksDistance(prev, result);
      samples.push({ time: t, movement: d });
    } else {
      samples.push({ time: t, movement: Number.POSITIVE_INFINITY });
    }
    prev = result;
    opts.onProgress?.(t / duration);
  }

  // Determine threshold from sensitivity (lower threshold = stricter stillness)
  const finite = samples.map((s) => s.movement).filter((v) => isFinite(v));
  finite.sort((a, b) => a - b);
  if (finite.length === 0) return [];
  // sensitivity 0 -> bottom 5%, 1 -> bottom 50%
  const pct = 0.05 + opts.sensitivity * 0.45;
  const threshold = finite[Math.floor((finite.length - 1) * pct)];

  // Find local minima below threshold, with min gap
  const minGap = 0.6; // seconds
  const poses: DetectedPose[] = [];
  let lastTime = -Infinity;
  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    if (!isFinite(s.movement) || s.movement > threshold) continue;
    if (
      s.movement <= samples[i - 1].movement &&
      s.movement <= samples[i + 1].movement &&
      s.time - lastTime >= minGap
    ) {
      await seekTo(video, s.time);
      const thumb = captureThumbnail(video);
      poses.push({
        id: `${s.time.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`,
        time: s.time,
        thumbnail: thumb,
      });
      lastTime = s.time;
    }
  }

  if (!wasPaused) video.play().catch(() => {});
  return poses;
}

export async function captureCurrentPose(
  video: HTMLVideoElement,
): Promise<DetectedPose> {
  const thumb = captureThumbnail(video);
  return {
    id: `${video.currentTime.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`,
    time: video.currentTime,
    thumbnail: thumb,
  };
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs}`;
}
