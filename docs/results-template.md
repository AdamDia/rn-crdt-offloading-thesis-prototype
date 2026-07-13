# Results Template (Fill During Data Collection)

## Setup
- Device / Simulator:
- iOS version:
- RN version:
- Commit SHA:
- Notes (thermal state, background apps, etc.):
- Limitation note for thesis write-up:
  Measurements are collected on iOS Simulator; discuss implications for bridge latency, native scheduling, CPU behavior, and memory behavior.

## CSV Notes
- Filter/group by `benchmarkCategory`: `crdt_interval`, `crdt_burst`, `dashboard_continuous`, `architecture_comparison`.
- For dashboard-derived workload analysis, report **mean** and **standard deviation** after at least **5 repetitions per mode**.
- For architecture comparison, separate:
  - per-operation increment scenarios
  - one-call burst merge scenarios

## Validation Checklist
- [ ] LWW Register validation passes in JavaScript and native Swift
- [ ] Connectivity check responds correctly under normal network conditions
- [ ] Connectivity check responds correctly when Network Link Conditioner forces failure
- [ ] Reconnection burst demo reports final value, burst size, and merge time

## Sustained Runs (60s)

| Mode | Interval (ms) | Run # | operationCount | finalCrdtValue | avgOpMs | maxOpMs | Notes |
|------|---------------|-------|----------------|----------------|---------|---------|-------|
| JS   | 100           | 1     |                |                |         |         |       |
| JS   | 100           | 2     |                |                |         |         |       |
| JS   | 100           | 3     |                |                |         |         |       |
| Native | 100         | 1     |                |                |         |         |       |
| Native | 100         | 2     |                |                |         |         |       |
| Native | 100         | 3     |                |                |         |         |       |
| JS   | 50            | 1     |                |                |         |         |       |
| JS   | 50            | 2     |                |                |         |         |       |
| JS   | 50            | 3     |                |                |         |         |       |
| Native | 50          | 1     |                |                |         |         |       |
| Native | 50          | 2     |                |                |         |         |       |
| Native | 50          | 3     |                |                |         |         |       |
| JS   | 20            | 1     |                |                |         |         |       |
| JS   | 20            | 2     |                |                |         |         |       |
| JS   | 20            | 3     |                |                |         |         |       |
| Native | 20          | 1     |                |                |         |         |       |
| Native | 20          | 2     |                |                |         |         |       |
| Native | 20          | 3     |                |                |         |         |       |

## Burst Merge Runs

| Mode | burstSize (entries) | Run # | operationCount | finalCrdtValue | burstMergeTimeMs | Notes |
|------|----------------------|-------|----------------|----------------|------------------|-------|
| JS   | 500                  | 1     |                |                |                  |       |
| JS   | 500                  | 2     |                |                |                  |       |
| JS   | 500                  | 3     |                |                |                  |       |
| Native | 500                | 1     |                |                |                  |       |
| Native | 500                | 2     |                |                |                  |       |
| Native | 500                | 3     |                |                |                  |       |
| JS   | 1000                 | 1     |                |                |                  |       |
| JS   | 1000                 | 2     |                |                |                  |       |
| JS   | 1000                 | 3     |                |                |                  |       |
| Native | 1000               | 1     |                |                |                  |       |
| Native | 1000               | 2     |                |                |                  |       |
| Native | 1000               | 3     |                |                |                  |       |
| JS   | 5000                 | 1     |                |                |                  |       |
| JS   | 5000                 | 2     |                |                |                  |       |
| JS   | 5000                 | 3     |                |                |                  |       |
| Native | 5000               | 1     |                |                |                  |       |
| Native | 5000               | 2     |                |                |                  |       |
| Native | 5000               | 3     |                |                |                  |       |
| JS   | 10000                | 1     |                |                |                  |       |
| JS   | 10000                | 2     |                |                |                  |       |
| JS   | 10000                | 3     |                |                |                  |       |
| Native | 10000              | 1     |                |                |                  |       |
| Native | 10000              | 2     |                |                |                  |       |
| Native | 10000              | 3     |                |                |                  |       |

## Dashboard-Derived Workload Benchmark

Official scenarios:
- `dashboard_continuous_5000_20ms`
- `dashboard_continuous_10000_50ms`
- `dashboard_continuous_10000_20ms`

| Mode | workloadSize | Interval (ms) | Run # | operationCount | avgOpMs | maxOpMs | Notes |
|------|--------------|---------------|-------|----------------|---------|---------|-------|
| JS   | 5000         | 20            | 1     |                |         |         |       |
| JS   | 5000         | 20            | 2     |                |         |         |       |
| JS   | 5000         | 20            | 3     |                |         |         |       |
| JS   | 5000         | 20            | 4     |                |         |         |       |
| JS   | 5000         | 20            | 5     |                |         |         |       |
| Native | 5000       | 20            | 1     |                |         |         |       |
| Native | 5000       | 20            | 2     |                |         |         |       |
| Native | 5000       | 20            | 3     |                |         |         |       |
| Native | 5000       | 20            | 4     |                |         |         |       |
| Native | 5000       | 20            | 5     |                |         |         |       |
| JS   | 10000        | 50            | 1     |                |         |         |       |
| JS   | 10000        | 50            | 2     |                |         |         |       |
| JS   | 10000        | 50            | 3     |                |         |         |       |
| JS   | 10000        | 50            | 4     |                |         |         |       |
| JS   | 10000        | 50            | 5     |                |         |         |       |
| Native | 10000      | 50            | 1     |                |         |         |       |
| Native | 10000      | 50            | 2     |                |         |         |       |
| Native | 10000      | 50            | 3     |                |         |         |       |
| Native | 10000      | 50            | 4     |                |         |         |       |
| Native | 10000      | 50            | 5     |                |         |         |       |
| JS   | 10000        | 20            | 1     |                |         |         |       |
| JS   | 10000        | 20            | 2     |                |         |         |       |
| JS   | 10000        | 20            | 3     |                |         |         |       |
| JS   | 10000        | 20            | 4     |                |         |         |       |
| JS   | 10000        | 20            | 5     |                |         |         |       |
| Native | 10000      | 20            | 1     |                |         |         |       |
| Native | 10000      | 20            | 2     |                |         |         |       |
| Native | 10000      | 20            | 3     |                |         |         |       |
| Native | 10000      | 20            | 4     |                |         |         |       |
| Native | 10000      | 20            | 5     |                |         |         |       |

## Dashboard Summary Statistics

| Mode | workloadSize | Interval (ms) | Mean operationCount | StdDev operationCount | Mean avgOpMs | StdDev avgOpMs | Mean maxOpMs | StdDev maxOpMs |
|------|--------------|---------------|---------------------|-----------------------|--------------|----------------|--------------|----------------|
| JS   | 5000         | 20            |                     |                       |              |                |              |                |
| Native | 5000       | 20            |                     |                       |              |                |              |                |
| JS   | 10000        | 50            |                     |                       |              |                |              |                |
| Native | 10000      | 50            |                     |                       |              |                |              |                |
| JS   | 10000        | 20            |                     |                       |              |                |              |                |
| Native | 10000      | 20            |                     |                       |              |                |              |                |

## Architecture Comparison — Per-operation Increments

| Mode | Size | Run # | operationCount | finalCrdtValue | totalTimeMs | avgOpMs | Notes |
|------|------|-------|----------------|----------------|-------------|---------|-------|
| JS | 1000 | 1 | | | | | |
| Classic Bridge | 1000 | 1 | | | | | |
| TurboModule | 1000 | 1 | | | | | |
| JS | 5000 | 1 | | | | | |
| Classic Bridge | 5000 | 1 | | | | | |
| TurboModule | 5000 | 1 | | | | | |
| JS | 10000 | 1 | | | | | |
| Classic Bridge | 10000 | 1 | | | | | |
| TurboModule | 10000 | 1 | | | | | |

## Architecture Comparison — Burst Merges

| Mode | burstSize | Run # | operationCount | finalCrdtValue | burstMergeTimeMs | Notes |
|------|-----------|-------|----------------|----------------|------------------|-------|
| JS | 1000 | 1 | | | | |
| Classic Bridge | 1000 | 1 | | | | |
| TurboModule | 1000 | 1 | | | | |
| JS | 5000 | 1 | | | | |
| Classic Bridge | 5000 | 1 | | | | |
| TurboModule | 5000 | 1 | | | | |
| JS | 10000 | 1 | | | | |
| Classic Bridge | 10000 | 1 | | | | |
| TurboModule | 10000 | 1 | | | | |
