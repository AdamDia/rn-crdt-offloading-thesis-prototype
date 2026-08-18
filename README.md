# CRDT Offloading Thesis Prototype

Research artifact for the M.Sc. Computer Science thesis:

**“Efficient Offloading of Lightweight CRDT-Based State Synchronization in React Native: A Swift-Based Approach for High-Frequency UI Updates.”**

This repository contains the benchmark implementation, native modules, exported datasets, and supporting documentation used to study whether lightweight CRDT-based state synchronization benefits from Swift-based offloading in React Native on iOS.

## Experimental Versions and Research Evolution

### Primary Thesis Baseline

The primary thesis evaluation was implemented and measured using **React Native 0.74.6** on iOS. This baseline compares TypeScript / JavaScript execution with Swift native execution through the **React Native Classic Bridge / legacy native-module path**.

The primary benchmark dataset and the main quantitative conclusions reported in the thesis were obtained from this React Native 0.74.6 experimental baseline.

### Supplementary Architecture Iteration

After completion of the primary experimental work, the project was upgraded from **React Native 0.74.6 to React Native 0.86** so that a **TurboModule / New Architecture** implementation could be added and evaluated.

This architecture comparison was a supplementary extension to the original research design. It was not part of the original thesis proposal or primary experimental scope, but was added because it provides additional evidence about the effect of JavaScript-native communication architecture on offloading performance.

The TurboModule results are therefore reported separately from the primary React Native 0.74.6 Classic Bridge evaluation.

## Current Repository State

The current `main` branch reflects the later **React Native 0.86** supplementary architecture iteration.

The primary **React Native 0.74.6** environment remains the experimental baseline for the main thesis dataset and the primary quantitative conclusions reported in the thesis.

Accordingly, the current repository state should not be interpreted as meaning that the primary thesis results were originally collected using React Native 0.86.

## Version Traceability

The reachable Git history contains a baseline-era snapshot at commit `07c9c83`, where `package.json` pins **React Native 0.74.6**. This provides a historical pointer to the earlier experimental baseline.

The current repository state reflects the later upgrade to **React Native 0.86**, introduced to support the supplementary TurboModule / New Architecture comparison.

The research artifact therefore represents two related experimental stages:

1. **React Native 0.74.6** — primary Classic Bridge baseline used for the main thesis evaluation.
2. **React Native 0.86** — later supplementary architecture iteration used for the TurboModule / New Architecture comparison.

The prototype therefore includes:

- a JavaScript G-Counter baseline;
- a Swift native-module implementation used through the React Native 0.74.6 Classic Bridge baseline; and
- a Swift TurboModule implementation added after the React Native 0.86 upgrade for the supplementary New Architecture comparison.

It also includes a deterministic dashboard-derived workload to evaluate native offloading under repeated UI update pressure.

## Prototype Scope

- **Lightweight CRDT benchmarking** for the main thesis evaluation
- **JavaScript / TypeScript execution path**
- **Swift native execution path**
- **CRDT interval benchmark** for repeated G-Counter increments at `100ms`, `50ms`, and `20ms`
- **CRDT burst merge benchmark** for deterministic merges of `500`, `1000`, `5000`, and `10000` entries
- **Dashboard workload benchmark** for repeated synthetic dashboard computation with configurable workload size and update interval
- **Complete native round-trip measurement** where applicable in the benchmark and supplementary helper flows
- **Architecture comparison benchmark** covering JavaScript, the legacy/native-module integration path, and TurboModule execution
- **Offloading Decision Helper** as a supplementary runtime calibration for the selected dashboard workload
- **Secondary LWW Register validation** to cover the second lightweight CRDT type discussed in the thesis
- **Supplementary Network Condition Demo** to support the temporary-disconnection and reconnection-burst scenario

## Architecture Overview

- `src/crdt/js/` contains the JavaScript G-Counter baseline.
- `ios/CRDTModule.swift` and `ios/CRDTModule.m` contain the legacy NativeModules implementation used by the primary React Native 0.74.6 Classic Bridge baseline and retained in the later artifact iteration.
- `ios/TurboCRDTCore.swift`, `ios/TurboCRDTModule.h`, and `ios/TurboCRDTModule.mm` provide the TurboModule / New Architecture implementation added after the React Native 0.86 upgrade.
- `src/native/NativeCRDT.ts` and `src/native/TurboCRDT.ts` wrap native calls from TypeScript.
- `src/metrics/` provides shared run logging and CSV export.

The **React Native 0.74.6 Classic Bridge path constitutes the primary thesis baseline**.

The artifact was later upgraded to **React Native 0.86**, where the TurboModule path was added as a supplementary New Architecture comparison. This later architecture iteration extends the original research rather than replacing the primary baseline.

The Offloading Decision Helper is supplementary only. It performs one predetermined unmeasured warm-up followed by five measured sequential repetitions for the currently selected dashboard workload. Warm-up timings are excluded from the reported statistics, no post-hoc outlier removal is performed, and the decision metric uses the complete native round-trip mean rather than Swift internal computation time alone.

The helper distinguishes JavaScript computation time, internal Swift computation time, complete native round-trip time, and the estimated integration component. Results must pass checksum validation before logging. The helper output is stored separately from the primary statistical benchmark protocol.

## Run on iOS

Install dependencies:

```bash
npm install
cd ios
pod install
cd ..
```

Start Metro in one terminal:

```bash
npm start
```

Run the iOS app from another terminal.

For development using an available iOS Simulator:

```bash
npx react-native run-ios --simulator "<available simulator name>" --no-packager
```

For a connected physical iPhone:

```bash
npx react-native run-ios --device --no-packager
```

Recommended Xcode workspace:

```text
ios/RNOffloadingBenchmark.xcworkspace
```

## Measurement Notes

The primary thesis measurements were collected through repeated controlled runs on a **physical iPhone 11 using a Release build**.

Primary benchmark configurations were repeated five times and reported using the arithmetic mean and sample standard deviation.

These primary measurements belong to the **React Native 0.74.6 Classic Bridge experimental baseline**.

The later **React Native 0.86** upgrade was introduced for the supplementary architecture comparison and TurboModule evaluation. The supplementary architecture results are treated separately from the primary baseline dataset.

The iOS Simulator may be used for development, functional inspection, and reproduction of the benchmark workflow, but it should not be treated as equivalent to the physical-device environment used for the primary thesis measurements.

Manually stopped runs were treated as inspection-only and were not included in the primary statistical dataset.

Per-operation native scenarios include the JavaScript-to-native communication path. Burst scenarios evaluate batched workloads in which multiple updates are processed through a single native invocation.

The Offloading Decision Helper follows a separate supplementary measurement procedure. For each evaluated workload size, three independent helper executions were performed. Each execution contained one unmeasured warm-up followed by five measured repetitions.

FPS, CPU, memory, and network-condition observations are supplementary runtime evidence and are not treated as repeated quantitative datasets equivalent to the primary benchmark timing measurements.

Flipper, where used during development, was not a source of performance measurements.

The repository provides the implementation, benchmark logic, and supporting artifacts required to inspect and reproduce the research approach. The thesis distinguishes the primary **React Native 0.74.6 Classic Bridge evaluation** from the later supplementary **React Native 0.86 TurboModule / New Architecture iteration**.

## Final Benchmark Results

The final raw datasets, processed statistical summaries, and thesis-ready figures are available under `results/`.

- Overview: [`results/README.md`](results/README.md)
- Raw datasets: [`results/raw/`](results/raw/)
- Processed summaries: [`results/processed/`](results/processed/)
- Final figures: [`results/figures/`](results/figures/)

### Selected Results

#### Dashboard Workload — Size 10,000

![Dashboard workload size 10000](results/figures/04_dashboard_workload_10000_mean_sd.png)

#### Burst Merge Architecture Comparison

![Burst merge architecture comparison](results/figures/06_burst_merge_architecture_mean_sd.png)

#### Offloading Decision Helper

![Offloading Decision Helper](results/figures/08_offloading_decision_helper_mean_sd.png)