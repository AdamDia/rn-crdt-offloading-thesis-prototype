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
import {LWWRegister} from '../crdt/js/LWWRegister';
import type {LWWRegisterState} from '../crdt/js/lwwTypes';
import {BenchmarkLogger} from '../metrics/BenchmarkLogger';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import {MetricsPanel} from '../components/MetricsPanel';
import {NativeCRDT} from '../native/NativeCRDT';
import {CSVExport} from '../native/CSVExport';

type Mode = 'idle' | 'js' | 'native';
type IntervalOption = 100 | 50 | 20;
type LWWBenchmarkMode = 'idle' | 'js' | 'native';
type NetworkStatus = 'unknown' | 'online' | 'offline';

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
const LWW_UPDATE_INTERVAL_MS = 20;
const LWW_MERGE_COUNT = 1000;
const CONNECTIVITY_CHECK_URL = 'https://www.apple.com';
const CONNECTIVITY_TIMEOUT_MS = 3000;
const NETWORK_DEMO_BURST_SIZE = 10_000;

type LWWMetricsSnapshot = {
  elapsedMs: number;
  operationCount: number;
  averageOperationTimeMs: number;
  maxOperationTimeMs: number;
  mode: LWWBenchmarkMode;
};

function createLWWMetrics(mode: LWWBenchmarkMode = 'idle'): LWWMetricsSnapshot {
  return {
    elapsedMs: 0,
    operationCount: 0,
    averageOperationTimeMs: 0,
    maxOperationTimeMs: 0,
    mode,
  };
}

function generateDeterministicLWWStates(count: number): LWWRegisterState[] {
  const size = Math.max(0, Math.floor(count));
  const states: LWWRegisterState[] = [];

  for (let index = 0; index < size; index += 1) {
    states.push({
      value: `value-${index}`,
      timestamp: 1000 + index,
      replicaId: index % 2 === 0 ? 'A' : 'B',
    });
  }

  return states;
}

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
  const lwwRegisterRef = useRef<LWWRegister>(new LWWRegister('A'));
  const lwwTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lwwAutoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lwwRunningModeRef = useRef<LWWBenchmarkMode>('idle');
  const lwwTickInFlightRef = useRef<boolean>(false);
  const lwwMetricsRef = useRef<LWWMetricsSnapshot>(createLWWMetrics());
  const lwwStartedAtRef = useRef<string>('');
  const lwwOperationTimesRef = useRef<number[]>([]);
  const lwwRunStartPerfRef = useRef<number>(0);
  const lwwTimestampCounterRef = useRef<number>(1000);
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

  const [nativeTestResult, setNativeTestResult] = useState<string>('');
  const [burstResult, setBurstResult] = useState<string>('');
  const [nativeSmokeResult, setNativeSmokeResult] = useState<string>('');
  const [lwwSmokeResult, setLwwSmokeResult] = useState<string>('');
  const [lwwBenchmarkResult, setLwwBenchmarkResult] = useState<string>('');
  const [lwwRemainingMs, setLwwRemainingMs] = useState<number>(
    BENCHMARK_DURATION_MS,
  );
  const [lwwMetrics, setLwwMetrics] = useState<LWWMetricsSnapshot>(
    createLWWMetrics(),
  );
  const [savedRunsCount, setSavedRunsCount] = useState<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(BENCHMARK_DURATION_MS);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('unknown');
  const [lastConnectivityCheckAt, setLastConnectivityCheckAt] =
    useState<string>('');
  const [lastConnectivityError, setLastConnectivityError] =
    useState<string>('');
  const [networkDemoResult, setNetworkDemoResult] = useState<string>('');
  const [isCheckingConnectivity, setIsCheckingConnectivity] =
    useState<boolean>(false);
  const [isRunningNetworkDemo, setIsRunningNetworkDemo] =
    useState<boolean>(false);

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
  const isLwwRunning = lwwMetrics.mode !== 'idle';

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

  const clearLwwTickTimer = useCallback(() => {
    if (lwwTickTimerRef.current) {
      clearTimeout(lwwTickTimerRef.current);
      lwwTickTimerRef.current = null;
    }
  }, []);

  const clearLwwAutoStopTimer = useCallback(() => {
    if (lwwAutoStopTimerRef.current) {
      clearTimeout(lwwAutoStopTimerRef.current);
      lwwAutoStopTimerRef.current = null;
    }
  }, []);

  const stopLoop = useCallback(() => {
    runningModeRef.current = 'idle';
    tickInFlightRef.current = false;
    clearTickTimer();
    clearAutoStopTimer();
  }, [clearAutoStopTimer, clearTickTimer]);

  const stopLwwLoop = useCallback(() => {
    lwwRunningModeRef.current = 'idle';
    lwwTickInFlightRef.current = false;
    clearLwwTickTimer();
    clearLwwAutoStopTimer();
  }, [clearLwwAutoStopTimer, clearLwwTickTimer]);

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

  const resetLwwMetrics = useCallback((mode: LWWBenchmarkMode = 'idle') => {
    lwwOperationTimesRef.current = [];
    lwwStartedAtRef.current = '';
    lwwRunStartPerfRef.current = 0;
    lwwTimestampCounterRef.current = 1000;
    setLwwRemainingMs(BENCHMARK_DURATION_MS);
    const next = createLWWMetrics(mode);
    lwwMetricsRef.current = next;
    setLwwMetrics(next);
  }, []);

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

  const scheduleLwwNextTick = useCallback(function scheduleLwwNextTick(
    intervalMs: number,
    tickFn: () => Promise<void> | void,
  ) {
    lwwTickTimerRef.current = setTimeout(async () => {
      if (lwwRunningModeRef.current === 'idle') {
        return;
      }

      if (lwwTickInFlightRef.current) {
        scheduleLwwNextTick(intervalMs, tickFn);
        return;
      }

      lwwTickInFlightRef.current = true;
      try {
        await tickFn();
      } finally {
        lwwTickInFlightRef.current = false;
      }

      scheduleLwwNextTick(intervalMs, tickFn);
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

  const stopAndLogLwwUpdateRun = useCallback(
    (reason: 'manual' | 'auto' = 'manual') => {
      const currentMetrics = lwwMetricsRef.current;
      if (currentMetrics.mode === 'idle') {
        stopLwwLoop();
        return;
      }

      stopLwwLoop();

      const endedAt = new Date().toISOString();
      const startedAt = lwwStartedAtRef.current || endedAt;
      const avg = mean(lwwOperationTimesRef.current);
      const max =
        lwwOperationTimesRef.current.length > 0
          ? Math.max(...lwwOperationTimesRef.current)
          : 0;
      const durationMs = Math.max(0, Math.round(currentMetrics.elapsedMs));

      loggerRef.current.addRun({
        startedAt,
        endedAt,
        mode: currentMetrics.mode,
        benchmarkCategory: 'lww_register',
        scenarioName: 'lww_update_20ms',
        intervalMs: LWW_UPDATE_INTERVAL_MS,
        durationMs,
        operationCount: currentMetrics.operationCount,
        finalCrdtValue: 0,
        averageOperationTimeMs: avg,
        maxOperationTimeMs: max,
        burstSize: 0,
        burstMergeTimeMs: 0,
        notes:
          `${
            reason === 'manual' && durationMs < BENCHMARK_DURATION_MS
              ? 'Manual stop before 60s; exclude from official data. '
              : ''
          }` + 'Supplementary LWW Register update benchmark',
      });
      setSavedRunsCount(loggerRef.current.getRuns().length);

      setLwwMetrics(prev => {
        const next = {
          ...prev,
          mode: 'idle' as LWWBenchmarkMode,
          averageOperationTimeMs: avg,
          maxOperationTimeMs: max,
        };
        lwwMetricsRef.current = next;
        return next;
      });
      setLwwBenchmarkResult(
        `LWW Update 20ms (${currentMetrics.mode.toUpperCase()}): logged ${
          currentMetrics.operationCount
        } operations`,
      );
    },
    [stopLwwLoop],
  );

  const startLwwUpdateBenchmark = useCallback(
    async (mode: Exclude<LWWBenchmarkMode, 'idle'>) => {
      if (isRunning || isLwwRunning) {
        return;
      }

      stopLwwLoop();
      resetLwwMetrics(mode);
      setLwwBenchmarkResult('Running LWW update benchmark…');
      lwwStartedAtRef.current = new Date().toISOString();
      lwwRunStartPerfRef.current = nowMs();
      lwwRunningModeRef.current = mode;

      lwwRegisterRef.current.reset();
      if (mode === 'native') {
        await NativeCRDT.lwwReset();
      }

      const tickFn = async () => {
        if (lwwRunningModeRef.current !== mode) {
          return;
        }

        const timestamp = ++lwwTimestampCounterRef.current;
        const nextValue = `value-${timestamp}`;
        const t0 = nowMs();

        if (mode === 'native') {
          await NativeCRDT.lwwSet(nextValue, timestamp, 'A');
        } else {
          lwwRegisterRef.current.set(nextValue, timestamp);
        }

        const opMs = nowMs() - t0;
        lwwOperationTimesRef.current.push(opMs);
        const elapsed = nowMs() - lwwRunStartPerfRef.current;
        const remaining = Math.max(0, BENCHMARK_DURATION_MS - elapsed);
        setLwwRemainingMs(remaining);

        setLwwMetrics(prev => {
          const next = {
            elapsedMs: elapsed,
            operationCount: prev.operationCount + 1,
            averageOperationTimeMs: mean(lwwOperationTimesRef.current),
            maxOperationTimeMs: Math.max(...lwwOperationTimesRef.current),
            mode,
          };
          lwwMetricsRef.current = next;
          return next;
        });
      };

      clearLwwAutoStopTimer();
      lwwAutoStopTimerRef.current = setTimeout(() => {
        stopAndLogLwwUpdateRun('auto');
      }, BENCHMARK_DURATION_MS);

      scheduleLwwNextTick(LWW_UPDATE_INTERVAL_MS, tickFn);
    },
    [
      clearLwwAutoStopTimer,
      isLwwRunning,
      isRunning,
      resetLwwMetrics,
      scheduleLwwNextTick,
      stopAndLogLwwUpdateRun,
      stopLwwLoop,
    ],
  );

  const runLwwMergeBenchmark = useCallback(
    async (mode: Exclude<LWWBenchmarkMode, 'idle'>) => {
      if (isRunning || isLwwRunning) {
        Alert.alert(
          'Stop first',
          'Stop the active benchmark before running supplementary LWW scenarios.',
        );
        return;
      }

      const states = generateDeterministicLWWStates(LWW_MERGE_COUNT);
      setLwwBenchmarkResult('Running LWW merge benchmark…');

      try {
        if (mode === 'native') {
          await NativeCRDT.lwwReset();
        } else {
          lwwRegisterRef.current.reset();
        }

        const opTimes: number[] = [];
        const startedAt = new Date().toISOString();
        const totalStart = nowMs();

        for (const state of states) {
          const t0 = nowMs();
          if (mode === 'native') {
            await NativeCRDT.lwwMerge(state);
          } else {
            lwwRegisterRef.current.merge(state);
          }
          opTimes.push(nowMs() - t0);
        }

        const durationMs = nowMs() - totalStart;
        const finalState =
          mode === 'native'
            ? await NativeCRDT.lwwGet()
            : lwwRegisterRef.current.getState();

        if (
          finalState.value !== `value-${LWW_MERGE_COUNT - 1}` ||
          finalState.timestamp !== 1000 + (LWW_MERGE_COUNT - 1)
        ) {
          setLwwBenchmarkResult(
            `LWW merge benchmark failed expected final state value-${
              LWW_MERGE_COUNT - 1
            }`,
          );
          return;
        }

        loggerRef.current.addRun({
          startedAt,
          endedAt: new Date().toISOString(),
          mode,
          benchmarkCategory: 'lww_register',
          scenarioName: 'lww_merge_1000',
          intervalMs: 0,
          durationMs,
          operationCount: LWW_MERGE_COUNT,
          finalCrdtValue: 0,
          averageOperationTimeMs: durationMs / LWW_MERGE_COUNT,
          maxOperationTimeMs: Math.max(...opTimes),
          burstSize: LWW_MERGE_COUNT,
          burstMergeTimeMs: durationMs,
          notes: 'Supplementary LWW Register merge benchmark',
        });
        setSavedRunsCount(loggerRef.current.getRuns().length);
        setLwwBenchmarkResult(
          `LWW Merge 1000 (${mode.toUpperCase()}): logged ${LWW_MERGE_COUNT} sequential merges`,
        );
      } catch (e: any) {
        setLwwBenchmarkResult(
          `LWW merge benchmark failed: ${String(e?.message ?? e)}`,
        );
      }
    },
    [isLwwRunning, isRunning],
  );

  const resetAll = useCallback(async () => {
    stopLoop();
    counterRef.current.reset();
    try {
      await NativeCRDT.reset();
    } catch {
      // Native module may be unavailable; ignore.
    }
    resetMetrics('idle');
    setNativeTestResult('');
    setNativeSmokeResult('');
    setLwwSmokeResult('');
    setBurstResult('');
    setNetworkStatus('unknown');
    setLastConnectivityCheckAt('');
    setLastConnectivityError('');
    setNetworkDemoResult('');
  }, [resetMetrics, stopLoop]);

  const resetLwwMetricsAndState = useCallback(async () => {
    stopLwwLoop();
    lwwRegisterRef.current.reset();
    try {
      await NativeCRDT.lwwReset();
    } catch {
      // Native module may be unavailable; ignore.
    }
    resetLwwMetrics('idle');
    setLwwBenchmarkResult('');
  }, [resetLwwMetrics, stopLwwLoop]);

  const exportCSV = useCallback(async () => {
    const csv = loggerRef.current.exportToCSV();
    console.log(csv);

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

  const copyCSV = useCallback(async () => {
    const csv = loggerRef.current.exportToCSV();
    try {
      await CSVExport.copyToClipboard(csv);
      Alert.alert('Copied', 'CSV copied to clipboard.');
    } catch (e: any) {
      Alert.alert(
        'Copy failed',
        `Could not copy CSV: ${String(e?.message ?? e)}`,
      );
    }
  }, []);

  const runNativeIncrementTest = useCallback(async () => {
    setNativeTestResult('Native Increment Test: Running…');
    try {
      const value = await NativeCRDT.increment('device-1');
      setNativeTestResult(`Native Increment Test: OK ${value}`);
    } catch (e: any) {
      setNativeTestResult(
        `Native Increment Test: FAIL ${String(e?.message ?? e)}`,
      );
    }
  }, []);

  const runNativeSmokeTest = useCallback(async () => {
    type Step = {label: string; expected: unknown; actual: unknown};
    const steps: Step[] = [];

    const fail = (label: string, expected: unknown, actual: unknown) => {
      const message =
        `FAIL @ ${label}: expected=${String(expected)} ` +
        `actual=${String(actual)}`;
      setNativeSmokeResult(`G-Counter Native Smoke Test: ${message}`);
      console.log({
        status: 'FAIL',
        steps,
        failedAt: {label, expected, actual},
      });
    };

    setNativeSmokeResult('Running…');

    try {
      // a. reset() => true
      const resetOk = await NativeCRDT.reset();
      steps.push({label: 'reset()', expected: true, actual: resetOk});
      if (resetOk !== true) {
        fail('reset()', true, resetOk);
        return;
      }

      // b. getValue() => 0
      const v0 = await NativeCRDT.getValue();
      steps.push({label: 'getValue() after reset', expected: 0, actual: v0});
      if (v0 !== 0) {
        fail('getValue() after reset', 0, v0);
        return;
      }

      // c. increment("device-1") => 1
      const v1 = await NativeCRDT.increment('device-1');
      steps.push({label: 'increment(device-1) #1', expected: 1, actual: v1});
      if (v1 !== 1) {
        fail('increment(device-1) #1', 1, v1);
        return;
      }

      // d. increment("device-1") => 2
      const v2 = await NativeCRDT.increment('device-1');
      steps.push({label: 'increment(device-1) #2', expected: 2, actual: v2});
      if (v2 !== 2) {
        fail('increment(device-1) #2', 2, v2);
        return;
      }

      // e. merge({ device-1: 5, device-2: 3 }) => 8
      const v3 = await NativeCRDT.merge({'device-1': 5, 'device-2': 3});
      steps.push({
        label: 'merge({device-1:5, device-2:3})',
        expected: 8,
        actual: v3,
      });
      if (v3 !== 8) {
        fail('merge({device-1:5, device-2:3})', 8, v3);
        return;
      }

      // f. getValue() => 8
      const v4 = await NativeCRDT.getValue();
      steps.push({label: 'getValue() after merge #1', expected: 8, actual: v4});
      if (v4 !== 8) {
        fail('getValue() after merge #1', 8, v4);
        return;
      }

      // g. merge({ device-1: 2, device-2: 10 }) => 15
      const v5 = await NativeCRDT.merge({'device-1': 2, 'device-2': 10});
      steps.push({
        label: 'merge({device-1:2, device-2:10})',
        expected: 15,
        actual: v5,
      });
      if (v5 !== 15) {
        fail('merge({device-1:2, device-2:10})', 15, v5);
        return;
      }

      // 1. merge({ device-1: 1 }) (should not decrease) => still 15
      const v6 = await NativeCRDT.merge({'device-1': 1});
      steps.push({
        label: 'merge({device-1:1}) does not decrease',
        expected: 15,
        actual: v6,
      });
      if (v6 !== 15) {
        fail('merge({device-1:1}) does not decrease', 15, v6);
        return;
      }

      // 2. reset() => true
      const resetOk2 = await NativeCRDT.reset();
      steps.push({label: 'reset() #2', expected: true, actual: resetOk2});
      if (resetOk2 !== true) {
        fail('reset() #2', true, resetOk2);
        return;
      }

      // 3. getValue() => 0
      const v7 = await NativeCRDT.getValue();
      steps.push({label: 'getValue() after reset #2', expected: 0, actual: v7});
      if (v7 !== 0) {
        fail('getValue() after reset #2', 0, v7);
        return;
      }

      // 4. merge({ replica-a: 100, replica-b: 50 }) => 150
      const v8 = await NativeCRDT.merge({'replica-a': 100, 'replica-b': 50});
      steps.push({
        label: 'merge({replica-a:100, replica-b:50})',
        expected: 150,
        actual: v8,
      });
      if (v8 !== 150) {
        fail('merge({replica-a:100, replica-b:50})', 150, v8);
        return;
      }

      // 5. increment("replica-a") => 151
      const v9 = await NativeCRDT.increment('replica-a');
      steps.push({
        label: 'increment(replica-a) after merge',
        expected: 151,
        actual: v9,
      });
      if (v9 !== 151) {
        fail('increment(replica-a) after merge', 151, v9);
        return;
      }

      const passMessage = 'PASS';
      setNativeSmokeResult(`G-Counter Native Smoke Test: ${passMessage}`);
      console.log({status: 'PASS', steps});
    } catch (e: any) {
      const message = `FAIL (exception): ${String(e?.message ?? e)}`;
      setNativeSmokeResult(`G-Counter Native Smoke Test: ${message}`);
      console.log({status: 'FAIL', steps, exception: String(e?.message ?? e)});
    }
  }, []);

  const runLwwSmokeTest = useCallback(async () => {
    const localReplicaId = 'A';
    const jsRegister = new LWWRegister(localReplicaId);
    const resultFlags = {
      newer: 'FAIL' as 'PASS' | 'FAIL',
      older: 'FAIL' as 'PASS' | 'FAIL',
      tieBreaker: 'FAIL' as 'PASS' | 'FAIL',
      reset: 'FAIL' as 'PASS' | 'FAIL',
      consistency: 'FAIL' as 'PASS' | 'FAIL',
    };

    const formatResult = (detail?: string) => {
      const lines = [
        `LWW Newer Timestamp: ${resultFlags.newer}`,
        `LWW Older Update Ignored: ${resultFlags.older}`,
        `LWW Tie-breaker: ${resultFlags.tieBreaker}`,
        `LWW Reset: ${resultFlags.reset}`,
        `LWW JS/Native Consistency: ${resultFlags.consistency}`,
      ];

      const allPassed = Object.values(resultFlags).every(
        flag => flag === 'PASS',
      );
      lines.push(
        `LWW Register Smoke Test: ${
          allPassed && !detail ? 'PASS' : `FAIL${detail ? ` ${detail}` : ''}`
        }`,
      );
      return lines.join('\n');
    };

    const fail = (message: string) => {
      setLwwSmokeResult(formatResult(message));
    };

    setLwwSmokeResult('LWW Register Smoke Test: Running…');

    try {
      jsRegister.reset();
      jsRegister.set('old', 100);
      jsRegister.merge({value: 'new', timestamp: 200, replicaId: 'B'});
      if (jsRegister.getValue() !== 'new') {
        fail(
          `JS newer timestamp expected "new" but got "${jsRegister.getValue()}"`,
        );
        return;
      }
      resultFlags.newer = 'PASS';

      jsRegister.reset();
      jsRegister.set('current', 500);
      jsRegister.merge({value: 'older', timestamp: 400, replicaId: 'B'});
      if (jsRegister.getValue() !== 'current') {
        fail(
          `JS older timestamp should be ignored but got "${jsRegister.getValue()}"`,
        );
        return;
      }
      resultFlags.older = 'PASS';

      const jsTieRegister = new LWWRegister(localReplicaId);
      jsTieRegister.merge({value: 'from-A', timestamp: 300, replicaId: 'A'});
      jsTieRegister.merge({value: 'from-B', timestamp: 300, replicaId: 'B'});
      const jsTieState = jsTieRegister.getState();
      if (jsTieState.value !== 'from-B' || jsTieState.replicaId !== 'B') {
        fail(
          `JS tie-break expected replicaId B/value from-B but got ${jsTieState.replicaId}/${jsTieState.value}`,
        );
        return;
      }
      resultFlags.tieBreaker = 'PASS';

      jsTieRegister.reset();
      const jsResetState = jsTieRegister.getState();
      if (
        jsResetState.value !== '' ||
        jsResetState.timestamp !== 0 ||
        jsResetState.replicaId !== localReplicaId
      ) {
        fail(
          `JS reset expected "",0,${localReplicaId} but got ${jsResetState.value},${jsResetState.timestamp},${jsResetState.replicaId}`,
        );
        return;
      }

      const nativeReset = await NativeCRDT.lwwReset();
      if (nativeReset !== true) {
        fail(`Native reset expected true but got ${String(nativeReset)}`);
        return;
      }
      const nativeResetState = await NativeCRDT.lwwGet();
      if (
        nativeResetState.value !== '' ||
        nativeResetState.timestamp !== 0 ||
        nativeResetState.replicaId !== ''
      ) {
        fail(
          `Native reset expected "",0,"" but got ${nativeResetState.value},${nativeResetState.timestamp},${nativeResetState.replicaId}`,
        );
        return;
      }
      resultFlags.reset = 'PASS';

      await NativeCRDT.lwwSet('old', 100, 'A');
      await NativeCRDT.lwwMerge({
        value: 'new',
        timestamp: 200,
        replicaId: 'B',
      });
      const nativeNewerState = await NativeCRDT.lwwGet();
      if (nativeNewerState.value !== 'new') {
        fail(
          `Native newer timestamp expected "new" but got "${nativeNewerState.value}"`,
        );
        return;
      }

      await NativeCRDT.lwwReset();
      await NativeCRDT.lwwSet('current', 500, 'A');
      await NativeCRDT.lwwMerge({
        value: 'older',
        timestamp: 400,
        replicaId: 'B',
      });
      const nativeOlderState = await NativeCRDT.lwwGet();
      if (nativeOlderState.value !== 'current') {
        fail(
          `Native older timestamp should be ignored but got "${nativeOlderState.value}"`,
        );
        return;
      }

      await NativeCRDT.lwwReset();
      await NativeCRDT.lwwMerge({
        value: 'from-A',
        timestamp: 300,
        replicaId: 'A',
      });
      await NativeCRDT.lwwMerge({
        value: 'from-B',
        timestamp: 300,
        replicaId: 'B',
      });
      const nativeTieState: LWWRegisterState = await NativeCRDT.lwwGet();
      if (
        nativeTieState.value !== 'from-B' ||
        nativeTieState.replicaId !== 'B'
      ) {
        fail(
          `Native tie-break expected replicaId B/value from-B but got ${nativeTieState.replicaId}/${nativeTieState.value}`,
        );
        return;
      }

      const jsFinalState = jsTieState;
      if (
        jsFinalState.value !== nativeTieState.value ||
        jsFinalState.timestamp !== nativeTieState.timestamp ||
        jsFinalState.replicaId !== nativeTieState.replicaId
      ) {
        fail(
          `JS/Native final state mismatch ${jsFinalState.value}/${jsFinalState.timestamp}/${jsFinalState.replicaId} vs ${nativeTieState.value}/${nativeTieState.timestamp}/${nativeTieState.replicaId}`,
        );
        return;
      }

      resultFlags.consistency = 'PASS';
      setLwwSmokeResult(formatResult());
    } catch (e: any) {
      fail(String(e?.message ?? e));
    }
  }, []);

  const checkConnectivity = useCallback(async () => {
    if (isCheckingConnectivity) {
      return;
    }

    setIsCheckingConnectivity(true);
    setLastConnectivityError('');

    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, CONNECTIVITY_TIMEOUT_MS);

    try {
      const response = await fetch(CONNECTIVITY_CHECK_URL, {
        method: 'GET',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setNetworkStatus('online');
      setLastConnectivityCheckAt(checkedAt);
      setLastConnectivityError('');
    } catch (e: any) {
      const message =
        e?.name === 'AbortError'
          ? `Timed out after ${CONNECTIVITY_TIMEOUT_MS}ms`
          : String(e?.message ?? e);
      setNetworkStatus('offline');
      setLastConnectivityCheckAt(checkedAt);
      setLastConnectivityError(message);
    } finally {
      clearTimeout(timeoutId);
      setIsCheckingConnectivity(false);
    }
  }, [isCheckingConnectivity]);

  const runNetworkReconnectionBurstDemo = useCallback(async () => {
    if (isRunning || isLwwRunning || isRunningNetworkDemo) {
      return;
    }

    setIsRunningNetworkDemo(true);
    setNetworkDemoResult('Running deterministic local reconnection burst…');

    const remoteState = generateDeterministicBurstState(
      NETWORK_DEMO_BURST_SIZE,
    );
    const remoteReplicaCount = Object.keys(remoteState).length;
    const startedAt = new Date().toISOString();

    try {
      const tempCounter = new GCounter('local');
      const t0 = nowMs();
      tempCounter.merge(remoteState);
      const burstMergeTimeMs = nowMs() - t0;
      const finalCrdtValue = tempCounter.value();

      loggerRef.current.addRun({
        startedAt,
        endedAt: new Date().toISOString(),
        mode: 'js',
        benchmarkCategory: 'network_condition_demo',
        scenarioName: 'network_conditioner_reconnection_burst_10000',
        intervalMs: 0,
        durationMs: burstMergeTimeMs,
        operationCount: remoteReplicaCount,
        finalCrdtValue,
        averageOperationTimeMs: burstMergeTimeMs,
        maxOperationTimeMs: burstMergeTimeMs,
        burstSize: remoteReplicaCount,
        burstMergeTimeMs,
        notes:
          'Demonstration only; connectivity check uses real network, burst merge is deterministic local workload',
      });
      setSavedRunsCount(loggerRef.current.getRuns().length);

      setNetworkDemoResult(
        `Mode: JS • burstSize=${remoteReplicaCount} • finalCrdtValue=${finalCrdtValue} • burstMergeTimeMs=${burstMergeTimeMs.toFixed(
          3,
        )}`,
      );
    } catch (e: any) {
      setNetworkDemoResult(`Error: ${String(e?.message ?? e)}`);
    } finally {
      setIsRunningNetworkDemo(false);
    }
  }, [isLwwRunning, isRunning, isRunningNetworkDemo]);

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
      stopLwwLoop();
    };
  }, [stopLoop, stopLwwLoop]);

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
            <Button
              title="Export CSV File"
              onPress={exportCSV}
              kind="secondary"
            />
            <Button
              title="Copy CSV"
              onPress={() => fireAndForget(copyCSV())}
              kind="secondary"
            />
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Validation Utilities</Text>
          <Text style={styles.note}>
            Secondary validation helpers for smoke checks and architecture
            verification. These utilities are not part of the primary benchmark
            data collection workflow.
          </Text>
          <View style={styles.row}>
            <Button
              title="Native increment test"
              onPress={runNativeIncrementTest}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run Native Smoke Test"
              onPress={() => fireAndForget(runNativeSmokeTest())}
              kind="secondary"
              disabled={isRunning}
            />
            <Button
              title="Run LWW Smoke Test"
              onPress={() => fireAndForget(runLwwSmokeTest())}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          {nativeTestResult.length > 0 ? (
            <Text style={styles.note}>{nativeTestResult}</Text>
          ) : null}
          {nativeSmokeResult.length > 0 ? (
            <Text style={styles.note}>{nativeSmokeResult}</Text>
          ) : null}
          {lwwSmokeResult.length > 0 ? (
            <Text style={styles.note}>{lwwSmokeResult}</Text>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>
            Supplementary Network Condition Demo
          </Text>
          <Text style={styles.note}>
            Use Apple Network Link Conditioner with 100% packet loss to make the
            connectivity check fail, then disable it to confirm recovery.
          </Text>
          <Text style={styles.note}>
            The reconnection burst demo is deterministic and local. It models
            accumulated CRDT updates after reconnection without adding a
            backend, so measurements stay reproducible. This section is
            supplementary and is not treated as an official performance
            benchmark.
          </Text>
          <View style={styles.row}>
            <Button
              title="Check Connectivity"
              onPress={() => fireAndForget(checkConnectivity())}
              kind="secondary"
              disabled={isCheckingConnectivity || isRunningNetworkDemo}
            />
            <Button
              title="Run Reconnection Burst Demo"
              onPress={() => fireAndForget(runNetworkReconnectionBurstDemo())}
              kind="secondary"
              disabled={isRunning || isLwwRunning || isRunningNetworkDemo}
            />
          </View>
          <Text style={styles.note}>Network status: {networkStatus}</Text>
          <Text style={styles.note}>
            Last connectivity check:{' '}
            {lastConnectivityCheckAt.length > 0
              ? lastConnectivityCheckAt
              : 'Not checked yet'}
          </Text>
          {lastConnectivityError.length > 0 ? (
            <Text style={styles.note}>
              Last connectivity error: {lastConnectivityError}
            </Text>
          ) : null}
          {networkDemoResult.length > 0 ? (
            <Text style={styles.note}>
              Reconnection burst result: {networkDemoResult}
            </Text>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Supplementary LWW Register</Text>
          <Text style={styles.note}>
            Secondary validation only. G-Counter remains the primary CRDT
            benchmark baseline.
          </Text>
          <View style={styles.row}>
            <Button
              title="Start JS LWW Update 20ms"
              onPress={() => fireAndForget(startLwwUpdateBenchmark('js'))}
              kind="secondary"
              disabled={isRunning || isLwwRunning}
            />
            <Button
              title="Start Native LWW Update 20ms"
              onPress={() => fireAndForget(startLwwUpdateBenchmark('native'))}
              kind="secondary"
              disabled={isRunning || isLwwRunning}
            />
            <Button
              title="Stop LWW"
              onPress={() => stopAndLogLwwUpdateRun('manual')}
              kind="danger"
              disabled={!isLwwRunning}
            />
            <Button
              title="Reset LWW"
              onPress={() => fireAndForget(resetLwwMetricsAndState())}
              kind="secondary"
              disabled={isRunning}
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Run JS LWW Merge 1000"
              onPress={() => fireAndForget(runLwwMergeBenchmark('js'))}
              kind="secondary"
              disabled={isRunning || isLwwRunning}
            />
            <Button
              title="Run Native LWW Merge 1000"
              onPress={() => fireAndForget(runLwwMergeBenchmark('native'))}
              kind="secondary"
              disabled={isRunning || isLwwRunning}
            />
          </View>
          {isLwwRunning ? (
            <Text style={styles.note}>
              LWW Remaining: {(Math.max(0, lwwRemainingMs) / 1000).toFixed(1)}s
            </Text>
          ) : null}
          <Text style={styles.note}>
            LWW mode: {lwwMetrics.mode} • operations:{' '}
            {lwwMetrics.operationCount}
            {' • '}avg: {lwwMetrics.averageOperationTimeMs.toFixed(3)}ms • max:{' '}
            {lwwMetrics.maxOperationTimeMs.toFixed(3)}ms
          </Text>
          {lwwBenchmarkResult.length > 0 ? (
            <Text style={styles.note}>{lwwBenchmarkResult}</Text>
          ) : null}
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
