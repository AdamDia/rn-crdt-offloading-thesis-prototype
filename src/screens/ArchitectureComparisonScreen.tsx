import React, {useCallback, useMemo, useState} from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {GCounter} from '../crdt/js/GCounter';
import type {GCounterState} from '../crdt/js/types';
import {sharedBenchmarkLogger} from '../metrics/sharedLogger';
import type {BenchmarkMode, BenchmarkRun} from '../metrics/types';
import {CSVExport} from '../native/CSVExport';
import {NativeCRDT} from '../native/NativeCRDT';
import {TurboCRDT} from '../native/TurboCRDT';

type Architecture = 'js' | 'classic_bridge' | 'turbo_module';
type ScenarioKind = 'increment' | 'burst';
type ScenarioSize = 1000 | 5000 | 10000;

type ComparisonResult = {
  id: string;
  scenarioName: string;
  architecture: Architecture;
  kind: ScenarioKind;
  size: ScenarioSize;
  operationCount: number;
  burstSize: number;
  totalTimeMs: number;
  averageOperationTimeMs: number;
  maxOperationTimeMs: number;
  finalValue: number;
  notes: string;
  error?: string;
};

const SCENARIO_SIZES: ScenarioSize[] = [1000, 5000, 10000];

function nowMs(): number {
  const p = (globalThis as any).performance;
  if (p && typeof p.now === 'function') {
    return p.now();
  }
  return Date.now();
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(3)} ms`;
}

function createRemoteState(size: ScenarioSize): GCounterState {
  const state: GCounterState = {};
  for (let i = 0; i < size; i += 1) {
    state[`remote-${i}`] = 1;
  }
  return state;
}

function architectureLabel(architecture: Architecture): string {
  switch (architecture) {
    case 'js':
      return 'JavaScript';
    case 'classic_bridge':
      return 'Classic Bridge';
    case 'turbo_module':
      return 'TurboModule';
  }
}

function createResultId(): string {
  return `architecture_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getArchitectureRuns(): BenchmarkRun[] {
  return sharedBenchmarkLogger
    .getRuns()
    .filter(run => run.benchmarkCategory === 'architecture_comparison');
}

export function ArchitectureComparisonScreen(): React.JSX.Element {
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [runningLabel, setRunningLabel] = useState<string | null>(null);
  const [savedRunsCount, setSavedRunsCount] = useState(
    getArchitectureRuns().length,
  );
  const [statusMessage, setStatusMessage] = useState(
    'Run one scenario at a time to compare per-call overhead and burst batching.',
  );

  const isRunning = runningLabel !== null;

  const recordRun = useCallback((result: ComparisonResult) => {
    const now = new Date().toISOString();
    sharedBenchmarkLogger.addRun({
      startedAt: now,
      endedAt: now,
      mode: result.architecture as BenchmarkMode,
      benchmarkCategory: 'architecture_comparison',
      scenarioName: result.scenarioName,
      intervalMs: 0,
      durationMs: result.totalTimeMs,
      operationCount: result.operationCount,
      finalCrdtValue: result.finalValue,
      averageOperationTimeMs: result.averageOperationTimeMs,
      maxOperationTimeMs: result.maxOperationTimeMs,
      burstSize: result.burstSize,
      burstMergeTimeMs: result.kind === 'burst' ? result.totalTimeMs : 0,
      notes: result.notes,
    });
    setSavedRunsCount(getArchitectureRuns().length);
  }, []);

  const runScenario = useCallback(
    async (architecture: Architecture, kind: ScenarioKind, size: ScenarioSize) => {
      const scenarioName =
        kind === 'increment'
          ? `architecture_increment_${size}`
          : `architecture_burst_${size}`;
      const label = `${architectureLabel(architecture)} ${kind} ${size}`;
      setRunningLabel(label);
      setStatusMessage(`Running ${label}`);

      try {
        let finalValue = 0;
        const start = nowMs();

        if (kind === 'increment') {
          if (architecture === 'js') {
            const counter = new GCounter('device-1');
            for (let i = 0; i < size; i += 1) {
              counter.increment();
            }
            finalValue = counter.value();
          } else if (architecture === 'classic_bridge') {
            await NativeCRDT.reset();
            for (let i = 0; i < size; i += 1) {
              finalValue = await NativeCRDT.increment('device-1');
            }
          } else {
            if (!TurboCRDT.isAvailable()) {
              throw new Error('TurboCRDTModule is unavailable');
            }
            await TurboCRDT.reset();
            for (let i = 0; i < size; i += 1) {
              finalValue = await TurboCRDT.increment('device-1');
            }
          }
        } else {
          const remoteState = createRemoteState(size);
          if (architecture === 'js') {
            const counter = new GCounter('device-1');
            counter.merge(remoteState);
            finalValue = counter.value();
          } else if (architecture === 'classic_bridge') {
            await NativeCRDT.reset();
            finalValue = await NativeCRDT.merge(remoteState);
          } else {
            if (!TurboCRDT.isAvailable()) {
              throw new Error('TurboCRDTModule is unavailable');
            }
            await TurboCRDT.reset();
            finalValue = await TurboCRDT.merge(remoteState);
          }
        }

        const totalTimeMs = nowMs() - start;
        const operationCount = kind === 'increment' ? size : 1;
        const burstSize = kind === 'burst' ? size : 0;
        const result: ComparisonResult = {
          id: createResultId(),
          scenarioName,
          architecture,
          kind,
          size,
          operationCount,
          burstSize,
          totalTimeMs,
          averageOperationTimeMs: totalTimeMs / operationCount,
          maxOperationTimeMs: totalTimeMs,
          finalValue,
          notes:
            kind === 'increment'
              ? `${size} awaited increment operations; native paths include JS-native interop overhead`
              : `One deterministic merge call over ${size} CRDT entries`,
        };

        setResults(previous => [result, ...previous].slice(0, 20));
        recordRun(result);
        setStatusMessage(`${label} completed`);
      } catch (e: any) {
        const message = String(e?.message ?? e);
        const result: ComparisonResult = {
          id: createResultId(),
          scenarioName,
          architecture,
          kind,
          size,
          operationCount: 0,
          burstSize: kind === 'burst' ? size : 0,
          totalTimeMs: 0,
          averageOperationTimeMs: 0,
          maxOperationTimeMs: 0,
          finalValue: 0,
          notes: 'Scenario failed before a benchmark run was logged',
          error: message,
        };
        setResults(previous => [result, ...previous].slice(0, 20));
        setStatusMessage(`${label} failed: ${message}`);
      } finally {
        setRunningLabel(null);
      }
    },
    [recordRun],
  );

  const exportCSV = useCallback(async () => {
    const architectureRuns = getArchitectureRuns();
    if (architectureRuns.length === 0) {
      setStatusMessage('No architecture comparison runs to export');
      return;
    }

    const csv = sharedBenchmarkLogger.exportRunsToCSV(architectureRuns);
    try {
      await CSVExport.exportCSV(csv, 'benchmark-results.csv');
      setStatusMessage('CSV exported successfully');
    } catch (e: any) {
      setStatusMessage(`CSV export failed: ${String(e?.message ?? e)}`);
    }
  }, []);

  const copyCSV = useCallback(async () => {
    const architectureRuns = getArchitectureRuns();
    if (architectureRuns.length === 0) {
      setStatusMessage('No architecture comparison runs to copy');
      return;
    }

    const csv = sharedBenchmarkLogger.exportRunsToCSV(architectureRuns);
    try {
      await CSVExport.copyToClipboard(csv);
      setStatusMessage('CSV copied to clipboard');
    } catch (e: any) {
      setStatusMessage(`Copy failed: ${String(e?.message ?? e)}`);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    const removedCount = sharedBenchmarkLogger.removeRuns(
      run => run.benchmarkCategory === 'architecture_comparison',
    );
    setSavedRunsCount(getArchitectureRuns().length);
    setStatusMessage(
      removedCount > 0
        ? 'Architecture comparison results cleared'
        : 'No architecture comparison runs were stored',
    );
  }, []);

  const incrementButtons = useMemo(
    () =>
      SCENARIO_SIZES.flatMap(size =>
        (['js', 'classic_bridge', 'turbo_module'] as Architecture[]).map(
          architecture => ({architecture, size}),
        ),
      ),
    [],
  );

  const burstButtons = useMemo(
    () =>
      SCENARIO_SIZES.flatMap(size =>
        (['js', 'classic_bridge', 'turbo_module'] as Architecture[]).map(
          architecture => ({architecture, size}),
        ),
      ),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.header}>Architecture Comparison</Text>
        <Text style={styles.note}>Saved runs: {savedRunsCount}</Text>
        <Text style={styles.note}>
          Compare JavaScript, Swift classic bridge, and Swift TurboModule
          execution using the same G-Counter scenarios.
        </Text>
        <Text style={styles.note}>
          Per-operation scenarios measure call overhead directly. Burst
          scenarios measure one batched merge over many entries.
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Per-operation increments</Text>
          <View style={styles.buttonGrid}>
            {incrementButtons.map(({architecture, size}) => (
              <Pressable
                key={`increment-${architecture}-${size}`}
                disabled={isRunning}
                onPress={() => runScenario(architecture, 'increment', size)}
                style={({pressed}) => [
                  styles.button,
                  isRunning && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={styles.buttonText}>
                  {architectureLabel(architecture)} {size}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Burst merge</Text>
          <View style={styles.buttonGrid}>
            {burstButtons.map(({architecture, size}) => (
              <Pressable
                key={`burst-${architecture}-${size}`}
                disabled={isRunning}
                onPress={() => runScenario(architecture, 'burst', size)}
                style={({pressed}) => [
                  styles.button,
                  isRunning && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}>
                <Text style={styles.buttonText}>
                  {architectureLabel(architecture)} burst {size}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Results</Text>
          <Text style={styles.note}>
            {runningLabel ? `Running: ${runningLabel}` : statusMessage}
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              disabled={isRunning}
              onPress={exportCSV}
              style={({pressed}) => [
                styles.secondaryButton,
                isRunning && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.secondaryButtonText}>Export CSV</Text>
            </Pressable>
            <Pressable
              disabled={isRunning}
              onPress={copyCSV}
              style={({pressed}) => [
                styles.secondaryButton,
                isRunning && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.secondaryButtonText}>Copy CSV</Text>
            </Pressable>
            <Pressable
              disabled={isRunning}
              onPress={clearResults}
              style={({pressed}) => [
                styles.secondaryButton,
                isRunning && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.secondaryButtonText}>Clear Results</Text>
            </Pressable>
          </View>

          {results.length === 0 ? (
            <Text style={styles.emptyText}>No architecture results yet.</Text>
          ) : (
            results.map(result => (
              <View key={result.id} style={styles.resultCard}>
                <Text style={styles.resultTitle}>
                  {architectureLabel(result.architecture)} ·{' '}
                  {result.scenarioName}
                </Text>
                {result.error ? (
                  <Text style={styles.errorText}>{result.error}</Text>
                ) : (
                  <>
                    <MetricRow
                      label="Operations / burst size"
                      value={result.size}
                    />
                    <MetricRow
                      label="Operation count"
                      value={result.operationCount}
                    />
                    <MetricRow label="Burst size" value={result.burstSize} />
                    <MetricRow
                      label="Total time"
                      value={formatMs(result.totalTimeMs)}
                    />
                    <MetricRow
                      label="Average operation time"
                      value={formatMs(result.averageOperationTimeMs)}
                    />
                    <MetricRow label="Final value" value={result.finalValue} />
                    <Text style={styles.note}>{result.notes}</Text>
                  </>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): React.JSX.Element {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#f7f7f7'},
  container: {padding: 16, paddingBottom: 40, gap: 14},
  header: {fontSize: 26, fontWeight: '800', color: '#111'},
  note: {fontSize: 14, lineHeight: 20, color: '#4a4a4a'},
  block: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.14)',
    padding: 14,
    gap: 12,
  },
  blockTitle: {fontSize: 18, fontWeight: '800', color: '#111'},
  buttonGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  button: {
    width: '31.7%',
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  buttonDisabled: {opacity: 0.42},
  buttonPressed: {opacity: 0.86},
  buttonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 14,
  },
  actionRow: {flexDirection: 'row', gap: 10},
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: '#dedede',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryButtonText: {fontSize: 14, fontWeight: '800', color: '#111'},
  emptyText: {fontSize: 14, color: '#666'},
  resultCard: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.14)',
    padding: 12,
    gap: 7,
    backgroundColor: '#fafafa',
  },
  resultTitle: {fontSize: 15, fontWeight: '800', color: '#111'},
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  metricLabel: {fontSize: 13, color: '#555', flex: 1},
  metricValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111',
    textAlign: 'right',
  },
  errorText: {fontSize: 13, lineHeight: 18, color: '#b00020'},
});
