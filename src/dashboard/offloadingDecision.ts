export type OffloadingRecommendation =
  | 'native_beneficial'
  | 'bridge_cancels_benefit'
  | 'keep_js';

export const DECISION_HELPER_WARMUP_REPETITIONS = 1;
export const DECISION_HELPER_MEASURED_REPETITIONS = 5;
export const OFFLOADING_CHECKSUM_EPSILON = 1e-6;

export type OffloadingDecisionSummary = {
  workloadSize: number;
  warmupRepetitions: number;
  measuredRepetitions: number;
  jsChecksum: number;
  nativeChecksum: number;
  checksumDifference: number;
  checksumValid: boolean;
  jsMeanMs: number;
  jsStdDevMs: number;
  nativeInternalMeanMs: number;
  nativeInternalStdDevMs: number;
  nativeRoundTripMeanMs: number;
  nativeRoundTripStdDevMs: number;
  estimatedBridgeOverheadMeanMs: number;
  estimatedBridgeOverheadStdDevMs: number;
  recommendation: OffloadingRecommendation;
  reason: string;
};

export type ProfiledDashboardComputation = {
  nativeComputeTimeMs: number;
  checksum: number;
};

export type OffloadingDecisionInput = {
  workloadSize: number;
  jsComputeTimesMs: number[];
  nativeInternalTimesMs: number[];
  nativeRoundTripTimesMs: number[];
  jsChecksum: number;
  nativeChecksum: number;
  checksumEpsilon?: number;
};

export type OffloadingDecisionMeasuredSamples = {
  jsComputeTimesMs: number[];
  nativeInternalTimesMs: number[];
  nativeRoundTripTimesMs: number[];
  maxMeasuredRoundTripMs: number;
};

export type OffloadingDecisionProtocolResult = {
  summary: OffloadingDecisionSummary;
  samples: OffloadingDecisionMeasuredSamples;
};

export type RunOffloadingDecisionProtocolInput = {
  workloadSize: number;
  nowMs: () => number;
  runJsComputation: () => {checksum: number};
  runNativeComputation: () => Promise<ProfiledDashboardComputation>;
  isCancelled?: () => boolean;
  onWarmupStart?: () => void;
  onMeasuredRepetitionStart?: (repetition: number, total: number) => void;
};

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

export function sampleStdDev(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const average = mean(values);
  let varianceSum = 0;
  for (const value of values) {
    const delta = value - average;
    varianceSum += delta * delta;
  }

  return Math.sqrt(varianceSum / (values.length - 1));
}

export function estimateBridgeOverheadMs(
  nativeRoundTripTimeMs: number,
  nativeComputeTimeMs: number,
): number {
  return Math.max(0, nativeRoundTripTimeMs - nativeComputeTimeMs);
}

export function checksumsMatch(
  left: number,
  right: number,
  epsilon: number = OFFLOADING_CHECKSUM_EPSILON,
): boolean {
  return Math.abs(left - right) <= epsilon;
}

export function selectOffloadingRecommendation(
  jsMeanMs: number,
  nativeInternalMeanMs: number,
  nativeRoundTripMeanMs: number,
): OffloadingRecommendation {
  if (nativeRoundTripMeanMs < jsMeanMs) {
    return 'native_beneficial';
  }

  if (nativeInternalMeanMs < jsMeanMs) {
    return 'bridge_cancels_benefit';
  }

  return 'keep_js';
}

function recommendationReason(
  recommendation: OffloadingRecommendation,
  jsMeanMs: number,
  nativeInternalMeanMs: number,
    nativeRoundTripMeanMs: number,
): string {
  switch (recommendation) {
    case 'native_beneficial':
      return `Classic Bridge round-trip mean (${nativeRoundTripMeanMs.toFixed(3)} ms) is lower than JavaScript compute mean (${jsMeanMs.toFixed(3)} ms).`;
    case 'bridge_cancels_benefit':
      return `Swift internal mean (${nativeInternalMeanMs.toFixed(3)} ms) is lower than JavaScript compute mean (${jsMeanMs.toFixed(3)} ms), but full Classic Bridge round-trip mean (${nativeRoundTripMeanMs.toFixed(3)} ms) is not.`;
    case 'keep_js':
    default:
      return `JavaScript compute mean (${jsMeanMs.toFixed(3)} ms) is not exceeded by a faster Swift internal path once full Classic Bridge round-trip cost is considered.`;
  }
}

export function createOffloadingDecision(
  input: OffloadingDecisionInput,
): OffloadingDecisionSummary {
  const estimatedBridgeOverheads = input.nativeRoundTripTimesMs.map(
    (value, index) =>
      estimateBridgeOverheadMs(value, input.nativeInternalTimesMs[index] ?? 0),
  );
  const jsMeanMs = mean(input.jsComputeTimesMs);
  const nativeInternalMeanMs = mean(input.nativeInternalTimesMs);
  const nativeRoundTripMeanMs = mean(input.nativeRoundTripTimesMs);
  const recommendation = selectOffloadingRecommendation(
    jsMeanMs,
    nativeInternalMeanMs,
    nativeRoundTripMeanMs,
  );
  const checksumDifference = Math.abs(input.jsChecksum - input.nativeChecksum);

  return {
    workloadSize: input.workloadSize,
    warmupRepetitions: DECISION_HELPER_WARMUP_REPETITIONS,
    measuredRepetitions: input.jsComputeTimesMs.length,
    jsChecksum: input.jsChecksum,
    nativeChecksum: input.nativeChecksum,
    checksumDifference,
    checksumValid: checksumsMatch(
      input.jsChecksum,
      input.nativeChecksum,
      input.checksumEpsilon,
    ),
    jsMeanMs,
    jsStdDevMs: sampleStdDev(input.jsComputeTimesMs),
    nativeInternalMeanMs,
    nativeInternalStdDevMs: sampleStdDev(input.nativeInternalTimesMs),
    nativeRoundTripMeanMs,
    nativeRoundTripStdDevMs: sampleStdDev(input.nativeRoundTripTimesMs),
    estimatedBridgeOverheadMeanMs: mean(estimatedBridgeOverheads),
    estimatedBridgeOverheadStdDevMs: sampleStdDev(estimatedBridgeOverheads),
    recommendation,
    reason: recommendationReason(
      recommendation,
      jsMeanMs,
      nativeInternalMeanMs,
      nativeRoundTripMeanMs,
    ),
  };
}

function assertNotCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) {
    throw new Error('OFFLOADING_DECISION_CANCELLED');
  }
}

export async function runOffloadingDecisionProtocol(
  input: RunOffloadingDecisionProtocolInput,
): Promise<OffloadingDecisionProtocolResult> {
  const {
    workloadSize,
    nowMs,
    runJsComputation,
    runNativeComputation,
    isCancelled,
    onWarmupStart,
    onMeasuredRepetitionStart,
  } = input;

  assertNotCancelled(isCancelled);
  onWarmupStart?.();

  const warmupJsResult = runJsComputation();
  assertNotCancelled(isCancelled);
  const warmupNativeResult = await runNativeComputation();
  assertNotCancelled(isCancelled);

  if (!checksumsMatch(warmupJsResult.checksum, warmupNativeResult.checksum)) {
    throw new Error('OFFLOADING_DECISION_WARMUP_CHECKSUM_FAILED');
  }

  const jsComputeTimesMs: number[] = [];
  const nativeInternalTimesMs: number[] = [];
  const nativeRoundTripTimesMs: number[] = [];
  let jsChecksum = warmupJsResult.checksum;
  let nativeChecksum = warmupNativeResult.checksum;

  for (
    let repetition = 0;
    repetition < DECISION_HELPER_MEASURED_REPETITIONS;
    repetition += 1
  ) {
    assertNotCancelled(isCancelled);
    onMeasuredRepetitionStart?.(
      repetition + 1,
      DECISION_HELPER_MEASURED_REPETITIONS,
    );

    const jsStartedAt = nowMs();
    const jsResult = runJsComputation();
    jsComputeTimesMs.push(nowMs() - jsStartedAt);
    jsChecksum = jsResult.checksum;

    assertNotCancelled(isCancelled);
    const nativeRoundTripStartedAt = nowMs();
    const nativeResult = await runNativeComputation();
    nativeRoundTripTimesMs.push(nowMs() - nativeRoundTripStartedAt);
    nativeInternalTimesMs.push(nativeResult.nativeComputeTimeMs);
    nativeChecksum = nativeResult.checksum;

    assertNotCancelled(isCancelled);
    if (!checksumsMatch(jsChecksum, nativeChecksum)) {
      throw new Error('OFFLOADING_DECISION_MEASURED_CHECKSUM_FAILED');
    }
  }

  const summary = createOffloadingDecision({
    workloadSize,
    jsComputeTimesMs,
    nativeInternalTimesMs,
    nativeRoundTripTimesMs,
    jsChecksum,
    nativeChecksum,
    checksumEpsilon: OFFLOADING_CHECKSUM_EPSILON,
  });

  return {
    summary,
    samples: {
      jsComputeTimesMs,
      nativeInternalTimesMs,
      nativeRoundTripTimesMs,
      maxMeasuredRoundTripMs: Math.max(...nativeRoundTripTimesMs),
    },
  };
}
