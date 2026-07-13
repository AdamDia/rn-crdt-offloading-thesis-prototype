import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type GCounterEntry = {
  replicaId: string;
  value: number;
};

export interface Spec extends TurboModule {
  increment(replicaId: string): Promise<number>;
  merge(entries: ReadonlyArray<GCounterEntry>): Promise<number>;
  getValue(): Promise<number>;
  reset(): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('TurboCRDTModule');
