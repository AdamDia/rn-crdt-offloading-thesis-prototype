# Benchmark Results

This directory contains the final datasets, processed statistical summaries,
and thesis-ready figures collected for the thesis prototype:

**Efficient Offloading of Lightweight CRDT-Based State Synchronization in
React Native: A Swift-Backed Approach for High-Frequency UI Updates**

## Measurement environment

- Device: Apple iPhone 11
- Platform: iOS
- Build configuration: Release
- React Native benchmark application
- JavaScript, Swift Native, Classic Bridge, and TurboModule variants where applicable

## Directory structure

### `raw/`

Contains the final cleaned CSV datasets exported from the benchmark
application.

- `interval_benchmark.csv`
- `dashboard_1000.csv`
- `dashboard_5000.csv`
- `dashboard_10000.csv`
- `per_operation_increments.csv`
- `burst_merge_architecture.csv`
- `benchmark_burst_merge.csv`
- `offloading_decision_helper.csv`

These files are treated as the primary source data and should not be edited
manually.

### `processed/`

Contains statistical summaries derived from the raw datasets.

- `benchmark_mean_standard_deviation_summary.csv`
- `benchmark_mean_standard_deviation_summary.xlsx`

The reported standard deviation is the sample standard deviation using
`n - 1`.

Primary benchmark groups contain five independent runs.

The Offloading Decision Helper contains three independent helper executions
per workload. Each execution includes one predetermined unmeasured warm-up
repetition followed by five measured sequential repetitions.

Warm-up measurements are excluded from the reported mean, sample standard
deviation, and maximum measured round-trip time.

### `figures/`

Contains thesis-ready charts in high-resolution PNG format.

Each chart reports:

- arithmetic mean
- sample standard deviation
- error bars representing ±1 sample standard deviation
- the number of independent runs used for the displayed statistics

The PNG figures are exported at 300 DPI and are suitable for repository
documentation and inclusion in the thesis.

## Benchmark scope

The final evidence includes:

- sustained CRDT interval benchmarks
- dashboard-derived workloads at sizes 1000, 5000, and 10000
- per-operation architecture comparison
- burst merge architecture comparison
- JavaScript versus Swift Native burst merge comparison
- supplementary Offloading Decision Helper calibration

The Offloading Decision Helper is supplementary and is not part of the
primary 60-second statistical benchmark protocol.

It evaluates a selected deterministic Dashboard workload by comparing:

- JavaScript compute-only time
- Swift internal computation time
- complete Classic Bridge round-trip time
- estimated bridge overhead

Its recommendation is workload-specific and is not a general-purpose code
analysis result.

## Reproducibility notes

- Raw CSV files are the source of truth.
- Processed summaries and figures are derived from the raw datasets.
- No post-hoc outlier trimming was applied.
- The final measurements were collected using the Release build on a physical
  iPhone 11.
- The complete experiment protocol is documented in
  [`../docs/experiment-design.md`](../docs/experiment-design.md).
