import React, {memo} from 'react';
import {StyleSheet, Text, View} from 'react-native';

export type MetricsPanelMode = 'idle' | 'js' | 'native';

export type MetricsPanelProps = {
  crdtValue: number;
  elapsedMs: number;
  operationCount: number;
  averageOperationTimeMs: number;
  maxOperationTimeMs: number;
  selectedIntervalMs: number;
  mode: MetricsPanelMode;
};

function formatNumber(value: number, fractionDigits: number = 2): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(fractionDigits);
}

function formatMs(value: number, fractionDigits: number = 0): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(fractionDigits)} ms`;
}

function formatSeconds(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs)) {
    return '—';
  }
  return `${(elapsedMs / 1000).toFixed(1)} s`;
}

function Row({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function MetricsPanelImpl(props: MetricsPanelProps) {
  const {
    crdtValue,
    elapsedMs,
    operationCount,
    averageOperationTimeMs,
    maxOperationTimeMs,
    selectedIntervalMs,
    mode,
  } = props;

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.title}>Metrics</Text>

      <View style={styles.grid}>
        <Row label="Mode" value={mode.toUpperCase()} />
        <Row label="Interval" value={formatMs(selectedIntervalMs)} />
        <Row label="Elapsed" value={formatSeconds(elapsedMs)} />
        <Row label="Run Operations" value={String(operationCount)} />
        <Row label="CRDT Value" value={formatNumber(crdtValue, 0)} />
        <Row label="Avg op" value={formatMs(averageOperationTimeMs, 3)} />
        <Row label="Max op" value={formatMs(maxOperationTimeMs, 3)} />
      </View>
    </View>
  );
}

export const MetricsPanel = memo(MetricsPanelImpl);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#111',
  },
  grid: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 12,
    color: '#333',
  },
  value: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    color: '#111',
  },
});
