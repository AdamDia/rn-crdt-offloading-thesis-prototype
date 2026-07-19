import {
  DECISION_HELPER_MEASURED_REPETITIONS,
  DECISION_HELPER_WARMUP_REPETITIONS,
  checksumsMatch,
  createOffloadingDecision,
  estimateBridgeOverheadMs,
  mean,
  runOffloadingDecisionProtocol,
  sampleStdDev,
  selectOffloadingRecommendation,
} from '../src/dashboard/offloadingDecision';

describe('offloadingDecision', () => {
  it('returns native_beneficial when classic bridge round-trip beats JS', () => {
    expect(selectOffloadingRecommendation(10, 4, 8)).toBe('native_beneficial');
  });

  it('returns bridge_cancels_benefit when Swift is faster but round-trip is not', () => {
    expect(selectOffloadingRecommendation(10, 4, 12)).toBe(
      'bridge_cancels_benefit',
    );
  });

  it('returns keep_js when Swift and round-trip are both slower than JS', () => {
    expect(selectOffloadingRecommendation(10, 12, 14)).toBe('keep_js');
  });

  it('computes the mean', () => {
    expect(mean([2, 4, 6, 8])).toBe(5);
  });

  it('computes sample standard deviation', () => {
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
  });

  it('never returns a negative bridge overhead estimate', () => {
    expect(estimateBridgeOverheadMs(3, 5)).toBe(0);
    expect(estimateBridgeOverheadMs(7, 5)).toBe(2);
  });

  it('validates checksums with epsilon tolerance', () => {
    expect(checksumsMatch(100, 100.0000001)).toBe(true);
    expect(checksumsMatch(100, 100.01)).toBe(false);
  });

  it('creates a deterministic decision summary for fixed inputs', () => {
    const input = {
      workloadSize: 5000,
      jsComputeTimesMs: [10, 11, 9, 10, 10],
      nativeInternalTimesMs: [4, 5, 4, 5, 4],
      nativeRoundTripTimesMs: [12, 13, 12, 13, 12],
      jsChecksum: 799004929,
      nativeChecksum: 799004929,
    };

    const first = createOffloadingDecision(input);
    const second = createOffloadingDecision(input);

    expect(first).toEqual(second);
    expect(first.workloadSize).toBe(5000);
    expect(first.warmupRepetitions).toBe(DECISION_HELPER_WARMUP_REPETITIONS);
    expect(first.measuredRepetitions).toBe(DECISION_HELPER_MEASURED_REPETITIONS);
    expect(first.checksumValid).toBe(true);
    expect(first.recommendation).toBe('bridge_cancels_benefit');
  });

  it('excludes warm-up samples from measured means, standard deviations, and max round-trip', async () => {
    let now = 0;
    const jsDurations = [100, 10, 12, 11, 9, 10];
    const nativeRoundTripDurations = [50, 20, 22, 24, 26, 28];
    const nativeInternalDurations = [5, 4, 5, 6, 7, 8];
    let jsIndex = 0;
    let nativeIndex = 0;

    const result = await runOffloadingDecisionProtocol({
      workloadSize: 5000,
      nowMs: () => now,
      runJsComputation: () => {
        const duration = jsDurations[jsIndex];
        now += duration;
        jsIndex += 1;
        return {checksum: 799004929};
      },
      runNativeComputation: async () => {
        const roundTrip = nativeRoundTripDurations[nativeIndex];
        const internal = nativeInternalDurations[nativeIndex];
        now += roundTrip;
        nativeIndex += 1;
        return {nativeComputeTimeMs: internal, checksum: 799004929};
      },
    });

    expect(result.summary.jsMeanMs).toBeCloseTo(mean([10, 12, 11, 9, 10]));
    expect(result.summary.jsStdDevMs).toBeCloseTo(
      sampleStdDev([10, 12, 11, 9, 10]),
    );
    expect(result.summary.nativeRoundTripMeanMs).toBeCloseTo(
      mean([20, 22, 24, 26, 28]),
    );
    expect(result.summary.nativeRoundTripStdDevMs).toBeCloseTo(
      sampleStdDev([20, 22, 24, 26, 28]),
    );
    expect(result.summary.nativeInternalMeanMs).toBeCloseTo(mean([4, 5, 6, 7, 8]));
    expect(result.summary.nativeInternalStdDevMs).toBeCloseTo(
      sampleStdDev([4, 5, 6, 7, 8]),
    );
    expect(result.samples.maxMeasuredRoundTripMs).toBe(28);
    expect(result.samples.jsComputeTimesMs).toEqual([10, 12, 11, 9, 10]);
    expect(result.samples.nativeRoundTripTimesMs).toEqual([20, 22, 24, 26, 28]);
  });

  it('uses exactly five measured repetitions', async () => {
    let now = 0;
    let jsCalls = 0;
    let nativeCalls = 0;

    const result = await runOffloadingDecisionProtocol({
      workloadSize: 1000,
      nowMs: () => now,
      runJsComputation: () => {
        now += 1;
        jsCalls += 1;
        return {checksum: 1};
      },
      runNativeComputation: async () => {
        now += 2;
        nativeCalls += 1;
        return {nativeComputeTimeMs: 1, checksum: 1};
      },
    });

    expect(jsCalls).toBe(
      DECISION_HELPER_WARMUP_REPETITIONS + DECISION_HELPER_MEASURED_REPETITIONS,
    );
    expect(nativeCalls).toBe(
      DECISION_HELPER_WARMUP_REPETITIONS + DECISION_HELPER_MEASURED_REPETITIONS,
    );
    expect(result.summary.measuredRepetitions).toBe(5);
  });

  it('fails when warm-up checksum validation fails', async () => {
    let now = 0;
    await expect(
      runOffloadingDecisionProtocol({
        workloadSize: 1000,
        nowMs: () => now,
        runJsComputation: () => {
          now += 1;
          return {checksum: 10};
        },
        runNativeComputation: async () => {
          now += 2;
          return {nativeComputeTimeMs: 1, checksum: 20};
        },
      }),
    ).rejects.toThrow('OFFLOADING_DECISION_WARMUP_CHECKSUM_FAILED');
  });

  it('fails when a measured checksum validation fails', async () => {
    let now = 0;
    let measuredIndex = 0;

    await expect(
      runOffloadingDecisionProtocol({
        workloadSize: 1000,
        nowMs: () => now,
        runJsComputation: () => {
          now += 1;
          return {checksum: measuredIndex === 0 ? 1 : 5};
        },
        runNativeComputation: async () => {
          now += 2;
          const checksum = measuredIndex === 0 ? 1 : 4;
          measuredIndex += 1;
          return {nativeComputeTimeMs: 1, checksum};
        },
      }),
    ).rejects.toThrow('OFFLOADING_DECISION_MEASURED_CHECKSUM_FAILED');
  });

  it('does not trim or remove measured values', async () => {
    let now = 0;
    const measuredRoundTrips = [20, 200, 24, 26, 28];
    let nativeIndex = -1;

    const result = await runOffloadingDecisionProtocol({
      workloadSize: 10000,
      nowMs: () => now,
      runJsComputation: () => {
        now += 5;
        return {checksum: 7};
      },
      runNativeComputation: async () => {
        nativeIndex += 1;
        const roundTrip =
          nativeIndex === 0 ? 10 : measuredRoundTrips[nativeIndex - 1];
        now += roundTrip;
        return {nativeComputeTimeMs: 2, checksum: 7};
      },
    });

    expect(result.samples.nativeRoundTripTimesMs).toEqual(measuredRoundTrips);
    expect(result.samples.maxMeasuredRoundTripMs).toBe(200);
  });
});
