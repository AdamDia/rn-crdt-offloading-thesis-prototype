import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';

import {runDashboardComputation} from '../dashboard/js/dashboardComputation';
import type {DashboardComputationResult} from '../dashboard/types';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import {NativeCRDT} from '../native/NativeCRDT';
import {CSVExport} from '../native/CSVExport';

type HeavySize = 1000 | 5000 | 10000;
type IntervalOption = 100 | 50 | 20;
type ContinuousMode = 'idle' | 'js' | 'native';
type UiStressMode = 'idle' | 'js' | 'native';
type StressVisualState = {
  cardValues: number[];
  chartValues: number[];
  gridValues: number[];
};

const BENCHMARK_DURATION_MS = 60_000;
const CHART_BAR_COUNT = 100;
const SPARK_BAR_COUNT = 40;
const UI_STRESS_SIZE = 10000;
const UI_STRESS_INTERVAL_MS = 20;
const UI_STRESS_CARD_COUNT = 100;
const UI_STRESS_BAR_COUNT = 300;
const UI_STRESS_GRID_COUNT = 120;

function formatSizeLabel(n: HeavySize): string {
  return `${n}`;
}

function formatIntervalLabel(ms: IntervalOption): string {
  return `${ms}ms`;
}

function nowMs(): number {
  const p = (globalThis as any).performance;
  if (p && typeof p.now === 'function') {
    return p.now();
  }
  return Date.now();
}

function formatNumber(value: number, fractionDigits: number = 2): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(fractionDigits);
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

function resample(values: number[], sampleSize: number): number[] {
  const n = values.length;
  const k = Math.max(0, Math.floor(sampleSize));
  if (n === 0 || k === 0) {
    return [];
  }
  if (n === 1) {
    return new Array(k).fill(values[0]);
  }
  if (n === k) {
    return values;
  }
  const out: number[] = [];
  for (let i = 0; i < k; i += 1) {
    const t = k === 1 ? 0 : i / (k - 1);
    const idx = Math.min(n - 1, Math.round(t * (n - 1)));
    out.push(values[idx]);
  }
  return out;
}

function createStressVisualState(
  input: DashboardComputationResult,
  tick: number,
): StressVisualState {
  const values = input.normalizedValues;
  const length = values.length;
  if (length === 0) {
    return {
      cardValues: new Array(UI_STRESS_CARD_COUNT).fill(0),
      chartValues: new Array(UI_STRESS_BAR_COUNT).fill(0),
      gridValues: new Array(UI_STRESS_GRID_COUNT).fill(0),
    };
  }

  const rotation = tick % length;
  const rotated = values
    .slice(rotation)
    .concat(values.slice(0, rotation))
    .map((value, index) => {
      const adjusted = value + (((tick + index) % 9) - 4) * 0.01;
      return Math.max(0, Math.min(1, adjusted));
    });

  return {
    cardValues: resample(rotated, UI_STRESS_CARD_COUNT),
    chartValues: resample(rotated, UI_STRESS_BAR_COUNT),
    gridValues: resample(rotated, UI_STRESS_GRID_COUNT),
  };
}

function Segment<T extends number>({
  options,
  selected,
  onSelect,
  labelFn,
}: {
  options: T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFn: (value: T) => string;
}) {
  return (
    <View style={styles.segment}>
      {options.map(v => {
        const isSelected = v === selected;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onSelect(v)}
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
              {labelFn(v)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled,
  kind = 'secondary',
  textStyle,
  textNumberOfLines,
  textAdjustsFontSizeToFit,
  textMinimumFontScale,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
  textStyle?: TextStyle;
  textNumberOfLines?: number;
  textAdjustsFontSizeToFit?: boolean;
  textMinimumFontScale?: number;
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
        numberOfLines={textNumberOfLines}
        adjustsFontSizeToFit={textAdjustsFontSizeToFit}
        minimumFontScale={textMinimumFontScale}
        style={[
          styles.buttonText,
          kind === 'secondary' && styles.buttonTextSecondary,
          disabled && styles.buttonTextDisabled,
          disabled &&
            kind === 'secondary' &&
            styles.buttonTextDisabledSecondary,
          textStyle,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function DashboardBenchmarkScreen(): React.JSX.Element {
  const sizeOptions = useMemo<HeavySize[]>(() => [1000, 5000, 10000], []);
  const intervalOptions = useMemo<IntervalOption[]>(() => [100, 50, 20], []);
  const [selectedSize, setSelectedSize] = useState<HeavySize>(1000);
  const [selectedIntervalMs, setSelectedIntervalMs] =
    useState<IntervalOption>(100);
  const [result, setResult] = useState<DashboardComputationResult | null>(null);
  const [lastMode, setLastMode] = useState<'js' | 'native' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [savedRunsCount, setSavedRunsCount] = useState<number>(
    sharedBenchmarkLogger.getRuns().length,
  );

  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickInFlightRef = useRef<boolean>(false);
  const runningModeRef = useRef<ContinuousMode>('idle');
  const runStartPerfRef = useRef<number>(0);
  const runStartedAtIsoRef = useRef<string>('');
  const opTimesRef = useRef<number[]>([]);
  const operationCountRef = useRef<number>(0);

  const [continuousMode, setContinuousMode] = useState<ContinuousMode>('idle');
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(BENCHMARK_DURATION_MS);
  const [operationCount, setOperationCount] = useState<number>(0);
  const [avgOpMs, setAvgOpMs] = useState<number>(0);
  const [maxOpMs, setMaxOpMs] = useState<number>(0);
  const [stressResult, setStressResult] =
    useState<DashboardComputationResult | null>(null);
  const [stressVisuals, setStressVisuals] = useState<StressVisualState>({
    cardValues: new Array(UI_STRESS_CARD_COUNT).fill(0),
    chartValues: new Array(UI_STRESS_BAR_COUNT).fill(0),
    gridValues: new Array(UI_STRESS_GRID_COUNT).fill(0),
  });
  const [stressMode, setStressMode] = useState<UiStressMode>('idle');
  const [stressStatusMessage, setStressStatusMessage] = useState<string>('');
  const [stressElapsedMs, setStressElapsedMs] = useState<number>(0);
  const [stressRemainingMs, setStressRemainingMs] = useState<number>(
    BENCHMARK_DURATION_MS,
  );
  const [stressOperationCount, setStressOperationCount] = useState<number>(0);
  const [stressAvgOpMs, setStressAvgOpMs] = useState<number>(0);
  const [stressMaxOpMs, setStressMaxOpMs] = useState<number>(0);

  const isContinuousRunning = continuousMode !== 'idle';
  const isUiStressRunning = stressMode !== 'idle';
  const isAnyRunning = isContinuousRunning || isUiStressRunning;

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

  const stopContinuousLoop = useCallback(() => {
    runningModeRef.current = 'idle';
    tickInFlightRef.current = false;
    clearTickTimer();
    clearAutoStopTimer();
    setContinuousMode('idle');
  }, [clearAutoStopTimer, clearTickTimer]);

  const resetContinuousMetrics = useCallback(() => {
    opTimesRef.current = [];
    runStartPerfRef.current = 0;
    operationCountRef.current = 0;
    setElapsedMs(0);
    setRemainingMs(BENCHMARK_DURATION_MS);
    setOperationCount(0);
    setAvgOpMs(0);
    setMaxOpMs(0);
  }, []);

  const scheduleNextTick = useCallback(
    (intervalMs: number, tickFn: () => Promise<void> | void) => {
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
    [],
  );

  const stressTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stressAutoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const stressTickInFlightRef = useRef<boolean>(false);
  const stressModeRef = useRef<UiStressMode>('idle');
  const stressRunStartPerfRef = useRef<number>(0);
  const stressRunStartedAtIsoRef = useRef<string>('');
  const stressOpTimesRef = useRef<number[]>([]);
  const stressOperationCountRef = useRef<number>(0);

  const clearStressTickTimer = useCallback(() => {
    if (stressTickTimerRef.current) {
      clearTimeout(stressTickTimerRef.current);
      stressTickTimerRef.current = null;
    }
  }, []);

  const clearStressAutoStopTimer = useCallback(() => {
    if (stressAutoStopTimerRef.current) {
      clearTimeout(stressAutoStopTimerRef.current);
      stressAutoStopTimerRef.current = null;
    }
  }, []);

  const stopUiStressLoop = useCallback(() => {
    stressModeRef.current = 'idle';
    stressTickInFlightRef.current = false;
    clearStressTickTimer();
    clearStressAutoStopTimer();
    setStressMode('idle');
  }, [clearStressAutoStopTimer, clearStressTickTimer]);

  const resetUiStressMetrics = useCallback(() => {
    stressOpTimesRef.current = [];
    stressRunStartPerfRef.current = 0;
    stressOperationCountRef.current = 0;
    setStressElapsedMs(0);
    setStressRemainingMs(BENCHMARK_DURATION_MS);
    setStressOperationCount(0);
    setStressAvgOpMs(0);
    setStressMaxOpMs(0);
  }, []);

  const stopAndLogContinuousRun = useCallback(
    (reason: 'manual' | 'auto' = 'manual') => {
      const mode = runningModeRef.current;
      if (mode === 'idle') {
        stopContinuousLoop();
        return;
      }

      const elapsedRounded = Math.max(
        0,
        Math.round(nowMs() - runStartPerfRef.current),
      );
      const opTimes = opTimesRef.current;
      const avg = mean(opTimes);
      const max = opTimes.length > 0 ? Math.max(...opTimes) : 0;
      const scenarioName = `dashboard_continuous_${selectedSize}_${selectedIntervalMs}ms`;

      stopContinuousLoop();

      const endedAtIso = new Date().toISOString();
      sharedBenchmarkLogger.addRun({
        startedAt: runStartedAtIsoRef.current || endedAtIso,
        endedAt: endedAtIso,
        mode: mode === 'js' ? 'js' : 'native',
        benchmarkCategory: 'dashboard_continuous',
        scenarioName,
        intervalMs: selectedIntervalMs,
        durationMs: elapsedRounded,
        operationCount: operationCountRef.current,
        finalCrdtValue: 0,
        averageOperationTimeMs: avg,
        maxOperationTimeMs: max,
        burstSize: 0,
        burstMergeTimeMs: 0,
        notes:
          `${
            reason === 'manual'
              ? 'Manual stop before 60s; exclude from official data. '
              : ''
          }` +
          `Continuous dashboard-derived workload over ${selectedSize} telemetry points with UI updates every ${selectedIntervalMs}ms`,
      });
      setSavedRunsCount(sharedBenchmarkLogger.getRuns().length);
    },
    [selectedIntervalMs, selectedSize, stopContinuousLoop],
  );

  const stopAndLogUiStressRun = useCallback(
    (reason: 'manual' | 'auto' = 'manual') => {
      const mode = stressModeRef.current;
      if (mode === 'idle') {
        stopUiStressLoop();
        return;
      }

      const durationMs = Math.max(
        0,
        Math.round(nowMs() - stressRunStartPerfRef.current),
      );
      const avg = mean(stressOpTimesRef.current);
      const max =
        stressOpTimesRef.current.length > 0
          ? Math.max(...stressOpTimesRef.current)
          : 0;

      stopUiStressLoop();

      const endedAtIso = new Date().toISOString();
      sharedBenchmarkLogger.addRun({
        startedAt: stressRunStartedAtIsoRef.current || endedAtIso,
        endedAt: endedAtIso,
        mode,
        benchmarkCategory: 'ui_rendering_stress',
        scenarioName: 'ui_rendering_stress_10000_20ms',
        intervalMs: UI_STRESS_INTERVAL_MS,
        durationMs,
        operationCount: stressOperationCountRef.current,
        finalCrdtValue: 0,
        averageOperationTimeMs: avg,
        maxOperationTimeMs: max,
        burstSize: 0,
        burstMergeTimeMs: 0,
        notes:
          `${
            reason === 'manual'
              ? 'Manual stop before 60s; exclude from official data. '
              : ''
          }` +
          'Exploratory UI rendering stress workload with heavy React Native view updates',
      });
      setSavedRunsCount(sharedBenchmarkLogger.getRuns().length);
    },
    [stopUiStressLoop],
  );

  const startContinuous = useCallback(
    (mode: Exclude<ContinuousMode, 'idle'>) => {
      if (isAnyRunning) {
        return;
      }

      stopContinuousLoop();
      resetContinuousMetrics();
      setStatusMessage('');
      setResult(null);
      setLastMode(mode);

      runningModeRef.current = mode;
      setContinuousMode(mode);
      runStartPerfRef.current = nowMs();
      runStartedAtIsoRef.current = new Date().toISOString();

      clearAutoStopTimer();
      autoStopTimerRef.current = setTimeout(() => {
        stopAndLogContinuousRun('auto');
      }, BENCHMARK_DURATION_MS);

      const tickFn = async () => {
        if (runningModeRef.current !== mode) {
          return;
        }
        try {
          const t0 = nowMs();
          const r =
            mode === 'native'
              ? await NativeCRDT.runDashboardComputation(selectedSize)
              : runDashboardComputation(selectedSize);
          const t1 = nowMs();

          const opMs = t1 - t0;
          opTimesRef.current.push(opMs);

          setResult(r);
          setLastMode(mode);

          const elapsed = nowMs() - runStartPerfRef.current;
          setElapsedMs(elapsed);
          setRemainingMs(Math.max(0, BENCHMARK_DURATION_MS - elapsed));

          operationCountRef.current += 1;
          setOperationCount(operationCountRef.current);

          const avg = mean(opTimesRef.current);
          const max = Math.max(...opTimesRef.current);
          setAvgOpMs(avg);
          setMaxOpMs(max);
        } catch (error: any) {
          setStatusMessage(`Run failed: ${String(error?.message ?? error)}`);
          stopContinuousLoop();
        }
      };

      scheduleNextTick(selectedIntervalMs, tickFn);
    },
    [
      clearAutoStopTimer,
      isAnyRunning,
      resetContinuousMetrics,
      scheduleNextTick,
      selectedIntervalMs,
      selectedSize,
      stopAndLogContinuousRun,
      stopContinuousLoop,
    ],
  );

  const startUiStress = useCallback(
    (mode: Exclude<UiStressMode, 'idle'>) => {
      if (isAnyRunning) {
        return;
      }

      stopUiStressLoop();
      resetUiStressMetrics();
      setStressStatusMessage('');
      setStressResult(null);
      setStressVisuals({
        cardValues: new Array(UI_STRESS_CARD_COUNT).fill(0),
        chartValues: new Array(UI_STRESS_BAR_COUNT).fill(0),
        gridValues: new Array(UI_STRESS_GRID_COUNT).fill(0),
      });

      stressModeRef.current = mode;
      setStressMode(mode);
      stressRunStartPerfRef.current = nowMs();
      stressRunStartedAtIsoRef.current = new Date().toISOString();

      clearStressAutoStopTimer();
      stressAutoStopTimerRef.current = setTimeout(() => {
        stopAndLogUiStressRun('auto');
      }, BENCHMARK_DURATION_MS);

      const tickFn = async () => {
        if (stressModeRef.current !== mode) {
          return;
        }
        try {
          const t0 = nowMs();
          const computed =
            mode === 'native'
              ? await NativeCRDT.runDashboardComputation(UI_STRESS_SIZE)
              : runDashboardComputation(UI_STRESS_SIZE);
          const t1 = nowMs();
          const opMs = t1 - t0;
          stressOpTimesRef.current.push(opMs);

          const nextCount = stressOperationCountRef.current + 1;
          stressOperationCountRef.current = nextCount;

          setStressResult(computed);
          setStressVisuals(createStressVisualState(computed, nextCount));
          setStressOperationCount(nextCount);

          const elapsed = nowMs() - stressRunStartPerfRef.current;
          setStressElapsedMs(elapsed);
          setStressRemainingMs(Math.max(0, BENCHMARK_DURATION_MS - elapsed));
          setStressAvgOpMs(mean(stressOpTimesRef.current));
          setStressMaxOpMs(Math.max(...stressOpTimesRef.current));
        } catch (error: any) {
          setStressStatusMessage(
            `UI stress failed: ${String(error?.message ?? error)}`,
          );
          stopUiStressLoop();
        }
      };

      stressTickTimerRef.current = setTimeout(function runTick() {
        if (stressModeRef.current === 'idle') {
          return;
        }
        if (stressTickInFlightRef.current) {
          stressTickTimerRef.current = setTimeout(
            runTick,
            UI_STRESS_INTERVAL_MS,
          );
          return;
        }
        stressTickInFlightRef.current = true;
        Promise.resolve(tickFn()).finally(() => {
          stressTickInFlightRef.current = false;
          stressTickTimerRef.current = setTimeout(
            runTick,
            UI_STRESS_INTERVAL_MS,
          );
        });
      }, UI_STRESS_INTERVAL_MS);
    },
    [
      clearStressAutoStopTimer,
      isAnyRunning,
      resetUiStressMetrics,
      stopAndLogUiStressRun,
      stopUiStressLoop,
    ],
  );

  const resetAll = useCallback(() => {
    stopContinuousLoop();
    resetContinuousMetrics();
    setResult(null);
    setLastMode(null);
    setStatusMessage('');
  }, [resetContinuousMetrics, stopContinuousLoop]);

  const resetUiStress = useCallback(() => {
    stopUiStressLoop();
    resetUiStressMetrics();
    setStressResult(null);
    setStressStatusMessage('');
    setStressVisuals({
      cardValues: new Array(UI_STRESS_CARD_COUNT).fill(0),
      chartValues: new Array(UI_STRESS_BAR_COUNT).fill(0),
      gridValues: new Array(UI_STRESS_GRID_COUNT).fill(0),
    });
  }, [resetUiStressMetrics, stopUiStressLoop]);

  useEffect(() => {
    return () => {
      stopContinuousLoop();
      stopUiStressLoop();
    };
  }, [stopContinuousLoop, stopUiStressLoop]);

  const chartBars = useMemo(() => {
    const values = result?.normalizedValues ?? [];
    return resample(values, CHART_BAR_COUNT);
  }, [result]);

  const sparkBars = useMemo(() => {
    const values = result?.normalizedValues ?? [];
    return resample(values, SPARK_BAR_COUNT);
  }, [result]);

  const clearResults = useCallback(() => {
    sharedBenchmarkLogger.clear();
    setSavedRunsCount(0);
  }, []);

  const exportCSV = useCallback(async () => {
    const csv = sharedBenchmarkLogger.exportToCSV();
    try {
      await CSVExport.exportCSV(csv, 'benchmark-results.csv');
      setStatusMessage('CSV exported successfully');
    } catch (e: any) {
      setStatusMessage(`Export failed: ${String(e?.message ?? e)}`);
    }
  }, []);

  const displayModeLabel = useMemo(() => {
    if (continuousMode !== 'idle') {
      return continuousMode.toUpperCase();
    }
    if (lastMode) {
      return lastMode.toUpperCase();
    }
    return '—';
  }, [continuousMode, lastMode]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Dashboard Workload</Text>
        <Text style={styles.note}>Saved runs: {savedRunsCount}</Text>
        <Text style={styles.note}>
          Evaluates JS and Swift execution under repeated dashboard-derived
          computation and high-frequency UI refreshes.
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Evaluation Settings</Text>
          <Text style={styles.note}>Workload size</Text>
          <Segment
            options={sizeOptions}
            selected={selectedSize}
            onSelect={setSelectedSize}
            labelFn={formatSizeLabel}
          />
          <Text style={styles.note}>Update interval</Text>
          <Segment
            options={intervalOptions}
            selected={selectedIntervalMs}
            onSelect={setSelectedIntervalMs}
            labelFn={formatIntervalLabel}
          />
          <Text style={styles.note}>
            Official evaluation scenarios: 5000 at 20ms, 10000 at 50ms, and
            10000 at 20ms. Repeat each scenario at least 5 times per mode.
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Run Control</Text>
          <Text style={styles.note}>
            Each run lasts 60 seconds and writes one CSV row on completion.
            Manual stop is available for non-official checks only.
          </Text>
          <View style={styles.row}>
            <Button
              title="Start JS Dashboard"
              onPress={() => startContinuous('js')}
              disabled={isAnyRunning}
              kind="primary"
            />
            <Button
              title="Start Native Dashboard"
              onPress={() => startContinuous('native')}
              disabled={isAnyRunning}
              kind="primary"
              textStyle={styles.buttonTextXSmall}
              textNumberOfLines={1}
              textAdjustsFontSizeToFit
              textMinimumFontScale={0.8}
            />
            <Button
              title="Stop"
              onPress={() => stopAndLogContinuousRun('manual')}
              disabled={!isContinuousRunning}
              kind="danger"
            />
            <Button
              title="Reset"
              onPress={resetAll}
              disabled={!isContinuousRunning && !result}
              kind="secondary"
            />
          </View>
          {statusMessage.length > 0 ? (
            <Text style={styles.warning}>{statusMessage}</Text>
          ) : null}
          <Text style={styles.note}>
            Remaining: {formatNumber(remainingMs / 1000, 1)}s • Elapsed:{' '}
            {formatNumber(elapsedMs / 1000, 1)}s
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Dashboard Preview</Text>
          <Text style={styles.note}>
            Metric cards and lightweight charts update on every tick during the
            benchmark run. Values are synthetic derived workload signals;
            negative values are expected and do not indicate CRDT counter
            values.
          </Text>
          <View style={styles.cardsGrid}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Average Signal</Text>
              <Text style={styles.cardValue}>
                {result ? formatNumber(result.average, 4) : '—'}
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Min Signal</Text>
              <Text style={styles.cardValue}>
                {result ? formatNumber(result.min, 4) : '—'}
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Max Signal</Text>
              <Text style={styles.cardValue}>
                {result ? formatNumber(result.max, 4) : '—'}
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Trend Coefficient</Text>
              <Text style={styles.cardValue}>
                {result ? formatNumber(result.trend, 6) : '—'}
              </Text>
            </View>
          </View>

          <View style={styles.chartBars}>
            {chartBars.map((v, idx) => (
              <View
                key={`bar-${idx}`}
                style={[
                  styles.bar,
                  {height: 8 + Math.round(Math.max(0, Math.min(1, v)) * 120)},
                ]}
              />
            ))}
          </View>

          <View style={styles.sparkline}>
            {sparkBars.map((v, idx) => (
              <View
                key={`spark-${idx}`}
                style={[
                  styles.sparkBar,
                  {height: 4 + Math.round(Math.max(0, Math.min(1, v)) * 32)},
                ]}
              />
            ))}
          </View>

          {result ? (
            <View style={styles.grid}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Mode</Text>
                <Text style={styles.metricValue}>{displayModeLabel}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Interval</Text>
                <Text style={styles.metricValue}>{selectedIntervalMs}ms</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Workload</Text>
                <Text style={styles.metricValue}>{selectedSize}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Operation count</Text>
                <Text style={styles.metricValue}>{operationCount}</Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Avg op time</Text>
                <Text style={styles.metricValue}>
                  {formatNumber(avgOpMs, 3)} ms
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Max op time</Text>
                <Text style={styles.metricValue}>
                  {formatNumber(maxOpMs, 3)} ms
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Checksum</Text>
                <Text style={styles.metricValue}>{result.checksum}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.note}>
              Start a JS or Native dashboard run to populate the preview and
              metrics.
            </Text>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Results</Text>
          <View style={styles.row}>
            <Button
              title="Clear Results"
              onPress={clearResults}
              disabled={savedRunsCount === 0 || isAnyRunning}
              kind="secondary"
            />
            <Button
              title="Export CSV"
              onPress={() => {
                exportCSV().catch(() => {});
              }}
              disabled={savedRunsCount === 0 || isAnyRunning}
              kind="secondary"
            />
          </View>
          <Text style={styles.note}>
            Dashboard-derived workload runs share the same CSV export as the
            CRDT benchmark runs.
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>UI Rendering Stress Benchmark</Text>
          <Text style={styles.note}>
            Exploratory only. This section is not part of the official
            dashboard-derived workload evaluation unless selected later.
          </Text>
          <Text style={styles.note}>
            Fixed configuration: workload size 10000, interval 20ms, duration 60
            seconds.
          </Text>
          <View style={styles.row}>
            <Button
              title="Start JS UI Stress"
              onPress={() => startUiStress('js')}
              disabled={isAnyRunning}
              kind="primary"
            />
            <Button
              title="Start Native UI Stress"
              onPress={() => startUiStress('native')}
              disabled={isAnyRunning}
              kind="primary"
              textStyle={styles.buttonTextXSmall}
              textNumberOfLines={1}
              textAdjustsFontSizeToFit
              textMinimumFontScale={0.8}
            />
            <Button
              title="Stop"
              onPress={() => stopAndLogUiStressRun('manual')}
              disabled={!isUiStressRunning}
              kind="danger"
            />
            <Button
              title="Reset"
              onPress={resetUiStress}
              disabled={!isUiStressRunning && !stressResult}
              kind="secondary"
            />
            <Button
              title="Export CSV"
              onPress={() => {
                exportCSV().catch(() => {});
              }}
              disabled={savedRunsCount === 0 || isAnyRunning}
              kind="secondary"
            />
          </View>
          {stressStatusMessage.length > 0 ? (
            <Text style={styles.warning}>{stressStatusMessage}</Text>
          ) : null}
          <Text style={styles.note}>
            Remaining: {formatNumber(stressRemainingMs / 1000, 1)}s • Elapsed:{' '}
            {formatNumber(stressElapsedMs / 1000, 1)}s
          </Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>CSV category</Text>
            <Text style={styles.metricValue}>ui_rendering_stress</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Scenario name</Text>
            <Text style={styles.metricValue}>
              ui_rendering_stress_10000_20ms
            </Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>UI Stress Preview</Text>
          <Text style={styles.note}>
            Heavy visual tree with 100 tiles, 300 bars, and a changing value
            grid to inspect whether rendering dominates over computation.
          </Text>
          <View style={styles.stressMetricsRow}>
            <View style={styles.stressMetricBox}>
              <Text style={styles.cardLabel}>Mode</Text>
              <Text style={styles.cardValue}>
                {stressMode !== 'idle' ? stressMode.toUpperCase() : '—'}
              </Text>
            </View>
            <View style={styles.stressMetricBox}>
              <Text style={styles.cardLabel}>Operations</Text>
              <Text style={styles.cardValue}>{stressOperationCount}</Text>
            </View>
            <View style={styles.stressMetricBox}>
              <Text style={styles.cardLabel}>Avg op</Text>
              <Text style={styles.cardValue}>
                {formatNumber(stressAvgOpMs, 3)}
              </Text>
            </View>
            <View style={styles.stressMetricBox}>
              <Text style={styles.cardLabel}>Max op</Text>
              <Text style={styles.cardValue}>
                {formatNumber(stressMaxOpMs, 3)}
              </Text>
            </View>
          </View>
          <View style={styles.stressCardsGrid}>
            {stressVisuals.cardValues.map((value, index) => (
              <View key={`stress-card-${index}`} style={styles.stressCard}>
                <Text style={styles.stressCardLabel}>Tile {index + 1}</Text>
                <Text style={styles.stressCardValue}>
                  {formatNumber(value * 100, 1)}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.stressChart}>
            {stressVisuals.chartValues.map((value, index) => (
              <View
                key={`stress-bar-${index}`}
                style={[styles.stressBar, {height: 6 + Math.round(value * 84)}]}
              />
            ))}
          </View>
          <View style={styles.stressGrid}>
            {stressVisuals.gridValues.map((value, index) => (
              <View key={`stress-grid-${index}`} style={styles.stressGridCell}>
                <Text style={styles.stressGridText}>
                  {formatNumber(value * 1000, 0)}
                </Text>
              </View>
            ))}
          </View>
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
  note: {
    fontSize: 12,
    color: '#333',
    lineHeight: 16,
  },
  warning: {
    fontSize: 12,
    color: '#b00020',
    fontWeight: '600',
  },
  block: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.02)',
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
    gap: 8,
  },
  segment: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  segmentItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  segmentItemSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  segmentItemPressed: {
    opacity: 0.85,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111',
  },
  segmentTextSelected: {
    color: '#fff',
  },
  button: {
    paddingVertical: 10,
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
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  buttonTextXSmall: {
    fontSize: 10,
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
  chartBars: {
    height: 140,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(0,0,0,0.04)',
    paddingHorizontal: 6,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bar: {
    width: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(17,17,17,0.65)',
  },
  sparkline: {
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sparkBar: {
    width: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(17,17,17,0.35)',
  },
  grid: {
    gap: 6,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricLabel: {
    fontSize: 12,
    color: '#333',
  },
  metricValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    color: '#111',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flexGrow: 1,
    flexBasis: '48%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    gap: 6,
  },
  cardLabel: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
  },
  cardValue: {
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    color: '#111',
    fontWeight: '700',
  },
  stressMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  stressMetricBox: {
    flexGrow: 1,
    flexBasis: '47%',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    gap: 6,
  },
  stressCardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stressCard: {
    width: '18%',
    minWidth: 56,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    gap: 4,
  },
  stressCardLabel: {
    fontSize: 9,
    color: '#555',
  },
  stressCardValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
  stressChart: {
    height: 94,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.16)',
    backgroundColor: 'rgba(0,0,0,0.03)',
    paddingHorizontal: 4,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  stressBar: {
    width: 1,
    borderRadius: 1,
    backgroundColor: '#111',
  },
  stressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stressGridCell: {
    width: '15%',
    minWidth: 40,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  stressGridText: {
    fontSize: 10,
    textAlign: 'center',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
});
