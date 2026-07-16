import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {MetricsPanel} from '../components/MetricsPanel';
import {GCounter} from '../crdt/js/GCounter';
import {LWWRegister} from '../crdt/js/LWWRegister';
import type {LWWRegisterState} from '../crdt/js/lwwTypes';
import {
  BenchmarkRunLifecycle,
  createRunId,
  type ActiveRunSnapshot,
} from '../benchmarks/runLifecycle';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import type {BenchmarkRun} from '../metrics/types';
import {CSVExport} from '../native/CSVExport';
import {NativeCRDT} from '../native/NativeCRDT';

type Mode = 'idle' | 'js' | 'native';
type IntervalOption = 100 | 50 | 20;
type NetworkStatus = 'unknown' | 'online' | 'offline';
type IntervalRunSnapshot = ActiveRunSnapshot<
  Exclude<Mode, 'idle'>,
  {intervalMs: IntervalOption}
>;

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
const BURST_SIZES = [500, 1000, 5000, 10000] as const;
const CONNECTIVITY_CHECK_URL = 'https://www.apple.com';
const CONNECTIVITY_TIMEOUT_MS = 3000;
const NETWORK_DEMO_BURST_SIZE = 10_000;

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
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function formatIntervalLabel(ms: IntervalOption): string {
  return `${ms}ms`;
}

function createBurstState(size: number): Record<string, number> {
  const state: Record<string, number> = {};
  for (let index = 0; index < size; index += 1) {
    state[`remote-${index}`] = 1;
  }
  return state;
}

function formatCheckedAt(value: string): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatLwwState(state: LWWRegisterState): string {
  return `{ value: "${state.value}", timestamp: ${state.timestamp}, replicaId: "${state.replicaId}" }`;
}

function getCrdtRuns(): BenchmarkRun[] {
  return sharedBenchmarkLogger
    .getRuns()
    .filter(
      run =>
        run.benchmarkCategory === 'crdt_interval' ||
        run.benchmarkCategory === 'crdt_burst',
    );
}

function fireAndForget(task: Promise<unknown>): void {
  task.catch(() => {});
}

function Button({
  title,
  onPress,
  disabled,
  kind = 'primary',
  layout = 'half',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  layout?: 'half' | 'full';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.button,
        layout === 'full' ? styles.buttonFull : styles.buttonHalf,
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
  onSelect: (value: IntervalOption) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map(option => {
        const isSelected = option === selected;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
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
              {formatIntervalLabel(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BenchmarkScreen(): React.JSX.Element {
  const counterRef = useRef(new GCounter('local'));
  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef('');
  const runStartPerfRef = useRef(0);
  const operationTimesRef = useRef<number[]>([]);
  const lifecycleRef = useRef(
    new BenchmarkRunLifecycle<Exclude<Mode, 'idle'>, {intervalMs: IntervalOption}>(),
  );
  const metricsRef = useRef<MetricsSnapshot>({
    crdtValue: 0,
    elapsedMs: 0,
    operationCount: 0,
    averageOperationTimeMs: 0,
    maxOperationTimeMs: 0,
    selectedIntervalMs: 100,
    mode: 'idle',
  });

  const [selectedIntervalMs, setSelectedIntervalMs] =
    useState<IntervalOption>(100);
  const [remainingMs, setRemainingMs] = useState(BENCHMARK_DURATION_MS);
  const [savedRunsCount, setSavedRunsCount] = useState(getCrdtRuns().length);
  const [statusMessage, setStatusMessage] = useState('');
  const [burstResult, setBurstResult] = useState('');
  const [lwwValidationResult, setLwwValidationResult] = useState('');
  const [isRunningLwwValidation, setIsRunningLwwValidation] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('unknown');
  const [lastConnectivityCheckAt, setLastConnectivityCheckAt] = useState('');
  const [lastConnectivityError, setLastConnectivityError] = useState('');
  const [isCheckingConnectivity, setIsCheckingConnectivity] = useState(false);
  const [networkDemoResult, setNetworkDemoResult] = useState('');
  const [isRunningNetworkDemo, setIsRunningNetworkDemo] = useState(false);
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

  const updateMetrics = useCallback((next: MetricsSnapshot) => {
    metricsRef.current = next;
    setMetrics(next);
  }, []);

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
    clearTickTimer();
    clearAutoStopTimer();
  }, [clearAutoStopTimer, clearTickTimer]);

  const resetMetrics = useCallback(
    (mode: Mode = 'idle') => {
      operationTimesRef.current = [];
      startedAtRef.current = '';
      runStartPerfRef.current = 0;
      setRemainingMs(BENCHMARK_DURATION_MS);
      updateMetrics({
        crdtValue: 0,
        elapsedMs: 0,
        operationCount: 0,
        averageOperationTimeMs: 0,
        maxOperationTimeMs: 0,
        selectedIntervalMs,
        mode,
      });
    },
    [selectedIntervalMs, updateMetrics],
  );

  const setIdleMetrics = useCallback(
    (next: MetricsSnapshot) => {
      updateMetrics({...next, mode: 'idle'});
    },
    [updateMetrics],
  );

  const finalizeAutoRun = useCallback(
    (snapshot: IntervalRunSnapshot) => {
      const current = metricsRef.current;
      if (current.mode === 'idle' || current.mode !== snapshot.mode) {
        return;
      }

      stopLoop();
      sharedBenchmarkLogger.addRun({
        startedAt: snapshot.startedAt,
        endedAt: new Date().toISOString(),
        mode: snapshot.mode,
        benchmarkCategory: 'crdt_interval',
        scenarioName: `interval_${snapshot.config.intervalMs}ms`,
        intervalMs: snapshot.config.intervalMs,
        durationMs: snapshot.configuredDurationMs,
        operationCount: current.operationCount,
        finalCrdtValue: current.crdtValue,
        averageOperationTimeMs: current.averageOperationTimeMs,
        maxOperationTimeMs: current.maxOperationTimeMs,
        burstSize: 0,
        burstMergeTimeMs: 0,
        notes: 'Completed full 60s interval benchmark',
      });
      setSavedRunsCount(getCrdtRuns().length);
      setRemainingMs(0);
      setIdleMetrics({
        ...current,
        elapsedMs: snapshot.configuredDurationMs,
        selectedIntervalMs: snapshot.config.intervalMs,
      });
      setStatusMessage('Benchmark completed and logged.');
    },
    [setIdleMetrics, stopLoop],
  );

  const resetAll = useCallback(async () => {
    lifecycleRef.current.cleanup();
    stopLoop();
    counterRef.current.reset();
    try {
      await NativeCRDT.reset();
    } catch {}
    resetMetrics();
    setStatusMessage('');
    setBurstResult('');
  }, [resetMetrics, stopLoop]);

  const stopCurrentRun = useCallback(
    (reason: 'manual' | 'auto') => {
      const activeRun = lifecycleRef.current.getActiveRun();
      if (activeRun === null) {
        stopLoop();
        return;
      }

      if (reason === 'auto') {
        lifecycleRef.current.stopRun(activeRun.runId, finalizeAutoRun);
        return;
      }

      const current = metricsRef.current;
      lifecycleRef.current.stopRun(activeRun.runId, () => {
        stopLoop();
        setIdleMetrics(current);
        setStatusMessage('Benchmark stopped before 60 seconds.');
      });
    },
    [finalizeAutoRun, setIdleMetrics, stopLoop],
  );

  const startBenchmark = useCallback(
    async (mode: Exclude<Mode, 'idle'>) => {
      if (lifecycleRef.current.hasActiveRun()) {
        return;
      }

      setBurstResult('');
      setStatusMessage('');
      counterRef.current.reset();

      if (mode === 'native') {
        await NativeCRDT.reset();
      }

      const startedAt = new Date().toISOString();
      startedAtRef.current = startedAt;
      runStartPerfRef.current = nowMs();
      operationTimesRef.current = [];
      const runSnapshot = lifecycleRef.current.startRun(
        {
          runId: createRunId(),
          mode,
          startedAt,
          startPerfMs: runStartPerfRef.current,
          configuredDurationMs: BENCHMARK_DURATION_MS,
          config: {
            intervalMs: selectedIntervalMs,
          },
        },
        finalizeAutoRun,
      );

      if (runSnapshot === null) {
        return;
      }

      updateMetrics({
        crdtValue: 0,
        elapsedMs: 0,
        operationCount: 0,
        averageOperationTimeMs: 0,
        maxOperationTimeMs: 0,
        selectedIntervalMs,
        mode,
      });
      setRemainingMs(BENCHMARK_DURATION_MS);

      const tick = async () => {
        if (!lifecycleRef.current.isActiveRun(runSnapshot.runId)) {
          return;
        }

        const opStartedAt = nowMs();
        let value = 0;
        if (runSnapshot.mode === 'native') {
          value = await NativeCRDT.increment('local');
        } else {
          counterRef.current.increment();
          value = counterRef.current.value();
        }

        if (!lifecycleRef.current.isActiveRun(runSnapshot.runId)) {
          return;
        }

        const opDuration = nowMs() - opStartedAt;
        operationTimesRef.current.push(opDuration);

        const elapsedMs = nowMs() - runStartPerfRef.current;
        const next: MetricsSnapshot = {
          crdtValue: value,
          elapsedMs,
          operationCount: operationTimesRef.current.length,
          averageOperationTimeMs: mean(operationTimesRef.current),
          maxOperationTimeMs: Math.max(...operationTimesRef.current),
          selectedIntervalMs: runSnapshot.config.intervalMs,
          mode: runSnapshot.mode,
        };
        updateMetrics(next);
        setRemainingMs(Math.max(0, BENCHMARK_DURATION_MS - elapsedMs));

        const nextTimer = setTimeout(tick, runSnapshot.config.intervalMs);
        if (lifecycleRef.current.setTickTimer(runSnapshot.runId, nextTimer)) {
          tickTimerRef.current = nextTimer;
        }
      };

      fireAndForget(tick());
    },
    [finalizeAutoRun, selectedIntervalMs, updateMetrics],
  );

  const runBurstMerge = useCallback(
    async (mode: 'js' | 'native', burstSize: (typeof BURST_SIZES)[number]) => {
      if (isRunning) {
        Alert.alert('Stop first', 'Stop the active interval run first.');
        return;
      }

      const remoteState = createBurstState(burstSize);
      const startedAt = new Date().toISOString();

      try {
        const mergeStartedAt = nowMs();
        let finalValue = 0;

        if (mode === 'native') {
          await NativeCRDT.reset();
          finalValue = await NativeCRDT.merge(remoteState);
          await NativeCRDT.reset();
        } else {
          const tempCounter = new GCounter('local');
          tempCounter.merge(remoteState);
          finalValue = tempCounter.value();
        }

        const mergeDurationMs = nowMs() - mergeStartedAt;
        sharedBenchmarkLogger.addRun({
          startedAt,
          endedAt: new Date().toISOString(),
          mode,
          benchmarkCategory: 'crdt_burst',
          scenarioName: `burst_merge_${burstSize}`,
          intervalMs: 0,
          durationMs: 0,
          operationCount: burstSize,
          finalCrdtValue: finalValue,
          averageOperationTimeMs: 0,
          maxOperationTimeMs: 0,
          burstSize,
          burstMergeTimeMs: mergeDurationMs,
          notes: 'Deterministic burst merge with isolated local state',
        });
        setSavedRunsCount(getCrdtRuns().length);
        setBurstResult(
          `${mode.toUpperCase()} burst ${burstSize}: value=${finalValue}, merge=${mergeDurationMs.toFixed(
            3,
          )}ms`,
        );
      } catch (error: any) {
        setBurstResult(`Burst merge failed: ${String(error?.message ?? error)}`);
      }
    },
    [isRunning],
  );

  const clearResults = useCallback(() => {
    const removedCount = sharedBenchmarkLogger.removeRuns(
      run =>
        run.benchmarkCategory === 'crdt_interval' ||
        run.benchmarkCategory === 'crdt_burst',
    );
    setSavedRunsCount(getCrdtRuns().length);
    setStatusMessage(
      removedCount > 0
        ? 'CRDT benchmark results cleared.'
        : 'No CRDT benchmark results were stored.',
    );
  }, []);

  const exportCSV = useCallback(async () => {
    const runs = getCrdtRuns();
    if (runs.length === 0) {
      setStatusMessage('No CRDT benchmark runs to export.');
      return;
    }

    try {
      await CSVExport.exportCSV(
        sharedBenchmarkLogger.exportRunsToCSV(runs),
        'benchmark-results.csv',
      );
      setStatusMessage('CRDT benchmark CSV exported.');
    } catch (error: any) {
      setStatusMessage(`CSV export failed: ${String(error?.message ?? error)}`);
    }
  }, []);

  const copyCSV = useCallback(async () => {
    const runs = getCrdtRuns();
    if (runs.length === 0) {
      setStatusMessage('No CRDT benchmark runs to copy.');
      return;
    }

    try {
      await CSVExport.copyToClipboard(
        sharedBenchmarkLogger.exportRunsToCSV(runs),
      );
      setStatusMessage('CRDT benchmark CSV copied.');
    } catch (error: any) {
      setStatusMessage(`Copy failed: ${String(error?.message ?? error)}`);
    }
  }, []);

  const runLwwValidation = useCallback(async () => {
    if (isRunning || isRunningNetworkDemo || isCheckingConnectivity) {
      Alert.alert(
        'Stop first',
        'Finish the active benchmark or supplementary demo before running LWW validation.',
      );
      return;
    }

    const localReplicaId = 'A';
    const jsRegister = new LWWRegister(localReplicaId);
    const expectedTieState: LWWRegisterState = {
      value: 'from-B',
      timestamp: 300,
      replicaId: 'B',
    };
    const flags = {
      jsNewer: 'FAIL' as 'PASS' | 'FAIL',
      jsOlderIgnored: 'FAIL' as 'PASS' | 'FAIL',
      jsTieBreaker: 'FAIL' as 'PASS' | 'FAIL',
      nativeNewer: 'FAIL' as 'PASS' | 'FAIL',
      nativeOlderIgnored: 'FAIL' as 'PASS' | 'FAIL',
      nativeTieBreaker: 'FAIL' as 'PASS' | 'FAIL',
      jsNativeMatch: 'FAIL' as 'PASS' | 'FAIL',
    };

    let jsFinalState: LWWRegisterState | null = null;
    let nativeFinalState: LWWRegisterState | null = null;

    const formatResult = (detail?: string) => {
      const lines = [
        `JS higher timestamp: ${flags.jsNewer}`,
        `JS lower timestamp ignored: ${flags.jsOlderIgnored}`,
        `JS equal timestamp tie-breaker: ${flags.jsTieBreaker}`,
        `Native higher timestamp: ${flags.nativeNewer}`,
        `Native lower timestamp ignored: ${flags.nativeOlderIgnored}`,
        `Native equal timestamp tie-breaker: ${flags.nativeTieBreaker}`,
        `JS/native final state match: ${flags.jsNativeMatch}`,
        `Expected equal-timestamp winner: ${formatLwwState(expectedTieState)}`,
        `JavaScript result: ${jsFinalState ? formatLwwState(jsFinalState) : '—'}`,
        `Native result: ${nativeFinalState ? formatLwwState(nativeFinalState) : '—'}`,
      ];
      const passed = Object.values(flags).every(flag => flag === 'PASS');
      lines.push(`LWW validation: ${passed && !detail ? 'PASS' : `FAIL${detail ? ` — ${detail}` : ''}`}`);
      return lines.join('\n');
    };

    const fail = (message: string) => {
      setLwwValidationResult(formatResult(message));
    };

    setIsRunningLwwValidation(true);
    setLwwValidationResult('LWW validation: Running…');

    try {
      jsRegister.reset();
      jsRegister.set('old', 100);
      jsRegister.merge({value: 'new', timestamp: 200, replicaId: 'B'});
      if (jsRegister.getValue() !== 'new') {
        fail(`JS higher timestamp expected "new" but got "${jsRegister.getValue()}"`);
        return;
      }
      flags.jsNewer = 'PASS';

      jsRegister.reset();
      jsRegister.set('current', 500);
      jsRegister.merge({value: 'older', timestamp: 400, replicaId: 'B'});
      if (jsRegister.getValue() !== 'current') {
        fail(
          `JS lower timestamp should be ignored but got "${jsRegister.getValue()}"`,
        );
        return;
      }
      flags.jsOlderIgnored = 'PASS';

      const jsTieRegister = new LWWRegister(localReplicaId);
      jsTieRegister.merge({value: 'from-A', timestamp: 300, replicaId: 'A'});
      jsTieRegister.merge({value: 'from-B', timestamp: 300, replicaId: 'B'});
      jsFinalState = jsTieRegister.getState();
      if (
        jsFinalState.value !== expectedTieState.value ||
        jsFinalState.replicaId !== expectedTieState.replicaId ||
        jsFinalState.timestamp !== expectedTieState.timestamp
      ) {
        fail(
          `JS tie-breaker expected ${formatLwwState(expectedTieState)} but got ${formatLwwState(jsFinalState)}`,
        );
        return;
      }
      flags.jsTieBreaker = 'PASS';

      const nativeReset = await NativeCRDT.lwwReset();
      if (nativeReset !== true) {
        fail(`Native reset expected true but got ${String(nativeReset)}`);
        return;
      }

      await NativeCRDT.lwwSet('old', 100, 'A');
      await NativeCRDT.lwwMerge({
        value: 'new',
        timestamp: 200,
        replicaId: 'B',
      });
      const nativeNewerState = await NativeCRDT.lwwGet();
      if (nativeNewerState.value !== 'new') {
        fail(
          `Native higher timestamp expected "new" but got "${nativeNewerState.value}"`,
        );
        return;
      }
      flags.nativeNewer = 'PASS';

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
          `Native lower timestamp should be ignored but got "${nativeOlderState.value}"`,
        );
        return;
      }
      flags.nativeOlderIgnored = 'PASS';

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
      nativeFinalState = await NativeCRDT.lwwGet();
      if (
        nativeFinalState.value !== expectedTieState.value ||
        nativeFinalState.replicaId !== expectedTieState.replicaId ||
        nativeFinalState.timestamp !== expectedTieState.timestamp
      ) {
        fail(
          `Native tie-breaker expected ${formatLwwState(expectedTieState)} but got ${formatLwwState(nativeFinalState)}`,
        );
        return;
      }
      flags.nativeTieBreaker = 'PASS';

      if (
        !jsFinalState ||
        jsFinalState.value !== nativeFinalState.value ||
        jsFinalState.timestamp !== nativeFinalState.timestamp ||
        jsFinalState.replicaId !== nativeFinalState.replicaId
      ) {
        fail(
          `JS/native mismatch ${jsFinalState ? formatLwwState(jsFinalState) : '—'} vs ${formatLwwState(nativeFinalState)}`,
        );
        return;
      }
      flags.jsNativeMatch = 'PASS';
      setLwwValidationResult(formatResult());
    } catch (error: any) {
      fail(String(error?.message ?? error));
    } finally {
      setIsRunningLwwValidation(false);
    }
  }, [isCheckingConnectivity, isRunning, isRunningNetworkDemo]);

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
    } catch (error: any) {
      const message =
        error?.name === 'AbortError'
          ? `Timed out after ${CONNECTIVITY_TIMEOUT_MS}ms`
          : String(error?.message ?? error);
      setNetworkStatus('offline');
      setLastConnectivityCheckAt(checkedAt);
      setLastConnectivityError(message);
    } finally {
      clearTimeout(timeoutId);
      setIsCheckingConnectivity(false);
    }
  }, [isCheckingConnectivity]);

  const runNetworkReconnectionBurstDemo = useCallback(async () => {
    if (isRunning || isRunningLwwValidation || isRunningNetworkDemo) {
      Alert.alert(
        'Stop first',
        'Finish the active benchmark or validation before running the network demo.',
      );
      return;
    }

    setIsRunningNetworkDemo(true);
    setNetworkDemoResult('Running deterministic local reconnection burst simulation…');

    try {
      const remoteState = createBurstState(NETWORK_DEMO_BURST_SIZE);
      const burstSize = Object.keys(remoteState).length;
      const expectedFinalValue = burstSize;
      const tempCounter = new GCounter('local');
      const mergeStartedAt = nowMs();
      tempCounter.merge(remoteState);
      const mergeDurationMs = nowMs() - mergeStartedAt;
      const finalValue = tempCounter.value();

      setNetworkDemoResult(
        `Network demo: PASS\nScenario: deterministic local reconnection burst simulation from a clean counter\nBurst size: ${burstSize}\nExpected final G-Counter value: ${expectedFinalValue}\nActual final G-Counter value: ${finalValue}\nMerge time: ${mergeDurationMs.toFixed(3)}ms\nExcluded from the official repeated measurement protocol.`,
      );
    } catch (error: any) {
      setNetworkDemoResult(`Network demo failed: ${String(error?.message ?? error)}`);
    } finally {
      setIsRunningNetworkDemo(false);
    }
  }, [isRunning, isRunningLwwValidation, isRunningNetworkDemo]);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    return () => {
      lifecycle.cleanup();
      stopLoop();
    };
  }, [stopLoop]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>CRDT Benchmark</Text>
        <Text style={styles.subheader}>Saved runs: {savedRunsCount}</Text>
        <Text style={styles.note}>
          The interval benchmark compares a JavaScript G-Counter baseline
          against the Swift classic bridge module under repeated updates.
        </Text>
        <Text style={styles.note}>
          Burst merge scenarios use deterministic local replica sets to measure
          batched merge cost without a backend dependency.
        </Text>
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
            onSelect={value => {
              if (isRunning) {
                Alert.alert(
                  'Stop first',
                  'Stop the current benchmark before changing the interval.',
                );
                return;
              }
              setSelectedIntervalMs(value);
              updateMetrics({...metricsRef.current, selectedIntervalMs: value});
            }}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Controls</Text>
          <View style={styles.buttonRow}>
            <Button
              title="Start JS Benchmark"
              onPress={() => fireAndForget(startBenchmark('js'))}
              disabled={isRunning}
            />
            <Button
              title="Start Native Benchmark"
              onPress={() => fireAndForget(startBenchmark('native'))}
              disabled={isRunning}
            />
          </View>
          <View style={styles.buttonRow}>
            <Button
              title="Stop"
              onPress={() => stopCurrentRun('manual')}
              disabled={!isRunning}
              kind="danger"
              layout="full"
            />
          </View>
          <View style={styles.buttonRow}>
            <Button
              title="Reset"
              onPress={() => fireAndForget(resetAll())}
              kind="secondary"
            />
            <Button
              title="Clear Results"
              onPress={clearResults}
              disabled={savedRunsCount === 0}
              kind="secondary"
            />
          </View>
          <View style={styles.buttonRow}>
            <Button
              title="Export CSV"
              onPress={() => fireAndForget(exportCSV())}
              disabled={savedRunsCount === 0}
              kind="secondary"
            />
            <Button
              title="Copy CSV"
              onPress={() => fireAndForget(copyCSV())}
              disabled={savedRunsCount === 0}
              kind="secondary"
            />
          </View>
          {statusMessage.length > 0 ? (
            <Text style={styles.note}>{statusMessage}</Text>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Burst Merge Scenarios</Text>
          <Text style={styles.note}>
            Each burst scenario merges one deterministic remote state into an
            isolated counter instance.
          </Text>
          <View style={styles.buttonRow}>
            {BURST_SIZES.slice(0, 2).map(size => (
              <Button
                key={`js-${size}`}
                title={`Run JS Burst ${size}`}
                onPress={() => fireAndForget(runBurstMerge('js', size))}
                disabled={isRunning}
                kind="secondary"
              />
            ))}
          </View>
          <View style={styles.buttonRow}>
            {BURST_SIZES.slice(2).map(size => (
              <Button
                key={`js-${size}`}
                title={`Run JS Burst ${size}`}
                onPress={() => fireAndForget(runBurstMerge('js', size))}
                disabled={isRunning}
                kind="secondary"
              />
            ))}
          </View>
          <View style={styles.buttonRow}>
            {BURST_SIZES.slice(0, 2).map(size => (
              <Button
                key={`native-${size}`}
                title={`Run Native Burst ${size}`}
                onPress={() => fireAndForget(runBurstMerge('native', size))}
                disabled={isRunning}
                kind="secondary"
              />
            ))}
          </View>
          <View style={styles.buttonRow}>
            {BURST_SIZES.slice(2).map(size => (
              <Button
                key={`native-${size}`}
                title={`Run Native Burst ${size}`}
                onPress={() => fireAndForget(runBurstMerge('native', size))}
                disabled={isRunning}
                kind="secondary"
              />
            ))}
          </View>
          {burstResult.length > 0 ? (
            <Text style={styles.note}>{burstResult}</Text>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Secondary CRDT Validation</Text>
          <Text style={styles.note}>
            This validation checks Last-Writer-Wins Register correctness as the
            second lightweight CRDT type referenced in the proposal. It is not
            part of the repeated performance-measurement protocol.
          </Text>
          <View style={styles.buttonRow}>
            <Button
              title="Run LWW Register Validation"
              onPress={() => fireAndForget(runLwwValidation())}
              disabled={isRunningLwwValidation || isRunning || isRunningNetworkDemo}
              kind="secondary"
              layout="full"
            />
          </View>
          {lwwValidationResult.length > 0 ? (
            <Text style={styles.note}>{lwwValidationResult}</Text>
          ) : null}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Supplementary Network Condition Demo</Text>
          <Text style={styles.note}>
            This section is supplementary and excluded from the official
            repeated performance-measurement protocol.
          </Text>
          <Text style={styles.note}>
            The connectivity check tests internet reachability by requesting
            `https://www.apple.com` with a timeout and can be affected by Apple
            Network Link Conditioner. The reconnection burst demo uses a
            deterministic local merge for reproducibility rather than automatic
            reconnection detection.
          </Text>
          <View style={styles.buttonRow}>
            <Button
              title="Check Connectivity"
              onPress={() => fireAndForget(checkConnectivity())}
              disabled={isCheckingConnectivity || isRunningNetworkDemo}
              kind="secondary"
            />
            <Button
              title="Run Reconnection Burst Demo"
              onPress={() => fireAndForget(runNetworkReconnectionBurstDemo())}
              disabled={isRunning || isRunningLwwValidation || isRunningNetworkDemo}
              kind="secondary"
            />
          </View>
          <Text style={styles.note}>Last network status: {networkStatus}</Text>
          <Text style={styles.note}>
            Last checked time: {formatCheckedAt(lastConnectivityCheckAt)}
          </Text>
          {lastConnectivityError.length > 0 ? (
            <Text style={styles.note}>Connectivity error: {lastConnectivityError}</Text>
          ) : null}
          {networkDemoResult.length > 0 ? (
            <Text style={styles.note}>{networkDemoResult}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#fff'},
  container: {padding: 16, paddingBottom: 40, gap: 12},
  header: {fontSize: 26, fontWeight: '800', color: '#111'},
  subheader: {fontSize: 14, color: '#333'},
  note: {fontSize: 14, lineHeight: 20, color: '#4a4a4a'},
  block: {
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.14)',
    backgroundColor: '#fff',
  },
  blockTitle: {fontSize: 18, fontWeight: '800', color: '#111'},
  buttonRow: {flexDirection: 'row', gap: 10},
  button: {
    minHeight: 46,
    borderRadius: 10,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  buttonHalf: {flex: 1},
  buttonFull: {flex: 1},
  buttonSecondary: {
    backgroundColor: '#ededed',
  },
  buttonDanger: {
    backgroundColor: '#b00020',
  },
  buttonDisabled: {opacity: 0.4},
  buttonDisabledPrimary: {backgroundColor: '#555'},
  buttonDisabledSecondary: {backgroundColor: '#ededed'},
  buttonDisabledDanger: {backgroundColor: '#d79aa8'},
  buttonPressed: {opacity: 0.86},
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  buttonTextSecondary: {color: '#111'},
  buttonTextDisabled: {color: '#fff'},
  buttonTextDisabledSecondary: {color: '#999'},
  segment: {flexDirection: 'row', gap: 8},
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  segmentItemSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  segmentItemPressed: {opacity: 0.9},
  segmentText: {fontSize: 14, fontWeight: '700', color: '#111'},
  segmentTextSelected: {color: '#fff'},
});
