import {NativeModules} from 'react-native';

import type {DashboardComputationResult} from '../dashboard/types';
import type {LWWRegisterState} from '../crdt/js/lwwTypes';

type BenchmarkMode = 'js' | 'native';

type NativeCRDTModule = {
  increment(replicaId: string): Promise<number>;
  merge(state: Record<string, number>): Promise<number>;
  getValue(): Promise<number>;
  reset(): Promise<boolean>;
  runDashboardComputation(size: number): Promise<unknown>;
  lwwSet(value: string, timestamp: number, replicaId: string): Promise<unknown>;
  lwwMerge(state: LWWRegisterState): Promise<unknown>;
  lwwGet(): Promise<unknown>;
  lwwReset(): Promise<boolean>;
};

function parseLWWState(result: unknown): LWWRegisterState {
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid native LWW state');
  }

  const value = (result as any).value;
  const timestamp = Number((result as any).timestamp);
  const replicaId = (result as any).replicaId;

  if (
    typeof value !== 'string' ||
    typeof replicaId !== 'string' ||
    !Number.isFinite(timestamp)
  ) {
    throw new Error('Invalid native LWW state');
  }

  return {value, timestamp, replicaId};
}

function getModule(): NativeCRDTModule {
  const mod = NativeModules.CRDTModule as NativeCRDTModule | undefined;
  if (!mod) {
    throw new Error(
      'Native module CRDTModule is unavailable. Did you run pod install and rebuild the iOS app?',
    );
  }
  return mod;
}

export const NativeCRDT = {
  mode: 'native' as BenchmarkMode,

  increment(replicaId: string) {
    return getModule().increment(replicaId);
  },

  merge(state: Record<string, number>) {
    return getModule().merge(state);
  },

  getValue() {
    return getModule().getValue();
  },

  reset() {
    return getModule().reset();
  },

  async runDashboardComputation(
    size: number,
  ): Promise<DashboardComputationResult> {
    const result = await getModule().runDashboardComputation(size);
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid native dashboard computation result');
    }

    const normalizedValues = Array.isArray((result as any).normalizedValues)
      ? ((result as any).normalizedValues as unknown[]).map(n => Number(n))
      : [];

    return {
      average: Number((result as any).average),
      min: Number((result as any).min),
      max: Number((result as any).max),
      trend: Number((result as any).trend),
      normalizedValues,
      checksum: Number((result as any).checksum),
    };
  },

  async lwwSet(
    value: string,
    timestamp: number,
    replicaId: string,
  ): Promise<LWWRegisterState> {
    return parseLWWState(await getModule().lwwSet(value, timestamp, replicaId));
  },

  async lwwMerge(state: LWWRegisterState): Promise<LWWRegisterState> {
    return parseLWWState(await getModule().lwwMerge(state));
  },

  async lwwGet(): Promise<LWWRegisterState> {
    return parseLWWState(await getModule().lwwGet());
  },

  lwwReset() {
    return getModule().lwwReset();
  },
};
