import type {GCounterState, ReplicaId} from './types';

export class GCounter {
  private readonly localReplicaId: ReplicaId;
  private state: GCounterState;

  constructor(localReplicaId: ReplicaId) {
    if (
      typeof localReplicaId !== 'string' ||
      localReplicaId.trim().length === 0
    ) {
      throw new Error('localReplicaId must be a non-empty string');
    }

    this.localReplicaId = localReplicaId;
    this.state = {[localReplicaId]: 0};
  }

  increment(amount: number = 1): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new Error('amount must be a finite, non-negative number');
    }

    if (amount === 0) {
      return;
    }

    const current = this.state[this.localReplicaId] ?? 0;
    this.state[this.localReplicaId] = current + amount;
  }

  merge(remoteState: GCounterState): void {
    if (remoteState == null || typeof remoteState !== 'object') {
      throw new Error('remoteState must be an object');
    }

    // G-Counter merge rule: per-replica counts only grow; merged state takes max per replica.
    for (const [replicaId, remoteValue] of Object.entries(remoteState)) {
      if (typeof replicaId !== 'string' || replicaId.trim().length === 0) {
        continue;
      }

      if (
        typeof remoteValue !== 'number' ||
        !Number.isFinite(remoteValue) ||
        remoteValue < 0
      ) {
        continue;
      }

      const localValue = this.state[replicaId] ?? 0;
      this.state[replicaId] = Math.max(localValue, remoteValue);
    }
  }

  value(): number {
    let sum = 0;
    for (const v of Object.values(this.state)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        sum += v;
      }
    }
    return sum;
  }

  exportState(): GCounterState {
    return {...this.state};
  }

  reset(): void {
    this.state = {[this.localReplicaId]: 0};
  }

  getReplicaValue(replicaId: ReplicaId): number {
    return this.state[replicaId] ?? 0;
  }
}
