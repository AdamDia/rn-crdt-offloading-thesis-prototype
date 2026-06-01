import {NativeModules} from 'react-native';

type BenchmarkMode = 'js' | 'native';

type NativeCRDTModule = {
  increment(replicaId: string): Promise<number>;
  merge(state: Record<string, number>): Promise<number>;
  getValue(): Promise<number>;
  reset(): Promise<boolean>;
};

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
};
