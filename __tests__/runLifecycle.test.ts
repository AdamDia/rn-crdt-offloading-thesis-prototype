import {
  BenchmarkRunLifecycle,
  createRunId,
  type ActiveRunSnapshot,
} from '../src/benchmarks/runLifecycle';

type TestMode = 'js' | 'native';

type TestConfig = {
  intervalMs: number;
  workloadSize?: number;
};

function createSnapshot(
  overrides: Partial<ActiveRunSnapshot<TestMode, TestConfig>> = {},
): ActiveRunSnapshot<TestMode, TestConfig> {
  return {
    runId: createRunId(),
    mode: 'js',
    startedAt: '2026-07-16T00:00:00.000Z',
    startPerfMs: 100,
    configuredDurationMs: 60_000,
    config: {
      intervalMs: 100,
      workloadSize: 5000,
    },
    ...overrides,
  };
}

describe('BenchmarkRunLifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('creates one active run at start', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();

    expect(lifecycle.startRun(snapshot, jest.fn())).toEqual(snapshot);
    expect(lifecycle.hasActiveRun()).toBe(true);
    expect(lifecycle.getActiveRun()).toEqual(snapshot);
    expect(lifecycle.startRun(createSnapshot(), jest.fn())).toBeNull();
  });

  it('automatically ends a run after 60 seconds exactly once', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onAutoStop = jest.fn();

    lifecycle.startRun(snapshot, onAutoStop);
    jest.advanceTimersByTime(60_000);

    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop).toHaveBeenCalledWith(snapshot);
    expect(lifecycle.hasActiveRun()).toBe(false);
  });

  it('pressing stop after auto-completion does nothing', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onAutoStop = jest.fn();
    const onManualStop = jest.fn();

    lifecycle.startRun(snapshot, onAutoStop);
    jest.advanceTimersByTime(60_000);
    lifecycle.stopRun(snapshot.runId, onManualStop);

    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onManualStop).not.toHaveBeenCalled();
  });

  it('repeated stop taps append at most one manual stop callback', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onManualStop = jest.fn();

    lifecycle.startRun(snapshot, jest.fn());
    lifecycle.stopRun(snapshot.runId, onManualStop);
    lifecycle.stopRun(snapshot.runId, onManualStop);
    lifecycle.stopRun(snapshot.runId, onManualStop);

    expect(onManualStop).toHaveBeenCalledTimes(1);
    expect(lifecycle.hasActiveRun()).toBe(false);
  });

  it('handles a race between manual stop and auto-timeout once', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onAutoStop = jest.fn();
    const onManualStop = jest.fn();

    lifecycle.startRun(snapshot, onAutoStop);
    jest.advanceTimersByTime(59_999);
    lifecycle.stopRun(snapshot.runId, onManualStop);
    jest.advanceTimersByTime(1);

    expect(onManualStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it('manual stop before 60 seconds does not trigger auto-finalization', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onAutoStop = jest.fn();
    const onManualStop = jest.fn();

    lifecycle.startRun(snapshot, onAutoStop);
    jest.advanceTimersByTime(25_000);
    lifecycle.stopRun(snapshot.runId, onManualStop);
    jest.advanceTimersByTime(35_000);

    expect(onManualStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop).not.toHaveBeenCalled();
  });

  it('a second run uses its own run id and configuration', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const firstSnapshot = createSnapshot({
      runId: 'run-one',
      config: {intervalMs: 100, workloadSize: 5000},
    });
    const secondSnapshot = createSnapshot({
      runId: 'run-two',
      config: {intervalMs: 20, workloadSize: 10000},
    });
    const onFirstAutoStop = jest.fn();
    const onSecondAutoStop = jest.fn();

    lifecycle.startRun(firstSnapshot, onFirstAutoStop);
    lifecycle.stopRun(firstSnapshot.runId);
    lifecycle.startRun(secondSnapshot, onSecondAutoStop);
    jest.advanceTimersByTime(60_000);

    expect(onFirstAutoStop).not.toHaveBeenCalled();
    expect(onSecondAutoStop).toHaveBeenCalledTimes(1);
    expect(onSecondAutoStop).toHaveBeenCalledWith(secondSnapshot);
  });

  it('old timer callbacks cannot finalize a newer run', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const firstSnapshot = createSnapshot({runId: 'old-run'});
    const secondSnapshot = createSnapshot({runId: 'new-run'});
    const onFirstAutoStop = jest.fn();
    const onSecondAutoStop = jest.fn();

    lifecycle.startRun(firstSnapshot, onFirstAutoStop);
    lifecycle.stopRun(firstSnapshot.runId);
    lifecycle.startRun(secondSnapshot, onSecondAutoStop);
    jest.advanceTimersByTime(60_000);

    expect(onFirstAutoStop).not.toHaveBeenCalled();
    expect(onSecondAutoStop).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected configuration snapshot per run', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshots = [
      createSnapshot({runId: 'run-100', config: {intervalMs: 100}}),
      createSnapshot({runId: 'run-50', config: {intervalMs: 50}}),
      createSnapshot({runId: 'run-20', config: {intervalMs: 20}}),
    ];
    const results: Array<ActiveRunSnapshot<TestMode, TestConfig>> = [];

    for (const snapshot of snapshots) {
      lifecycle.startRun(snapshot, completed => {
        results.push(completed);
      });
      jest.advanceTimersByTime(60_000);
    }

    expect(results.map(result => result.config.intervalMs)).toEqual([
      100,
      50,
      20,
    ]);
    expect(results.map(result => result.runId)).toEqual([
      'run-100',
      'run-50',
      'run-20',
    ]);
  });

  it('ignores scheduling for stale tick timers', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const timer = setTimeout(jest.fn(), 100);

    lifecycle.startRun(snapshot, jest.fn());
    lifecycle.stopRun(snapshot.runId);

    expect(lifecycle.setTickTimer(snapshot.runId, timer)).toBe(false);
  });

  it('cleans up without unexpected finalization on unmount', () => {
    const lifecycle = new BenchmarkRunLifecycle<TestMode, TestConfig>();
    const snapshot = createSnapshot();
    const onAutoStop = jest.fn();

    lifecycle.startRun(snapshot, onAutoStop);
    lifecycle.cleanup();
    jest.advanceTimersByTime(60_000);

    expect(onAutoStop).not.toHaveBeenCalled();
    expect(lifecycle.hasActiveRun()).toBe(false);
  });
});
