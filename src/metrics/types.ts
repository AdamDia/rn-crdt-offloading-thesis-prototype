export type BenchmarkMode = 'js' | 'native';

export type BenchmarkCategory =
  | 'crdt_interval'
  | 'crdt_burst'
  | 'dashboard_heavy'
  | 'dashboard_continuous'
  | 'ui_rendering_stress'
  | 'lww_register'
  | 'network_condition_demo';

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
