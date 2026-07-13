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

import {runDashboardComputation} from '../dashboard/js/dashboardComputation';
import type {DashboardComputationResult} from '../dashboard/types';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import type {BenchmarkRun} from '../metrics/types';
import {CSVExport} from '../native/CSVExport';
import {NativeCRDT} from '../native/NativeCRDT';

type WorkloadSize = 1000 | 5000 | 10000;
type IntervalOption = 100 | 50 | 20;
type RunMode = 'idle' | 'js' | 'native';

const BENCHMARK_DURATION_MS = 60_000;
const PREVIEW_BAR_COUNT = 60;
const PREVIEW_SPARK_COUNT = 40;

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

function formatNumber(value: number, fractionDigits: number = 2): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(fractionDigits);
}

function formatSizeLabel(value: WorkloadSize): string {
  return `${value}`;
}

function formatIntervalLabel(value: IntervalOption): string {
  return `${value}ms`;
}

function resample(values: number[], sampleSize: number): number[] {
  const count = Math.max(0, Math.floor(sampleSize));
  if (values.length === 0 || count === 0) {
    return [];
  }
  if (values.length <= count) {
    return [...values];
  }

  const result: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const progress = count === 1 ? 0 : index / (count - 1);
    const sourceIndex = Math.min(
      values.length - 1,
      Math.round(progress * (values.length - 1)),
    );
    result.push(values[sourceIndex]);
  }
  return result;
}

function getDashboardRuns(): BenchmarkRun[] {
  return sharedBenchmarkLogger
    .getRuns()
    .filter(run => run.benchmarkCategory === 'dashboard_continuous');
}

function fireAndForget(task: Promise<unknown>): void {
  task.catch(() => {});
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
      {options.map(option => {
        const isSelected = option === selected;
        return (
          <Pressable
            key={String(option)}
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
              {labelFn(option)}
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
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <Text
        style={[
          styles.buttonText,
          kind === 'secondary' && styles.buttonTextSecondary,
        ]}>
        {title}
      </Text>
    </Pressable>
  );
}

function MetricRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

export function DashboardBenchmarkScreen(): React.JSX.Element {
  const sizeOptions = useMemo<WorkloadSize[]>(() => [1000, 5000, 10000], []);
  const intervalOptions = useMemo<IntervalOption[]>(() => [100, 50, 20], []);

  const [selectedSize, setSelectedSize] = useState<WorkloadSize>(5000);
  const [selectedIntervalMs, setSelectedIntervalMs] =
    useState<IntervalOption>(20);
  const [savedRunsCount, setSavedRunsCount] = useState(
    getDashboardRuns().length,
  );
  const [mode, setMode] = useState<RunMode>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [result, setResult] = useState<DashboardComputationResult | null>(null);
  const [lastMode, setLastMode] = useState<'js' | 'native' | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(BENCHMARK_DURATION_MS);
  const [operationCount, setOperationCount] = useState(0);
  const [avgOpMs, setAvgOpMs] = useState(0);
  const [maxOpMs, setMaxOpMs] = useState(0);

  const tickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningModeRef = useRef<RunMode>('idle');
  const startedAtRef = useRef('');
  const runStartPerfRef = useRef(0);
  const operationTimesRef = useRef<number[]>([]);
  const operationCountRef = useRef(0);
  const latestResultRef = useRef<DashboardComputationResult | null>(null);

  const isRunning = mode !== 'idle';
  const previewBars = useMemo(
    () => resample(result?.normalizedValues ?? [], PREVIEW_BAR_COUNT),
    [result],
  );
  const previewSpark = useMemo(
    () => resample(result?.normalizedValues ?? [], PREVIEW_SPARK_COUNT),
    [result],
  );

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
    clearTickTimer();
    clearAutoStopTimer();
    setMode('idle');
  }, [clearAutoStopTimer, clearTickTimer]);

  const resetState = useCallback(() => {
    stopLoop();
    setElapsedMs(0);
    setRemainingMs(BENCHMARK_DURATION_MS);
    setOperationCount(0);
    setAvgOpMs(0);
    setMaxOpMs(0);
    setResult(null);
    setLastMode(null);
    setStatusMessage('');
    latestResultRef.current = null;
    startedAtRef.current = '';
    runStartPerfRef.current = 0;
    operationTimesRef.current = [];
    operationCountRef.current = 0;
  }, [stopLoop]);

  const stopAndLogRun = useCallback(
    (reason: 'manual' | 'auto') => {
      if (runningModeRef.current === 'idle') {
        stopLoop();
        return;
      }

      const completedMode = runningModeRef.current;
      stopLoop();

      if (startedAtRef.current && latestResultRef.current) {
        sharedBenchmarkLogger.addRun({
          startedAt: startedAtRef.current,
          endedAt: new Date().toISOString(),
          mode: completedMode,
          benchmarkCategory: 'dashboard_continuous',
          scenarioName: `dashboard_continuous_${selectedSize}_${selectedIntervalMs}ms`,
          intervalMs: selectedIntervalMs,
          durationMs: elapsedMs,
          operationCount,
          finalCrdtValue: Math.round(latestResultRef.current.checksum),
          averageOperationTimeMs: avgOpMs,
          maxOperationTimeMs: maxOpMs,
          burstSize: 0,
          burstMergeTimeMs: 0,
          notes:
            reason === 'manual'
              ? 'Manual stop before 60s; exclude from official data'
              : 'Completed full 60s dashboard workload benchmark',
        });
        setSavedRunsCount(getDashboardRuns().length);
      }

      setStatusMessage(
        reason === 'manual'
          ? 'Dashboard run stopped before 60 seconds.'
          : 'Dashboard run completed and logged.',
      );
    },
    [avgOpMs, elapsedMs, maxOpMs, operationCount, selectedIntervalMs, selectedSize, stopLoop],
  );

  const computeTick = useCallback(
    async (runMode: 'js' | 'native') => {
      if (runMode === 'native') {
        return NativeCRDT.runDashboardComputation(selectedSize);
      }
      return runDashboardComputation(selectedSize);
    },
    [selectedSize],
  );

  const startBenchmark = useCallback(
    async (runMode: 'js' | 'native') => {
      if (runningModeRef.current !== 'idle') {
        return;
      }

      setStatusMessage('');
      setResult(null);
      setLastMode(runMode);
      setMode(runMode);
      setElapsedMs(0);
      setRemainingMs(BENCHMARK_DURATION_MS);
      setOperationCount(0);
      setAvgOpMs(0);
      setMaxOpMs(0);
      startedAtRef.current = new Date().toISOString();
      runStartPerfRef.current = nowMs();
      operationTimesRef.current = [];
      operationCountRef.current = 0;
      latestResultRef.current = null;
      runningModeRef.current = runMode;

      const tick = async () => {
        if (runningModeRef.current !== runMode) {
          return;
        }

        try {
          const operationStartedAt = nowMs();
          const nextResult = await computeTick(runMode);
          const operationDuration = nowMs() - operationStartedAt;
          operationTimesRef.current.push(operationDuration);
          operationCountRef.current += 1;

          latestResultRef.current = nextResult;
          setResult(nextResult);
          setElapsedMs(nowMs() - runStartPerfRef.current);
          setRemainingMs(
            Math.max(0, BENCHMARK_DURATION_MS - (nowMs() - runStartPerfRef.current)),
          );
          setOperationCount(operationCountRef.current);
          setAvgOpMs(mean(operationTimesRef.current));
          setMaxOpMs(Math.max(...operationTimesRef.current));

          if (runningModeRef.current === runMode) {
            tickTimerRef.current = setTimeout(tick, selectedIntervalMs);
          }
        } catch (error: any) {
          stopLoop();
          setStatusMessage(
            `Dashboard run failed: ${String(error?.message ?? error)}`,
          );
        }
      };

      autoStopTimerRef.current = setTimeout(() => {
        stopAndLogRun('auto');
      }, BENCHMARK_DURATION_MS);

      fireAndForget(tick());
    },
    [computeTick, selectedIntervalMs, stopAndLogRun, stopLoop],
  );

  const clearResults = useCallback(() => {
    const removedCount = sharedBenchmarkLogger.removeRuns(
      run => run.benchmarkCategory === 'dashboard_continuous',
    );
    setSavedRunsCount(getDashboardRuns().length);
    setStatusMessage(
      removedCount > 0
        ? 'Dashboard results cleared.'
        : 'No dashboard results were stored.',
    );
  }, []);

  const exportCSV = useCallback(async () => {
    const runs = getDashboardRuns();
    if (runs.length === 0) {
      setStatusMessage('No dashboard runs to export.');
      return;
    }

    try {
      await CSVExport.exportCSV(
        sharedBenchmarkLogger.exportRunsToCSV(runs),
        'benchmark-results.csv',
      );
      setStatusMessage('Dashboard CSV exported.');
    } catch (error: any) {
      setStatusMessage(`CSV export failed: ${String(error?.message ?? error)}`);
    }
  }, []);

  const copyCSV = useCallback(async () => {
    const runs = getDashboardRuns();
    if (runs.length === 0) {
      setStatusMessage('No dashboard runs to copy.');
      return;
    }

    try {
      await CSVExport.copyToClipboard(sharedBenchmarkLogger.exportRunsToCSV(runs));
      setStatusMessage('Dashboard CSV copied.');
    } catch (error: any) {
      setStatusMessage(`Copy failed: ${String(error?.message ?? error)}`);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopLoop();
    };
  }, [stopLoop]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Dashboard Workload Benchmark</Text>
        <Text style={styles.subheader}>Saved runs: {savedRunsCount}</Text>
        <Text style={styles.note}>
          This workload is synthetic but deterministic. It models repeated
          dashboard-style derived computation under UI update pressure so JS and
          native execution can be compared under the same inputs.
        </Text>
        {isRunning ? (
          <Text style={styles.subheader}>
            Remaining: {(Math.max(0, remainingMs) / 1000).toFixed(1)}s
          </Text>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Workload size</Text>
          <Segment
            options={sizeOptions}
            selected={selectedSize}
            onSelect={value => {
              if (isRunning) {
                Alert.alert(
                  'Stop first',
                  'Stop the current benchmark before changing workload size or update interval.',
                );
                return;
              }
              setSelectedSize(value);
            }}
            labelFn={formatSizeLabel}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Update interval</Text>
          <Segment
            options={intervalOptions}
            selected={selectedIntervalMs}
            onSelect={value => {
              if (isRunning) {
                Alert.alert(
                  'Stop first',
                  'Stop the current benchmark before changing workload size or update interval.',
                );
                return;
              }
              setSelectedIntervalMs(value);
            }}
            labelFn={formatIntervalLabel}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Controls</Text>
          <View style={styles.buttonRow}>
            <Button
              title="Start JS Dashboard"
              onPress={() => fireAndForget(startBenchmark('js'))}
              disabled={isRunning}
            />
            <Button
              title="Start Native Dashboard"
              onPress={() => fireAndForget(startBenchmark('native'))}
              disabled={isRunning}
            />
          </View>
          <View style={styles.buttonRow}>
            <Button
              title="Stop"
              onPress={() => stopAndLogRun('manual')}
              disabled={!isRunning}
              kind="danger"
              layout="full"
            />
          </View>
          <View style={styles.buttonRow}>
            <Button title="Reset" onPress={resetState} kind="secondary" />
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
          <Text style={styles.blockTitle}>Metrics</Text>
          <MetricRow label="Mode" value={mode === 'idle' ? lastMode ?? 'idle' : mode} />
          <MetricRow label="Elapsed" value={`${(elapsedMs / 1000).toFixed(1)}s`} />
          <MetricRow label="Operations" value={String(operationCount)} />
          <MetricRow label="Average op" value={`${formatNumber(avgOpMs, 3)}ms`} />
          <MetricRow label="Max op" value={`${formatNumber(maxOpMs, 3)}ms`} />
          <MetricRow label="CSV category" value="dashboard_continuous" />
          <MetricRow
            label="Scenario name"
            value={`dashboard_continuous_${selectedSize}_${selectedIntervalMs}ms`}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Preview</Text>
          <Text style={styles.note}>
            Dashboard metrics are deterministic derived workload signals. They are
            synthetic benchmark outputs rather than application business data.
          </Text>
          {result ? (
            <>
              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <Text style={styles.metricCardLabel}>Average</Text>
                  <Text style={styles.metricCardValue}>{formatNumber(result.average)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricCardLabel}>Min</Text>
                  <Text style={styles.metricCardValue}>{formatNumber(result.min)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricCardLabel}>Max</Text>
                  <Text style={styles.metricCardValue}>{formatNumber(result.max)}</Text>
                </View>
                <View style={styles.metricCard}>
                  <Text style={styles.metricCardLabel}>Trend</Text>
                  <Text style={styles.metricCardValue}>{formatNumber(result.trend)}</Text>
                </View>
              </View>
              <Text style={styles.metricChecksum}>
                Checksum: {formatNumber(result.checksum, 4)}
              </Text>
              <View style={styles.previewBars}>
                {previewBars.map((value, index) => (
                  <View
                    key={`bar-${index}`}
                    style={[
                      styles.previewBar,
                      {height: 20 + Math.max(0, value) * 72},
                    ]}
                  />
                ))}
              </View>
              <View style={styles.sparkRow}>
                {previewSpark.map((value, index) => (
                  <View
                    key={`spark-${index}`}
                    style={[
                      styles.sparkBar,
                      {height: 8 + Math.max(0, value) * 22},
                    ]}
                  />
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.note}>
              Run a dashboard scenario to populate the deterministic preview.
            </Text>
          )}
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
  buttonSecondary: {backgroundColor: '#ededed'},
  buttonDanger: {backgroundColor: '#b00020'},
  buttonDisabled: {opacity: 0.4},
  buttonPressed: {opacity: 0.86},
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  buttonTextSecondary: {color: '#111'},
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
  segmentItemSelected: {backgroundColor: '#111', borderColor: '#111'},
  segmentItemPressed: {opacity: 0.9},
  segmentText: {fontSize: 14, fontWeight: '700', color: '#111'},
  segmentTextSelected: {color: '#fff'},
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metricLabel: {fontSize: 14, color: '#555', fontWeight: '600'},
  metricValue: {fontSize: 14, color: '#111', fontWeight: '700', flexShrink: 1},
  metricGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  metricCard: {
    width: '47%',
    minHeight: 78,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.04)',
    padding: 12,
    justifyContent: 'space-between',
  },
  metricCardLabel: {fontSize: 12, color: '#555', fontWeight: '700'},
  metricCardValue: {fontSize: 22, color: '#111', fontWeight: '800'},
  metricChecksum: {fontSize: 13, color: '#444', fontWeight: '600'},
  previewBars: {
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  previewBar: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: '#111',
    minWidth: 3,
  },
  sparkRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  sparkBar: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: '#d0d0d0',
    minWidth: 4,
  },
});
