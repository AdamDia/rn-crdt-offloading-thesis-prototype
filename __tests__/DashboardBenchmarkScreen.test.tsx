import 'react-native';

import React from 'react';
import {NativeModules} from 'react-native';
import {beforeAll, beforeEach, describe, expect, it, jest} from '@jest/globals';
import renderer, {act, type ReactTestInstance} from 'react-test-renderer';

import {sharedBenchmarkLogger} from '../src/metrics/sharedLogger';
import {DashboardBenchmarkScreen} from '../src/screens/DashboardBenchmarkScreen';

type BenchmarkRun = ReturnType<typeof sharedBenchmarkLogger.getRuns>[number];

function getDashboardRuns(): BenchmarkRun[] {
  return sharedBenchmarkLogger
    .getRuns()
    .filter(run => run.benchmarkCategory === 'dashboard_continuous');
}

function findNodeByTitle(
  root: ReactTestInstance,
  title: string,
): ReactTestInstance {
  const match = root.findAll(node => node.props.title === title)[0];
  if (!match) {
    throw new Error(`Unable to find node with title "${title}"`);
  }
  return match;
}

function findPressableByText(
  root: ReactTestInstance,
  text: string,
): ReactTestInstance {
  const textNode = root.findAll(node => {
    const children = node.props.children;
    return (
      typeof node.props.onPress !== 'function' &&
      (typeof children === 'string'
        ? children === text
        : Array.isArray(children) &&
          children.every(child => typeof child === 'string') &&
          children.join('') === text)
    );
  })[0];

  if (!textNode) {
    throw new Error(`Unable to find text node "${text}"`);
  }

  let current: ReactTestInstance | null = textNode;
  while (current && typeof current.props.onPress !== 'function') {
    current = current.parent;
  }

  if (!current) {
    throw new Error(`Unable to find pressable ancestor for "${text}"`);
  }

  return current;
}

async function pressTitle(root: ReactTestInstance, title: string): Promise<void> {
  await act(async () => {
    findNodeByTitle(root, title).props.onPress();
  });
}

async function pressText(root: ReactTestInstance, text: string): Promise<void> {
  await act(async () => {
    findPressableByText(root, text).props.onPress();
  });
}

async function advanceRunToCompletion(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_500);
  });
}

beforeAll(() => {
  const globalWithWindow = global as typeof globalThis & {
    window?: {dispatchEvent?: jest.Mock};
  };

  Object.defineProperty(global, 'window', {
    value: globalWithWindow.window ?? {},
    writable: true,
    configurable: true,
  });

  globalWithWindow.window!.dispatchEvent = jest.fn();
  NativeModules.CRDTModule = {
    increment: jest.fn(async () => 1),
    merge: jest.fn(async () => 1),
    getValue: jest.fn(async () => 1),
    reset: jest.fn(async () => true),
    runDashboardComputation: jest.fn(async () => ({
      average: 0,
      min: 0,
      max: 0,
      trend: 0,
      normalizedValues: [],
      checksum: 0,
    })),
    lwwSet: jest.fn(),
    lwwMerge: jest.fn(),
    lwwGet: jest.fn(),
    lwwReset: jest.fn(async () => true),
  };
});

describe('DashboardBenchmarkScreen reset lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sharedBenchmarkLogger.clear();

    let perfNow = 0;
    jest
      .spyOn(global.performance, 'now')
      .mockImplementation(() => {
        perfNow += 1;
        return perfNow;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    sharedBenchmarkLogger.clear();
  });

  it('records non-zero metrics after Reset -> Start -> auto-complete', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DashboardBenchmarkScreen />);
    });

    const root = tree!.root;
    await pressTitle(root, 'Reset');
    await pressText(root, '1000');
    await pressText(root, '100ms');
    await pressTitle(root, 'Start JS Dashboard');
    await advanceRunToCompletion();

    const runs = getDashboardRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].durationMs).toBe(60_000);
    expect(runs[0].operationCount).toBeGreaterThan(0);
    expect(runs[0].averageOperationTimeMs).toBeGreaterThan(0);
    expect(runs[0].maxOperationTimeMs).toBeGreaterThan(0);
    expect(runs[0].finalCrdtValue).toBe(799004929);
    expect(runs[0].notes).toContain('Completed full 60s dashboard workload benchmark');
    expect(findNodeByTitle(root, 'Start JS Dashboard').props.disabled).toBe(false);
    expect(findNodeByTitle(root, 'Stop').props.disabled).toBe(true);
  });

  it('repeat Reset -> Start keeps recording valid metrics and one row per run', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DashboardBenchmarkScreen />);
    });

    const root = tree!.root;

    for (let index = 0; index < 2; index += 1) {
      await pressTitle(root, 'Reset');
      await pressText(root, '1000');
      await pressText(root, '100ms');
      await pressTitle(root, 'Start JS Dashboard');
      await advanceRunToCompletion();
    }

    const runs = getDashboardRuns();
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.operationCount).toBeGreaterThan(0);
      expect(run.averageOperationTimeMs).toBeGreaterThan(0);
      expect(run.maxOperationTimeMs).toBeGreaterThan(0);
      expect(run.finalCrdtValue).toBe(799004929);
    }
    expect(new Set(runs.map(run => run.runId)).size).toBe(2);
  });

  it('reset during an active run cancels it without appending an official row', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DashboardBenchmarkScreen />);
    });

    const root = tree!.root;
    await pressTitle(root, 'Start JS Dashboard');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    await pressTitle(root, 'Reset');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_500);
    });

    expect(getDashboardRuns()).toHaveLength(0);
    expect(findNodeByTitle(root, 'Start JS Dashboard').props.disabled).toBe(false);
    expect(findNodeByTitle(root, 'Stop').props.disabled).toBe(true);
  });

  it('reset invalidates old callbacks and the next run records fresh metrics', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DashboardBenchmarkScreen />);
    });

    const root = tree!.root;
    await pressTitle(root, 'Start JS Dashboard');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    await pressTitle(root, 'Reset');
    await pressText(root, '1000');
    await pressText(root, '100ms');
    await pressTitle(root, 'Start JS Dashboard');
    await advanceRunToCompletion();

    const runs = getDashboardRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].operationCount).toBeGreaterThan(0);
    expect(runs[0].averageOperationTimeMs).toBeGreaterThan(0);
    expect(runs[0].maxOperationTimeMs).toBeGreaterThan(0);
    expect(runs[0].finalCrdtValue).toBe(799004929);
  });

  it('start without reset still initializes fresh metrics for the next run', async () => {
    let tree: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DashboardBenchmarkScreen />);
    });

    const root = tree!.root;
    await pressText(root, '1000');
    await pressText(root, '100ms');
    await pressTitle(root, 'Start JS Dashboard');
    await advanceRunToCompletion();
    await pressTitle(root, 'Start JS Dashboard');
    await advanceRunToCompletion();

    const runs = getDashboardRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].runId).not.toBe(runs[1].runId);
    expect(runs[1].operationCount).toBeGreaterThan(0);
    expect(runs[1].averageOperationTimeMs).toBeGreaterThan(0);
    expect(runs[1].maxOperationTimeMs).toBeGreaterThan(0);
    expect(runs[1].finalCrdtValue).toBe(799004929);
  });
});
