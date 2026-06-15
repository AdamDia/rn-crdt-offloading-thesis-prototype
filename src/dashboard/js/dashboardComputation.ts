import type {DashboardComputationResult} from '../types';

const MOVING_AVG_WINDOW = 20;
const CHART_SAMPLE_SIZE = 60;

function clamp01(x: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }
  return x;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / values.length;
}

function computeTrendSlope(values: number[]): number {
  // Simple linear regression slope (y over x) for x = 0..n-1.
  const n = values.length;
  if (n < 2) {
    return 0;
  }

  const xMean = (n - 1) / 2;
  const yMean = mean(values);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - xMean;
    const dy = values[i] - yMean;
    num += dx * dy;
    den += dx * dx;
  }
  if (den === 0) {
    return 0;
  }
  return num / den;
}

function checksumNumberSeries(values: number[]): number {
  // Deterministic integer checksum suitable for JS vs native comparison.
  // Quantize to 1e6 and mix with a small rolling modular hash (no bitwise ops).
  let h = 1_000_003;
  const mod = 2_147_483_647; // prime-ish (2^31-1)
  for (let i = 0; i < values.length; i += 1) {
    const q = Math.trunc(values[i] * 1_000_000);
    h = (Math.imul(h, 1_664_525) + q + 1_013_904_223) % mod;
  }
  return h;
}

function generateTelemetryPoint(i: number): number {
  // Deterministic synthetic signal:
  // - base sine/cosine components
  // - small modular variation to avoid perfect periodicity
  const a = Math.sin(i * 0.17);
  const b = Math.cos(i * 0.07) * 0.55;
  const c = ((i % 97) / 97) * 0.15;
  const d = ((i % 19) - 9) * 0.0025;
  return a + b + c + d;
}

function movingAverage(values: number[], windowSize: number): number[] {
  const n = values.length;
  if (n === 0) {
    return [];
  }
  const w = Math.max(1, Math.floor(windowSize));

  const out: number[] = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += values[i];
    if (i >= w) {
      sum -= values[i - w];
    }
    const denom = i + 1 < w ? i + 1 : w;
    out[i] = sum / denom;
  }
  return out;
}

function sampleEvenly(values: number[], sampleSize: number): number[] {
  const n = values.length;
  const k = Math.max(0, Math.floor(sampleSize));
  if (n === 0 || k === 0) {
    return [];
  }
  if (n <= k) {
    return [...values];
  }

  const out: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const t = i / (k - 1);
    const idx = Math.min(n - 1, Math.round(t * (n - 1)));
    out.push(values[idx]);
  }
  return out;
}

export function runDashboardComputation(
  size: number,
): DashboardComputationResult {
  const n = Math.max(0, Math.floor(size));
  const telemetry: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    telemetry[i] = generateTelemetryPoint(i);
  }

  const smoothed = movingAverage(telemetry, MOVING_AVG_WINDOW);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of smoothed) {
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
  }
  if (!Number.isFinite(max)) {
    max = 0;
  }

  const average = mean(smoothed);
  const trend = computeTrendSlope(
    smoothed.slice(Math.max(0, smoothed.length - 200)),
  );

  const range = max - min;
  const normalizedAll =
    range <= 0
      ? smoothed.map(() => 0)
      : smoothed.map(v => clamp01((v - min) / range));

  const normalizedValues = sampleEvenly(normalizedAll, CHART_SAMPLE_SIZE);
  const checksum = checksumNumberSeries(normalizedValues);

  return {average, min, max, trend, normalizedValues, checksum};
}
