# Experiment Design

## Overview
Run repeatable benchmark scenarios to compare:
- **Primary CRDT benchmark:** JavaScript G-Counter vs Swift classic bridge G-Counter
- **Secondary validation:** LWW Register correctness in JavaScript and Swift
- **Dashboard workload benchmark:** deterministic dashboard-derived computation under repeated UI updates
- **Supplementary Classic Bridge calibration:** workload-specific Offloading Decision Helper for the current dashboard selection
- **Architecture comparison benchmark:** JavaScript vs classic bridge vs TurboModule call paths
- **Supplementary network demonstration:** real connectivity checks plus deterministic local reconnection bursts

Results are exported to **CSV** for analysis and plotting.

## Primary CRDT benchmark

### Scenario A — Sustained Updates (100ms)
- Apply updates every **100ms** for **60s**.
- Purpose: steady-state performance and smoothness under moderate load.

### Scenario B — High-Frequency Updates (50ms)
- Apply updates every **50ms** for **60s**.
- Purpose: detect FPS/JS-thread degradation under higher frequency.

### Scenario C — Stress Updates (20ms)
- Apply updates every **20ms** for **60s**.
- Purpose: push the system toward saturation; observe stability and tail latencies.

### Scenario D — Burst Merge Simulation (500 entries)
- Generate a remote G-Counter state with **500 unique replica entries** and merge/apply it as a single batch.
- Purpose: understand batching/merge costs and bridge payload sensitivity (serialization + dictionary processing).

### Scenario E — Burst Merge Simulation (1000 entries)
- Generate a remote G-Counter state with **1000 unique replica entries** and merge/apply it as a single batch.
- Purpose: stress batch processing; detect memory spikes and long frames.

### Scenario F — Burst Merge Simulation (5000 entries)
- Generate a remote G-Counter state with **5000 unique replica entries** and merge/apply it as a single batch.
- Purpose: explore the break-even point where native offloading may become beneficial.

### Scenario G — Burst Merge Simulation (10000 entries)
- Generate a remote G-Counter state with **10000 unique replica entries** and merge/apply it as a single batch.
- Purpose: stress bridge serialization and native queue throughput at larger payload sizes.

## Secondary CRDT validation

### Scenario H — LWW Register validation
- Validate JavaScript and Swift **LWW Register** behavior.
- Confirm that:
  - a higher timestamp wins
  - an older timestamp is ignored
  - equal-timestamp conflicts resolve deterministically through replica ordering
- Purpose: show that the prototype covers the second lightweight CRDT type mentioned in the proposal without turning it into a primary performance benchmark.

## Dashboard workload benchmark

### Scenario I — Dashboard Workload (60s)
- Run repeated dashboard-derived computation + UI updates for **60 seconds**.
- Supported workload sizes:
  - **1000**
  - **5000**
  - **10000**
- Supported update intervals:
  - **100ms**
  - **50ms**
  - **20ms**
- Official evaluation scenarios:
  - `dashboard_continuous_5000_20ms`
  - `dashboard_continuous_10000_50ms`
  - `dashboard_continuous_10000_20ms`
- Purpose: provide a more representative high-frequency UI workload than the lightweight G-Counter baseline.
- Repeat each official scenario at least **5 times per mode** and export results to CSV.
- The dashboard preview uses deterministic derived signal values generated from the same workload each run.
- These values are synthetic workload outputs, not application business data.

## Supplementary Classic Bridge calibration

### Scenario J — Offloading Decision Helper
- Run **1 predetermined unmeasured warm-up repetition** followed by **5 measured sequential repetitions** for the currently selected dashboard workload size.
- Use the warm-up only to reduce one-time initialization effects such as first bridge activation and runtime scheduling setup.
- Exclude all warm-up timings from the reported statistics.
- Compare:
  - JavaScript compute-only time
  - Swift internal computation time
  - complete Classic Bridge round-trip time
  - estimated bridge overhead
- Report timing rows as **mean ± sample standard deviation**.
- Accept the result only when JavaScript and Swift checksums match within the configured floating-point tolerance.
- Do not sort, trim, or remove measured outliers after collection.
- Output a workload-specific recommendation:
  - `native_beneficial`
  - `bridge_cancels_benefit`
  - `keep_js`
- Recommendation rule: Native is recommended only when the complete Classic Bridge round-trip mean is lower than the JavaScript compute mean.
- Export the supplementary row as CSV category `offloading_decision_helper`.
- This helper is not part of the primary repeated benchmark protocol and is not a general-purpose code analyzer.

## Architecture comparison benchmark

### Scenario K — Per-operation increments
- Run awaited increment operations for:
  - `js`
  - `classic_bridge`
  - `turbo_module`
- Supported sizes:
  - `1000`
  - `5000`
  - `10000`
- Purpose: measure per-call overhead directly.

### Scenario L — One-call burst merges
- Run one deterministic merge call for:
  - `js`
  - `classic_bridge`
  - `turbo_module`
- Supported sizes:
  - `1000`
  - `5000`
  - `10000`
- Purpose: compare a more practical batched-offloading path against per-call interop.

## Supplementary network demonstration

### Scenario M — Network Condition Demo
- Use Apple Network Link Conditioner to affect the real in-app connectivity check.
- Use a deterministic local G-Counter burst merge to model reconnection handling without a backend dependency.
- Purpose: support the proposal’s temporary-disconnection narrative while keeping performance measurements reproducible.

## Output & Comparison
- Export raw metrics per run to CSV (one row per measurement interval / event).
- Compare benchmark modes across:
  - FPS stability and long-frame frequency
  - JS thread utilization
  - native CPU utilization
  - bridge overhead (call latency / throughput)
  - memory and CPU trends over time

## CSV Field Meanings
- `benchmarkCategory`
  - `crdt_interval`: sustained CRDT increment runs (interval_100ms / 50ms / 20ms)
  - `crdt_burst`: CRDT burst merge runs (burst_merge_*)
  - `dashboard_continuous`: continuous dashboard stress runs (dashboard_continuous_<size>_<interval>ms)
  - `offloading_decision_helper`: supplementary Classic Bridge calibration for the selected dashboard workload
  - `architecture_comparison`: JS / classic bridge / TurboModule comparison scenarios
- `operationCount`
  - sustained runs: number of benchmark operations executed
  - burst runs: number of CRDT entries merged (unique remote replicas)
  - continuous dashboard runs: number of completed dashboard computations (ticks)
  - architecture comparison:
    - increment scenarios: number of increment calls
    - burst scenarios: one merge call, with `burstSize` carrying the entry count
- `finalCrdtValue`
  - sustained runs: final CRDT total at stop (should equal `operationCount` for increment-by-1 runs from clean state)
  - burst runs: CRDT total after the merge
  - architecture comparison: final counter total after the increment or burst scenario

## Protocol Notes (Data Collection)
- Sustained interval scenarios are **fixed to 60 seconds** in-app (auto-stop + auto-save).
- Each sustained run starts from a **clean CRDT state** (counter value resets to 0).
- Burst merge scenarios are **state-isolated** and must not affect subsequent sustained runs.
- Manual **Stop** produces a partial dashboard run marked `Manual stop before 60s; exclude from official data`.
- Final repeated performance measurements focus on:
  - G-Counter interval benchmarks
  - G-Counter burst merge benchmarks
  - dashboard workload benchmarks
  - architecture comparison benchmarks
- LWW Register validation, the Offloading Decision Helper, and the Network Condition Demo are supportive checks, not part of the official repeated performance dataset.

## Interpretation Support
- The **G-Counter** benchmark is the deterministic synchronization baseline.
- The **LWW Register** is included as a secondary correctness validation case, not a primary performance benchmark.
- The **dashboard workload benchmark** adds repeated derived computation and UI update pressure on top of deterministic inputs.
- The **Offloading Decision Helper** calibrates whether one selected dashboard workload benefits from Classic Bridge offloading once round-trip overhead is included.
- The **architecture comparison benchmark** separates interop cost from batched merge cost:
  - per-operation native calls expose bridge overhead directly
  - burst merges model the more practical offloading case where work is batched before crossing the JS/native boundary
- The **Network Condition Demo** separates two concerns:
  - Network Link Conditioner affects the real connectivity check
  - deterministic local burst merges provide reproducible reconnection-style demonstrations

## Research Question Mapping
- **RQ2:** impact on UI responsiveness and behavior under high-frequency update pressure.
- **RQ3:** bridge overhead and workload-dependent trade-offs between JS execution and Swift offloading.

## Measurement Limitation
- All measurements are currently collected on the **iOS Simulator**.
- This should be discussed as a limitation when interpreting bridge latency, native scheduling behavior, CPU behavior, and memory behavior.

## Tooling Note
- Flipper, if used, is an optional debugging aid and not a source of thesis performance measurements.
