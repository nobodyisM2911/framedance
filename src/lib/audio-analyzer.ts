import { analyze as detectBpm } from "web-audio-beat-detector";

export type AudioAnalysis = {
  duration: number;
  bpm: number;
  /** First beat time in seconds (downbeat / first count) */
  firstBeat: number;
  /** All beat timestamps in seconds (uniform from bpm + firstBeat) */
  beats: number[];
  /** Strong-beat (every 4th by default) timestamps */
  accents: number[];
  /** Energy envelope sampled every `energyStep` seconds */
  energy: { time: number; value: number }[];
  energyStep: number;
  /** Times of local-maxima energy peaks */
  peaks: number[];
  /** Times where energy drops sharply */
  drops: number[];
};

/**
 * Decode the audio track of a video/audio File into an AudioBuffer.
 * Falls back to a stereo decode via the platform AudioContext.
 */
export async function decodeAudio(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  // Use a temporary AudioContext just to access decodeAudioData.
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Compute mono RMS envelope sampled every `step` seconds (default 50ms). */
function computeEnergy(
  buffer: AudioBuffer,
  step = 0.05,
): { time: number; value: number }[] {
  const sr = buffer.sampleRate;
  const samplesPerWindow = Math.max(1, Math.floor(step * sr));
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  const length = buffer.length;
  const out: { time: number; value: number }[] = [];
  for (let i = 0; i < length; i += samplesPerWindow) {
    let sum = 0;
    let count = 0;
    const end = Math.min(length, i + samplesPerWindow);
    for (let j = i; j < end; j++) {
      let v = 0;
      for (const ch of channels) v += ch[j];
      v /= channels.length;
      sum += v * v;
      count++;
    }
    out.push({
      time: i / sr,
      value: count ? Math.sqrt(sum / count) : 0,
    });
  }
  return out;
}

function findPeaks(
  envelope: { time: number; value: number }[],
  minGap: number,
  thresholdRatio = 1.6,
): number[] {
  if (envelope.length === 0) return [];
  const mean =
    envelope.reduce((a, b) => a + b.value, 0) / envelope.length || 1e-6;
  const threshold = mean * thresholdRatio;
  const peaks: number[] = [];
  let lastTime = -Infinity;
  for (let i = 1; i < envelope.length - 1; i++) {
    const v = envelope[i].value;
    if (
      v > threshold &&
      v > envelope[i - 1].value &&
      v >= envelope[i + 1].value &&
      envelope[i].time - lastTime >= minGap
    ) {
      peaks.push(envelope[i].time);
      lastTime = envelope[i].time;
    }
  }
  return peaks;
}

function findDrops(
  envelope: { time: number; value: number }[],
  minGap: number,
  ratio = 0.4,
): number[] {
  if (envelope.length < 10) return [];
  const window = 20; // ~1s lookback at 50ms step
  const drops: number[] = [];
  let lastTime = -Infinity;
  for (let i = window; i < envelope.length; i++) {
    let recent = 0;
    for (let j = i - window; j < i; j++) recent += envelope[j].value;
    recent /= window;
    if (
      recent > 1e-4 &&
      envelope[i].value < recent * ratio &&
      envelope[i].time - lastTime >= minGap
    ) {
      drops.push(envelope[i].time);
      lastTime = envelope[i].time;
    }
  }
  return drops;
}

export type AnalyzeAudioOptions = {
  /** Range of plausible BPMs. */
  bpmRange?: [number, number];
  /** Beats per accent (default 4 — every downbeat). */
  beatsPerAccent?: number;
};

export async function analyzeAudio(
  buffer: AudioBuffer,
  opts: AnalyzeAudioOptions = {},
): Promise<AudioAnalysis> {
  const duration = buffer.duration;
  let bpm = 120;
  try {
    bpm = await detectBpm(buffer);
  } catch {
    // detector occasionally fails on very short / silent buffers; use fallback
    bpm = 120;
  }
  // Clamp to a sensible dance-music range.
  const [minBpm, maxBpm] = opts.bpmRange ?? [70, 180];
  while (bpm < minBpm) bpm *= 2;
  while (bpm > maxBpm) bpm /= 2;

  const energy = computeEnergy(buffer, 0.05);
  const beatPeriod = 60 / bpm;

  // Estimate the first beat as the strongest early energy peak within
  // the first two beats; fall back to 0.
  const earlyPeaks = findPeaks(
    energy.filter((e) => e.time < beatPeriod * 2.5),
    beatPeriod * 0.4,
    1.2,
  );
  const firstBeat = earlyPeaks[0] ?? 0;

  const beats: number[] = [];
  for (let t = firstBeat; t < duration; t += beatPeriod) {
    beats.push(t);
  }
  const beatsPerAccent = Math.max(1, opts.beatsPerAccent ?? 4);
  const accents = beats.filter((_, i) => i % beatsPerAccent === 0);

  const peaks = findPeaks(energy, beatPeriod * 0.9, 1.6);
  const drops = findDrops(energy, beatPeriod * 2, 0.4);

  return {
    duration,
    bpm,
    firstBeat,
    beats,
    accents,
    energy,
    energyStep: 0.05,
    peaks,
    drops,
  };
}

/**
 * Re-derive beats from an existing analysis with adjusted firstBeat (the
 * "first count" position). Cheap — does not re-run BPM detection.
 */
export function rebuildBeats(
  bpm: number,
  firstBeat: number,
  duration: number,
  beatsPerAccent = 4,
): { beats: number[]; accents: number[] } {
  const period = 60 / bpm;
  const beats: number[] = [];
  // Start from the earliest beat <= 0 then walk forward.
  let t = firstBeat;
  while (t > 0) t -= period;
  for (; t < duration; t += period) {
    if (t >= -1e-6) beats.push(Math.max(0, t));
  }
  const accents = beats.filter((_, i) => i % beatsPerAccent === 0);
  return { beats, accents };
}

/**
 * Index in 1..beatsPerBar for the beat closest to `time` (or null if no
 * beats are available). Used to render the "1 2 3 ... 8" count.
 */
export function countForTime(
  time: number,
  beats: number[],
  beatsPerBar = 8,
): { index: number; count: number } | null {
  if (beats.length === 0) return null;
  // Binary search for the nearest beat at or before `time`.
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  // If we're closer to the next beat, round up.
  let idx = lo;
  if (
    idx + 1 < beats.length &&
    Math.abs(beats[idx + 1] - time) < Math.abs(beats[idx] - time)
  ) {
    idx = idx + 1;
  }
  return { index: idx, count: (idx % beatsPerBar) + 1 };
}
