import NativeTurboCRDTModule from '../specs/NativeTurboCRDTModule';
import type {Spec} from '../specs/NativeTurboCRDTModule';

function getModule(): Spec {
  if (!NativeTurboCRDTModule) {
    throw new Error(
      'TurboCRDTModule is unavailable. Run pod install and rebuild the iOS app with Codegen enabled.',
    );
  }

  return NativeTurboCRDTModule;
}

export const TurboCRDT = {
  isAvailable(): boolean {
    return NativeTurboCRDTModule !== null;
  },

  reset(): Promise<boolean> {
    return getModule().reset();
  },

  getValue(): Promise<number> {
    return getModule().getValue();
  },

  increment(replicaId: string): Promise<number> {
    return getModule().increment(replicaId);
  },

  merge(state: Record<string, number>): Promise<number> {
    const entries = Object.entries(state).map(([replicaId, value]) => ({
      replicaId,
      value,
    }));

    return getModule().merge(entries);
  },
};
