# Thesis Plan

## Title
Efficient Offloading of Lightweight CRDT-Based State Synchronization in React Native: A Swift-Based Approach for High-Frequency UI Updates

## Research Goal
Evaluate whether offloading lightweight CRDT-based state synchronization from the JavaScript thread to Swift (iOS native) can improve responsiveness and stability for high-frequency UI updates in a React Native app.

## Baseline System (JavaScript)
- CRDT: **G-Counter** implemented in TypeScript/JavaScript
- State updates and merges executed on the JavaScript thread
- UI updates driven by JS state changes

## Proposed System (Swift Offloading)
- CRDT: **G-Counter** implemented in Swift
- React Native bridge (TurboModule / bridging) used to:
  - apply increments/merges natively
  - return aggregate counter value(s) to JS/UI
- Goal: reduce JS thread load and bridge overhead for high-frequency update scenarios

## Metrics
- FPS stability (e.g., dropped frames / frame time distribution)
- JavaScript thread utilization (CPU time / event loop pressure)
- Native thread utilization (CPU time of Swift-side work)
- Bridge overhead (call frequency, payload sizes, end-to-end latency)
- Memory usage (RSS/heap trends during scenarios)
- CPU usage (overall and per-thread where possible)

## Scope Decisions
- Start with **G-Counter** first (simple, deterministic, merge-by-max)
- **iOS native implementation only** (Swift)
- No backend (local-only prototype; no network layer)
- No Automerge
- No full CRDT framework (keep implementation minimal and benchmark-focused)
