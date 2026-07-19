export type DashboardComputationResult = {
  average: number;
  min: number;
  max: number;
  trend: number;
  normalizedValues: number[];
  checksum: number;
};

export type DashboardComputationProfiledResult = {
  nativeComputeTimeMs: number;
  checksum: number;
  average: number;
  min: number;
  max: number;
  trend: number;
};
