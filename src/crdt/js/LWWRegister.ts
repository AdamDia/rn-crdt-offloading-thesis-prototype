import type {LWWRegisterState} from './lwwTypes';

function isIncomingStateNewer(
  incoming: LWWRegisterState,
  current: LWWRegisterState,
): boolean {
  if (incoming.timestamp !== current.timestamp) {
    return incoming.timestamp > current.timestamp;
  }

  return incoming.replicaId > current.replicaId;
}

export class LWWRegister {
  private readonly localReplicaId: string;
  private state: LWWRegisterState;

  constructor(localReplicaId: string) {
    if (
      typeof localReplicaId !== 'string' ||
      localReplicaId.trim().length === 0
    ) {
      throw new Error('localReplicaId must be a non-empty string');
    }

    this.localReplicaId = localReplicaId;
    this.state = {
      value: '',
      timestamp: 0,
      replicaId: localReplicaId,
    };
  }

  set(value: string, timestamp: number = Date.now()): void {
    if (typeof value !== 'string') {
      throw new Error('value must be a string');
    }

    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
      throw new Error('timestamp must be a finite number');
    }

    this.state = {
      value,
      timestamp,
      replicaId: this.localReplicaId,
    };
  }

  merge(remoteState: LWWRegisterState): void {
    if (remoteState == null || typeof remoteState !== 'object') {
      throw new Error('remoteState must be an object');
    }

    const {value, timestamp, replicaId} = remoteState;
    if (
      typeof value !== 'string' ||
      typeof replicaId !== 'string' ||
      replicaId.trim().length === 0 ||
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp)
    ) {
      throw new Error('remoteState is invalid');
    }

    if (isIncomingStateNewer(remoteState, this.state)) {
      this.state = {
        value,
        timestamp,
        replicaId,
      };
    }
  }

  getValue(): string {
    return this.state.value;
  }

  getState(): LWWRegisterState {
    return {...this.state};
  }

  reset(): void {
    this.state = {
      value: '',
      timestamp: 0,
      replicaId: this.localReplicaId,
    };
  }
}
