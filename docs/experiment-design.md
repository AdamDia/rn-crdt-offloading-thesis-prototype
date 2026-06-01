# Experiment Design

## Overview
Run repeatable benchmark scenarios to compare:
- **Baseline (JS mode):** CRDT operations and state synchronization on the JavaScript thread.
- **Offloaded (Native mode):** CRDT operations on Swift (iOS), with React Native bridge interaction.

Each scenario is repeated **3 times**. Results are exported to **CSV** for analysis and plotting.

## Scenarios

### Interval Benchmark (`crdt_interval`)
- Sustained increments for **60s** at **100ms**, **50ms**, **20ms**.
- Each run starts from a clean CRDT state (counter reset).

### Burst Merge Benchmark (`crdt_burst`)
- Deterministic remote state merge sizes: **500**, **1000**, **5000**, **10000** replica entries.
- Each run starts from a clean CRDT state (counter reset).

## Output & Comparison
- Export one CSV row per completed run.
- Compare **JS mode vs Native mode** using `averageOperationTimeMs`, `maxOperationTimeMs`, `operationCount`, and burst `burstMergeTimeMs`.

## CSV Field Meanings
- `benchmarkCategory`
  - `crdt_interval`: sustained CRDT increment runs
  - `crdt_burst`: CRDT burst merge runs
- `operationCount`
  - sustained runs: number of benchmark operations executed
  - burst runs: number of CRDT entries merged (unique remote replicas)
- `finalCrdtValue`
  - sustained runs: final CRDT total at stop (should equal `operationCount` for increment-by-1 runs from clean state)
  - burst runs: CRDT total after the merge

## Protocol Notes (Data Collection)
- Sustained interval scenarios are **fixed to 60 seconds** in-app (auto-stop + auto-save).
- Each sustained run starts from a **clean CRDT state** (counter value resets to 0).
- Burst merge scenarios are **state-isolated** and must not affect subsequent sustained runs.
- Manual **Stop** produces a **partial run** and is useful for debugging only; do not include partial runs in official thesis datasets.
