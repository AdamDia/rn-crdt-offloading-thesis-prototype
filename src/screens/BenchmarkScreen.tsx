import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Share,
} from 'react-native';

import {GCounter} from '../crdt/js/GCounter';
import {BenchmarkLogger} from '../metrics/BenchmarkLogger';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import {MetricsPanel} from '../components/MetricsPanel';
import {NativeCRDT} from '../native/NativeCRDT';
import {CSVExport} from '../native/CSVExport';

type Mode = 'idle' | 'js' | 'native';
type IntervalOption = 100 | 50 | 20;

type MetricsSnapshot = {
  crdtValue: number;
  elapsedMs: number;
  operationCount: number;
  averageOperationTimeMs: number;
  maxOperationTimeMs: number;
  selectedIntervalMs: number;
  mode: Mode;
};

const BENCHMARK_DURATION_MS = 60_000;

function nowMs(): number {
  const p = (globalThis as any).performance;
  if (p && typeof p.now === 'function') {
    return p.now();
  }
  return Date.now();
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

function formatIntervalLabel(ms: IntervalOption): string {
  return `${ms}ms`;
}

function generateDeterministicBurstState(
  burstSize: number,
): Record<string, number> {
  const size = Math.max(0, Math.floor(burstSize));

  const state: Record<string, number> = {};
  // Deterministic workload: `burstSize` unique replicas, each with value 1.
  // This makes burstSize represent the number of CRDT entries processed by merge.
  for (let i = 0; i < size; i += 1) {
    state[`remote-${i}`] = 1;
  }

  return state;
}

function Button({
  title,
  onPress,
  disabled,
  kind = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.button,
        kind === 'secondary' && styles.buttonSecondary,
        kind === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        disabled && kind === 'primary' && styles.buttonDisabledPrimary,
        disabled && kind === 'secondary' && styles.buttonDisabledSecondary,
        disabled && kind === 'danger' && styles.buttonDisabledDanger,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text
        style={[
          styles.buttonText,
          kind === 'secondary' && styles.buttonTextSecondary,
          disabled && styles.buttonTextDisabled,
          disabled &&
            kind === 'secondary' &&
            styles.buttonTextDisabledSecondary,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

function Segment({
  options,
  selected,
  onSelect,
}: {
  options: IntervalOption[];
  selected: IntervalOption;
  onSelect: (ms: IntervalOption) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map(ms => {
        const isSelected = ms === selected;
        return (
          <Pressable
            key={ms}
            onPress={() => onSelect(ms)}
            style={({pressed}) => [
              styles.segmentItem,
              isSelected && styles.segmentItemSelected,
              pressed && styles.segmentItemPressed,
            ]}>
            <Text
              style={[
                styles.segmentText,
                isSelected && styles.segmentTextSelected,
              ]}>
              {formatIntervalLabel(ms)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BenchmarkScreen(): React.JSX.Element {
  const counterRef = useRef<GCounter>(new GCounter('local'));
  const loggerRef = useRef<BenchmarkLogger>(sharedBenchmarkLogger);
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningModeRef = useRef<Mode>('idle');
  const tickInFlightRef = useRef<boolean>(false);
  const mismatchWarnCountRef = useRef<number>(0);
  const metricsRef = useRef<MetricsSnapshot>({
    crdtValue: 0,
    elapsedMs: 0,
    operationCount: 0,
    averageOperationTimeMs: 0,
    maxOperationTimeMs: 0,
    selectedIntervalMs: 100,
    mode: 'idle',
  });

  const startedAtRef = useRef<string>('');
  const operationTimesRef = useRef<number[]>([]);
  const runStartPerfRef = useRef<number>(0);

  const [selectedIntervalMs, setSelectedIntervalMs] =
    useState<IntervalOption>(100);

  const [burstResult, setBurstResult] = useState<string>('');
  const [savedRunsCount, setSavedRunsCount] = useState<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(BENCHMARK_DURATION_MS);

  const [metrics, setMetrics] = useState<MetricsSnapshot>({
    crdtValue: 0,
    elapsedMs: 0,
    operationCount: 0,
    averageOperationTimeMs: 0,
    maxOperationTimeMs: 0,
    selectedIntervalMs: 100,
    mode: 'idle',
  });

  const isRunning = metrics.mode !== 'idle';

  const intervalOptions = useMemo<IntervalOption[]>(() => [100, 50, 20], []);

  const clearTickTimer = useCallback(() => {
    if (tickTimerRef.current) {
      clearTimeout(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const clearAutoStopTimer = useCallback(() => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  const stopLoop = useCallback(() => {
    runningModeRef.current = 'idle';
    tickInFlightRef.current = false;
    clearTickTimer();
    clearAutoStopTimer();
  }, [clearAutoStopTimer, clearTickTimer]);

  const resetMetrics = useCallback(
    (mode: Mode = 'idle') => {
      operationTimesRef.current = [];
      startedAtRef.current = '';
      runStartPerfRef.current = 0;
      setRemainingMs(BENCHMARK_DURATION_MS);
      const next: MetricsSnapshot = {
        crdtValue: 0,
        elapsedMs: 0,
        operationCount: 0,
        averageOperationTimeMs: 0,
        maxOperationTimeMs: 0,
        selectedIntervalMs,
        mode,
      };
      metricsRef.current = next;
      setMetrics(next);
    },
    [selectedIntervalMs],
  );

  const stopAndLogRun = useCallback(
    (reason: 'manual' | 'auto' = 'manual') => {
      const currentMetrics = metricsRef.current;
      if (currentMetrics.mode === 'idle') {
        stopLoop();
        return;
      }

      stopLoop();

      const endedAt = new Date().toISOString();
      const startedAt = startedAtRef.current || endedAt;
      const opTimes = operationTimesRef.current;
      const avg = mean(opTimes);
      const max = opTimes.length > 0 ? Math.max(...opTimes) : 0;
      const elapsedRounded = Math.max(0, Math.round(currentMetrics.elapsedMs));
      const isPartial = elapsedRounded < BENCHMARK_DURATION_MS;

      let notes: string;
      if (reason === 'manual' && isPartial) {
        notes = `MANUAL_STOP_BEFORE_${BENCHMARK_DURATION_MS}ms`;
      } else if (currentMetrics.mode === 'native') {
        notes = 'Native (Swift) run';
      } else {
        notes = 'JS-only baseline run';
      }

      loggerRef.current.addRun({
        startedAt,
        endedAt,
        mode: currentMetrics.mode,
        benchmarkCategory: 'crdt_interval',
        scenarioName: `interval_${currentMetrics.selectedIntervalMs}ms`,
        intervalMs: currentMetrics.selectedIntervalMs,
        durationMs: elapsedRounded,
        operationCount: currentMetrics.operationCount,
        finalCrdtValue: currentMetrics.crdtValue,
        averageOperationTimeMs: avg,
        maxOperationTimeMs: max,
        burstSize: 0,
        burstMergeTimeMs: 0,
        notes,
      });
      setSavedRunsCount(loggerRef.current.getRuns().length);

      setMetrics(prev => {
        const next = {
          ...prev,
          mode: 'idle' as Mode,
          averageOperationTimeMs: avg,
          maxOperationTimeMs: max,
        };
        metricsRef.current = next;
        return next;
      });
    },
    [stopLoop],
  );

  const scheduleNextTick = useCallback(function scheduleNextTick(
    intervalMs: number,
    tickFn: () => Promise<void> | void,
  ) {
    tickTimerRef.current = setTimeout(async () => {
      if (runningModeRef.current === 'idle') {
        return;
      }

      if (tickInFlightRef.current) {
        scheduleNextTick(intervalMs, tickFn);
        return;
      }

      tickInFlightRef.current = true;
      try {
        await tickFn();
      } finally {
        tickInFlightRef.current = false;
      }

      scheduleNextTick(intervalMs, tickFn);
    }, intervalMs);
  },
  []);

  const fireAndForget = useCallback((p: Promise<unknown>) => {
    p.catch(() => {});
  }, []);

  const startBenchmark = useCallback(
    async (mode: Exclude<Mode, 'idle'>) => {
      if (
        runningModeRef.current !== 'idle' ||
        metricsRef.current.mode !== 'idle'
      ) {
        return;
      }

      stopLoop();
      resetMetrics(mode);
      mismatchWarnCountRef.current = 0;
      startedAtRef.current = new Date().toISOString();
      runStartPerfRef.current = nowMs();
      runningModeRef.current = mode;

      if (mode === 'native') {
        try {
          await NativeCRDT.reset();
        } catch {
          // If native module is unavailable, the first increment will surface the error.
        }
      } else {
        // Ensure JS sustained runs always start from a clean CRDT state.
        counterRef.current.reset();
      }

      const tickFn = async () => {
        if (runningModeRef.current !== mode) {
          return;
        }
        const t0 = nowMs();
        let value: number;
        if (mode === 'native') {
          value = await NativeCRDT.increment('device-1');
        } else {
          counterRef.current.increment(1);
          value = counterRef.current.value();
        }
        const t1 = nowMs();

        const opMs = t1 - t0;
        operationTimesRef.current.push(opMs);

        const elapsed = nowMs() - runStartPerfRef.current;
        const remaining = Math.max(0, BENCHMARK_DURATION_MS - elapsed);
        setRemainingMs(remaining);
        const avg = mean(operationTimesRef.current);
        const max =
          operationTimesRef.current.length > 0
            ? Math.max(...operationTimesRef.current)
            : 0;

        setMetrics(prev => {
          const nextOperationCount = prev.operationCount + 1;
          if (value !== nextOperationCount) {
            // Development-only guard to catch leaked/dirty CRDT state between runs.
            // Keep warnings rate-limited to avoid spamming console at high frequency.
            mismatchWarnCountRef.current += 1;
            if (mismatchWarnCountRef.current <= 3) {
              console.warn(
                `[Benchmark] crdtValue/operationCount mismatch (mode=${mode}) ` +
                  `crdtValue=${value} operationCount=${nextOperationCount} ` +
                  'hint=CRDT state may not be reset',
              );
            }
          }

          const next = {
            ...prev,
            crdtValue: value,
            elapsedMs: elapsed,
            operationCount: nextOperationCount,
            averageOperationTimeMs: avg,
            maxOperationTimeMs: max,
            selectedIntervalMs,
            mode,
          };
          metricsRef.current = next;
          return next;
        });
      };

      clearAutoStopTimer();
      autoStopTimerRef.current = setTimeout(() => {
        stopAndLogRun('auto');
      }, BENCHMARK_DURATION_MS);

      scheduleNextTick(selectedIntervalMs, tickFn);
    },
    [
      clearAutoStopTimer,
      resetMetrics,
      scheduleNextTick,
      selectedIntervalMs,
      stopAndLogRun,
      stopLoop,
    ],
  );

  const startJsBenchmark = useCallback(() => {
    fireAndForget(startBenchmark('js'));
  }, [fireAndForget, startBenchmark]);

  const startNativeBenchmark = useCallback(() => {
    fireAndForget(startBenchmark('native'));
  }, [fireAndForget, startBenchmark]);

  const resetAll = useCallback(async () => {
    stopLoop();
    counterRef.current.reset();
    try {
      await NativeCRDT.reset();
    } catch {
      // Native module may be unavailable; ignore.
    }
    resetMetrics('idle');
    setBurstResult('');
  }, [resetMetrics, stopLoop]);

  const exportCSV = useCallback(async () => {
    const csv = loggerRef.current.exportToCSV();

    try {
      await CSVExport.exportCSV(csv, 'benchmark-results.csv');
    } catch (e: any) {
      try {
        await Share.share({message: csv});
        Alert.alert(
          'Export fallback',
          'CSV file export was unavailable. Shared raw CSV text instead.',
        );
      } catch {
        Alert.alert(
          'Export failed',
          `CSV export failed: ${String(e?.message ?? e)}`,
        );
      }
    }
  }, []);

  const runBurstMerge = useCallback(
    async (mode: Exclude<Mode, 'idle'>, burstSize: number) => {
      if (isRunning) {
        Alert.alert('Stop first', 'Stop the benchmark before running a burst.');
        return;
      }

      setBurstResult('Running…');

      const remoteState = generateDeterministicBurstState(burstSize);
      const remoteReplicaCount = Object.keys(remoteState).length;
      if (remoteReplicaCount !== burstSize) {
        console.warn(
          `[Burst] unexpected replica count: burstSize=${burstSize} keys=${remoteReplicaCount}`,
        );
      } else {
        console.log(
          `[Burst] burstSize=${burstSize} keys=${remoteReplicaCount}`,
        );
      }
      const startedAt = new Date().toISOString();

      try {
        const t0 = nowMs();
        let value: number;
        if (mode === 'native') {
          // Isolate burst state from sustained benchmarks.
          try {
            await NativeCRDT.reset();
          } catch {
            // If unavailable, merge will surface error.
          }
          value = await NativeCRDT.merge(remoteState);
        } else {
          // Use an isolated counter so bursts never pollute sustained run state.
          const tempCounter = new GCounter('local');
          tempCounter.merge(remoteState);
          value = tempCounter.value();
        }
        const t1 = nowMs();

        const mergeMs = t1 - t0;

        loggerRef.current.addRun({
          startedAt,
          endedAt: new Date().toISOString(),
          mode,
          benchmarkCategory: 'crdt_burst',
          scenarioName: `burst_merge_${burstSize}`,
          intervalMs: 0,
          durationMs: 0,
          operationCount: remoteReplicaCount,
          finalCrdtValue: value,
          averageOperationTimeMs: 0,
          maxOperationTimeMs: 0,
          burstSize,
          burstMergeTimeMs: mergeMs,
          notes: `Deterministic burst merge with ${remoteReplicaCount} unique remote replicas (no networking)`,
        });
        setSavedRunsCount(loggerRef.current.getRuns().length);

        setBurstResult(`OK: value=${value}, merge=${mergeMs.toFixed(3)}ms`);

        if (mode === 'native') {
          // Clean up native state after burst to keep subsequent runs independent.
          try {
            await NativeCRDT.reset();
          } catch {
            // Ignore; resetAll can still clean later.
          }
        }
      } catch (e: any) {
        setBurstResult(`Error: ${String(e?.message ?? e)}`);
      }
    },
    [isRunning],
  );

  const clearResults = useCallback(() => {
    loggerRef.current.clear();
    setSavedRunsCount(0);
  }, []);

  useEffect(() => {
    return () => {
      stopLoop();
    };
  }, [stopLoop]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>CRDT Benchmark</Text>
        <Text style={styles.subheader}>Saved runs: {savedRunsCount}</Text>
        {isRunning ? (
          <Text style={styles.subheader}>
            Remaining: {(Math.max(0, remainingMs) / 1000).toFixed(1)}s
          </Text>
        ) : null}

        <MetricsPanel
          crdtValue={metrics.crdtValue}
          elapsedMs={metrics.elapsedMs}
          operationCount={metrics.operationCount}
          averageOperationTimeMs={metrics.averageOperationTimeMs}
          maxOperationTimeMs={metrics.maxOperationTimeMs}
          selectedIntervalMs={metrics.selectedIntervalMs}
          mode={metrics.mode}
        />

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Interval</Text>
          <Segment
            options={intervalOptions}
            selected={selectedIntervalMs}
            onSelect={ms => {
              if (isRunning) {
                Alert.alert(
                  'Stop first',
                  'Stop the benchmark before changing interval.',
                );
                return;
              }
              setSelectedIntervalMs(ms);
              setMetrics(prev => {
                const next = {...prev, selectedIntervalMs: ms};
                metricsRef.current = next;
                return next;
              });
            }}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Controls</Text>
          <View style={styles.row}>
            <Button
              title="Start JS Benchmark"
              onPress={startJsBenchmark}
              disabled={isRunning}
            />
            <Button
              title="Start Native Benchmark"
              onPress={startNativeBenchmark}
              disabled={isRunning}
            />
            <Button
              title="Stop"
              onPress={() => stopAndLogRun('manual')}
              disabled={!isRunning}
              kind="danger"
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Reset"
              onPress={() => fireAndForget(resetAll())}
              kind="secondary"
            />
            <Button
              title="Clear Results"
              onPress={clearResults}
              kind="secondary"
              disabled={savedRunsCount === 0}
            />
            <Button title="Export CSV" onPress={exportCSV} kind="secondary" />
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Burst Merge Simulation</Text>
          <Text style={styles.note}>
            Simulates accumulated remote updates after reconnection
            (deterministic, no networking).
          </Text>
          <View style={styles.row}>
            <Button
              title="Run JS Burst 500"
              onPress={() => fireAndForget(runBurstMerge('js', 500))}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run JS Burst 1000"
              onPress={() => fireAndForget(runBurstMerge('js', 1000))}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Run JS Burst 5000"
              onPress={() => fireAndForget(runBurstMerge('js', 5000))}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run JS Burst 10000"
              onPress={() => fireAndForget(runBurstMerge('js', 10000))}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Run Native Burst 500"
              onPress={() => fireAndForget(runBurstMerge('native', 500))}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run Native Burst 1000"
              onPress={() => fireAndForget(runBurstMerge('native', 1000))}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Run Native Burst 5000"
              onPress={() => fireAndForget(runBurstMerge('native', 5000))}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run Native Burst 10000"
              onPress={() => fireAndForget(runBurstMerge('native', 10000))}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          {burstResult.length > 0 ? (
            <Text style={styles.note}>{burstResult}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    padding: 16,
    gap: 14,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  subheader: {
    fontSize: 12,
    color: '#333',
  },
  block: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.15)',
    gap: 10,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  note: {
    fontSize: 12,
    color: '#333',
    lineHeight: 16,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#111',
    minWidth: 150,
  },
  buttonSecondary: {
    backgroundColor: 'rgba(0,0,0,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.28)',
  },
  buttonDanger: {
    backgroundColor: '#b00020',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonDisabledPrimary: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  buttonDisabledSecondary: {
    backgroundColor: 'rgba(0,0,0,0.07)',
    borderColor: 'rgba(0,0,0,0.12)',
  },
  buttonDisabledDanger: {
    backgroundColor: 'rgba(176,0,32,0.5)',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonTextSecondary: {
    color: '#111',
  },
  buttonTextDisabled: {
    color: 'rgba(255,255,255,0.85)',
  },
  buttonTextDisabledSecondary: {
    color: 'rgba(0,0,0,0.45)',
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  segmentItemSelected: {
    backgroundColor: '#111',
  },
  segmentItemPressed: {
    opacity: 0.9,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  segmentTextSelected: {
    color: '#fff',
  },
});
