# Thesis Plan

## Title
Efficient Offloading of Lightweight CRDT-Based State Synchronization in React Native: A Swift-Based Approach for High-Frequency UI Updates

## Research Goal
Evaluate whether offloading lightweight CRDT-based state synchronization from the JavaScript thread to Swift can improve responsiveness and stability for high-frequency UI updates in a React Native app.

## Prototype Paths

### JavaScript baseline
- G-Counter implemented in TypeScript
- Increments and merges executed on the JavaScript thread
- Used as the baseline for repeated interval and burst scenarios

### Swift classic bridge path
- G-Counter implemented in Swift
- Exposed through the classic React Native bridge
- Used to compare offloaded execution with bridged call overhead

### Swift TurboModule path
- G-Counter implemented in Swift with a TurboModule interface
- Used to compare New Architecture interop against the classic bridge
- Evaluated separately through architecture comparison scenarios

### Dashboard workload path
- Deterministic synthetic dashboard computation implemented in both JS and Swift
- Used to compare offloading under repeated derived computation plus UI refresh pressure

## Metrics
- FPS stability (e.g., dropped frames / frame time distribution)
- JavaScript thread utilization (CPU time / event loop pressure)
- Native thread utilization (CPU time of Swift-side work)
- Bridge overhead (call frequency, payload sizes, end-to-end latency)
- Memory usage (RSS/heap trends during scenarios)
- CPU usage (overall and per-thread where possible)

## Scope Decisions
- Use **G-Counter** as the primary CRDT benchmark (simple, deterministic, merge-by-max)
- Keep **LWW Register** as a secondary correctness validation case rather than a primary performance benchmark
- **iOS native implementation only** (Swift)
- No backend; burst scenarios are deterministic local merges
- Keep the prototype benchmark-focused rather than framework-complete
- Keep the Network Condition Demo supplementary; it is useful for proposal alignment but not part of the repeated performance dataset

## Core Experiment Set
- CRDT interval benchmark: `100ms`, `50ms`, `20ms` for `60s`
- CRDT burst benchmark: `500`, `1000`, `5000`, `10000` entries
- Dashboard workload benchmark: repeated deterministic computation with configurable workload size and interval
- Architecture comparison benchmark:
  - per-operation increments for `js`, `classic_bridge`, and `turbo_module`
  - one-call burst merges for `js`, `classic_bridge`, and `turbo_module`

## Interpretation Goal
- Use per-operation native calls to measure interop overhead directly
- Use burst merges to represent the more practical batched-offloading case
- Use the dashboard workload to test whether offloading matters more once repeated derived computation and UI updates are added
- Use LWW Register validation to show that the native path is not restricted to one CRDT type
- Use Network Link Conditioner only to affect the real connectivity check; use deterministic local burst merges for reproducible reconnection demonstrations
