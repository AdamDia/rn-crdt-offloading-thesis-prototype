# RN CRDT Offloading Thesis Prototype

Master thesis prototype:
**“Efficient Offloading of Lightweight CRDT-Based State Synchronization in React Native: A Swift-Based Approach for High-Frequency UI Updates.”**

## Purpose
Benchmark a JavaScript G-Counter baseline against an iOS Swift-backed G-Counter native module under repeatable scenarios, exporting all runs to a single CSV.

## Architecture
- JS baseline: `src/crdt/js/GCounter.ts`
- Native wrapper: `src/native/NativeCRDT.ts`
- iOS Swift module + ObjC export: `ios/CRDTModule.swift`, `ios/CRDTModule.m`
- Logging + CSV formatting: `src/metrics/`
- UI: `src/screens/BenchmarkScreen.tsx`

## Benchmarks
- `crdt_interval`: sustained increments for 60s at 100/50/20ms
- `crdt_burst`: deterministic burst merge (500 / 1000 / 5000 / 10000 entries)

## Run (iOS)
```bash
npm install
cd ios
pod install
cd ..
npm run ios
```

## Export CSV
Use **Export CSV** in the app. If file export is unavailable, it falls back to sharing the raw CSV text.

## Notes for Data Collection
- Repeat runs under controlled conditions (same device, thermal state, background load).
- Use Xcode Instruments when profiling is required (Time Profiler / Allocations).

## Docs
- `docs/thesis-plan.md`
- `docs/experiment-design.md`
- `docs/results-template.md`
