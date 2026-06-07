import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
  type NormalizedLandmark,
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

export type Sensitivity = "low" | "medium" | "high";

export type DetectedPose = {
  id: string;
  time: number;
  thumbnail: string;
  movement: number;
  landmarks: NormalizedLandmark[];
};

// MediaPipe Pose landmark indices
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;

/**
 * Normalize landmarks to torso-relative coordinates so scale/position don't
 * dominate the movement score. Origin = mid-hip; unit = torso length
 * (mid-shoulder to mid-hip distance).
 */
function normalizeLandmarks(
  lms: NormalizedLandmark[],
): NormalizedLandmark[] | null {
  if (!lms || lms.length < 33) return null;
  const ls = lms[L_SHOULDER];
  const rs = lms[R_SHOULDER];
  const lh = lms[L_HIP];
  const rh = lms[R_HIP];
  const midShoulder = {
    x: (ls.x + rs.x) / 2,
    y: (ls.y + rs.y) / 2,
    z: ((ls.z ?? 0) + (rs.z ?? 0)) / 2,
  };
  const midHip = {
    x: (lh.x + rh.x) / 2,
    y: (lh.y + rh.y) / 2,
    z: ((lh.z ?? 0) + (rh.z ?? 0)) / 2,
  };
  const dx = midShoulder.x - midHip.x;
  const dy = midShoulder.y - midHip.y;
  const torso = Math.sqrt(dx * dx + dy * dy);
  if (torso < 1e-4) return null;
  return lms.map((p) => ({
    x: (p.x - midHip.x) / torso,
    y: (p.y - midHip.y) / torso,
    z: ((p.z ?? 0) - midHip.z) / torso,
    visibility: p.visibility,
  })) as NormalizedLandmark[];
}

function movementScore(
  a: NormalizedLandmark[],
  b: NormalizedLandmark[],
): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    const dz = (a[i].z ?? 0) - (b[i].z ?? 0);
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
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
  });
}

function captureThumbnail(video: HTMLVideoElement, width = 240): string {
  const ratio = video.videoHeight / video.videoWidth || 0.5625;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export type AnalyzeOptions = {
  fps?: number;
  sensitivity: Sensitivity;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
  /** Optional rhythm cues to bias key-pose selection toward beats/accents. */
  beats?: number[];
  accents?: number[];
};

type Sample = {
  time: number;
  movement: number;
  landmarks: NormalizedLandmark[] | null;
};

// Sensitivity tuning: percentile of movement scores used as the stillness
// threshold, and minimum spacing between accepted poses.
const SENS_CONFIG: Record<
  Sensitivity,
  { pct: number; minGap: number }
> = {
  low: { pct: 0.1, minGap: 1.2 }, // fewer major poses
  medium: { pct: 0.25, minGap: 0.6 }, // main poses
  high: { pct: 0.5, minGap: 0.4 }, // more small poses
};

function smooth(values: number[], window = 3): number[] {
  const out = new Array(values.length);
  const r = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - r; j <= i + r; j++) {
      if (j < 0 || j >= values.length) continue;
      const v = values[j];
      if (!isFinite(v)) continue;
      sum += v;
      count++;
    }
    out[i] = count ? sum / count : Number.POSITIVE_INFINITY;
  }
  return out;
}

/** Closeness 0..1 to the nearest time in `times` within `radius` seconds. */
function proximity(time: number, times: number[], radius: number): number {
  if (!times || times.length === 0 || radius <= 0) return 0;
  // Binary search for nearest neighbor.
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [times[lo]];
  if (lo > 0) candidates.push(times[lo - 1]);
  let best = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - time);
    if (d < best) best = d;
  }
  if (best > radius) return 0;
  return 1 - best / radius;
}

/**
 * Direction-change score for samples[i]: angle between (i → i-1) and
 * (i+1 → i) landmark-velocity vectors, averaged across landmarks.
 * Higher = more direction reversal (i.e. a turning point in motion).
 */
function directionChangeScore(
  prev: NormalizedLandmark[] | null,
  curr: NormalizedLandmark[] | null,
  next: NormalizedLandmark[] | null,
): number {
  if (!prev || !curr || !next) return 0;
  const n = Math.min(prev.length, curr.length, next.length);
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v1x = curr[i].x - prev[i].x;
    const v1y = curr[i].y - prev[i].y;
    const v2x = next[i].x - curr[i].x;
    const v2y = next[i].y - curr[i].y;
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 < 1e-4 || m2 < 1e-4) continue;
    const cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    // 0 when same direction, 1 when reversed.
    total += (1 - Math.max(-1, Math.min(1, cos))) / 2;
    count++;
  }
  return count ? total / count : 0;
}


export async function analyzeVideo(
  video: HTMLVideoElement,
  opts: AnalyzeOptions,
): Promise<DetectedPose[]> {
  const landmarker = await getPoseLandmarker();
  const fps = opts.fps ?? 8;
  const dt = 1 / fps;
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) return [];

  const wasPaused = video.paused;
  video.pause();

  // Pass 1: sample landmarks + raw movement
  const samples: Sample[] = [];
  let prev: NormalizedLandmark[] | null = null;
  for (let t = 0; t < duration; t += dt) {
    if (opts.signal?.aborted) break;
    await seekTo(video, t);
    const result: PoseLandmarkerResult = landmarker.detectForVideo(
      video,
      performance.now(),
    );
    const norm = result.landmarks[0]
      ? normalizeLandmarks(result.landmarks[0])
      : null;
    let movement = Number.POSITIVE_INFINITY;
    if (prev && norm) movement = movementScore(prev, norm);
    samples.push({ time: t, movement, landmarks: norm });
    if (norm) prev = norm;
    opts.onProgress?.((t / duration) * 0.9);
  }

  // Smooth movement scores to reduce jitter
  const smoothed = smooth(
    samples.map((s) => s.movement),
    3,
  );
  smoothed.forEach((m, i) => (samples[i].movement = m));

  // Threshold from sensitivity percentile of finite movement values
  const finite = smoothed.filter((v) => isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return [];
  const { pct, minGap } = SENS_CONFIG[opts.sensitivity];
  const threshold = finite[Math.floor((finite.length - 1) * pct)];

  // Local minima below threshold, spaced by minGap
  const poses: DetectedPose[] = [];
  let lastTime = -Infinity;
  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    if (!isFinite(s.movement) || s.movement > threshold) continue;
    if (!s.landmarks) continue;
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
        movement: s.movement,
        landmarks: s.landmarks,
      });
      lastTime = s.time;
    }
  }

  opts.onProgress?.(1);
  if (!wasPaused) video.play().catch(() => {});
  return poses;
}

export async function captureCurrentPose(
  video: HTMLVideoElement,
): Promise<DetectedPose> {
  const thumb = captureThumbnail(video);
  let landmarks: NormalizedLandmark[] = [];
  try {
    const landmarker = await getPoseLandmarker();
    const result = landmarker.detectForVideo(video, performance.now());
    const norm = result.landmarks[0]
      ? normalizeLandmarks(result.landmarks[0])
      : null;
    if (norm) landmarks = norm;
  } catch {
    // ignore — manual mark still works without landmarks
  }
  return {
    id: `${video.currentTime.toFixed(3)}-${Math.random().toString(36).slice(2, 7)}`,
    time: video.currentTime,
    thumbnail: thumb,
    movement: 0,
    landmarks,
  };
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs}`;
}
