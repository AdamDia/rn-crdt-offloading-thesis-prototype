export type BenchmarkMode = 'js' | 'native' | 'classic_bridge' | 'turbo_module';

export type BenchmarkCategory =
  | 'crdt_interval'
  | 'crdt_burst'
  | 'dashboard_continuous'
  | 'offloading_decision_helper'
  | 'architecture_comparison';

export type BenchmarkRun = {
  runId: string;
  startedAt: string;
  endedAt: string;
  mode: BenchmarkMode;
  benchmarkCategory: BenchmarkCategory;
  scenarioName: string;
  intervalMs: number;
  durationMs: number;
  operationCount: number;
  finalCrdtValue: number;
  averageOperationTimeMs: number;
  maxOperationTimeMs: number;
  burstSize: number;
  burstMergeTimeMs: number;
  notes?: string;
};
