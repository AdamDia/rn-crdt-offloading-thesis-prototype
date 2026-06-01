# Results Template (Fill During Data Collection)

## Setup
- Device / Simulator:
- iOS version:
- RN version:
- Build identifier (optional):
- Notes (thermal state, background apps, background services, etc.):

## CSV Notes
- Filter/group by `benchmarkCategory`: `crdt_interval`, `crdt_burst`.

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
