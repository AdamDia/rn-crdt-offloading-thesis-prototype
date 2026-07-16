export type RunStopReason = 'auto' | 'manual';

export type ActiveRunSnapshot<Mode extends string, Config> = {
  runId: string;
  mode: Mode;
  startedAt: string;
  startPerfMs: number;
  configuredDurationMs: number;
  config: Config;
};

type ActiveRunRecord<Mode extends string, Config> = ActiveRunSnapshot<
  Mode,
  Config
> & {
  finalized: boolean;
};

export function createRunId(): string {
  return `active_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export class BenchmarkRunLifecycle<Mode extends string, Config> {
  private activeRun: ActiveRunRecord<Mode, Config> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  startRun(
    snapshot: ActiveRunSnapshot<Mode, Config>,
    onAutoStop: (snapshot: ActiveRunSnapshot<Mode, Config>) => void,
  ): ActiveRunSnapshot<Mode, Config> | null {
    if (this.activeRun !== null) {
      return null;
    }

    const activeRun: ActiveRunRecord<Mode, Config> = {
      ...snapshot,
      finalized: false,
    };

    this.clearTickTimer();
    this.clearAutoStopTimer();
    this.activeRun = activeRun;
    this.autoStopTimer = setTimeout(() => {
      if (!this.isActiveRun(snapshot.runId)) {
        return;
      }

      this.finalizeRun(snapshot.runId, 'auto', onAutoStop);
    }, snapshot.configuredDurationMs);

    return this.toSnapshot(activeRun);
  }

  getActiveRun(): ActiveRunSnapshot<Mode, Config> | null {
    if (this.activeRun === null || this.activeRun.finalized) {
      return null;
    }

    return this.toSnapshot(this.activeRun);
  }

  isActiveRun(runId: string): boolean {
    return (
      this.activeRun !== null &&
      !this.activeRun.finalized &&
      this.activeRun.runId === runId
    );
  }

  hasActiveRun(): boolean {
    return this.activeRun !== null && !this.activeRun.finalized;
  }

  setTickTimer(runId: string, timer: ReturnType<typeof setTimeout>): boolean {
    if (!this.isActiveRun(runId)) {
      clearTimeout(timer);
      return false;
    }

    this.clearTickTimer();
    this.tickTimer = timer;
    return true;
  }

  stopRun(
    runId: string,
    onStop?: (snapshot: ActiveRunSnapshot<Mode, Config>) => void,
  ): ActiveRunSnapshot<Mode, Config> | null {
    return this.finalizeRun(runId, 'manual', onStop);
  }

  cleanup(): void {
    this.clearTickTimer();
    this.clearAutoStopTimer();
    if (this.activeRun !== null) {
      this.activeRun.finalized = true;
      this.activeRun = null;
    }
  }

  private finalizeRun(
    runId: string,
    _reason: RunStopReason,
    onFinalize?: (snapshot: ActiveRunSnapshot<Mode, Config>) => void,
  ): ActiveRunSnapshot<Mode, Config> | null {
    const activeRun = this.activeRun;
    if (
      activeRun === null ||
      activeRun.finalized ||
      activeRun.runId !== runId
    ) {
      return null;
    }

    activeRun.finalized = true;
    this.clearTickTimer();
    this.clearAutoStopTimer();
    this.activeRun = null;

    const snapshot = this.toSnapshot(activeRun);
    onFinalize?.(snapshot);
    return snapshot;
  }

  private clearTickTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private clearAutoStopTimer(): void {
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  private toSnapshot(
    activeRun: ActiveRunRecord<Mode, Config>,
  ): ActiveRunSnapshot<Mode, Config> {
    return {
      runId: activeRun.runId,
      mode: activeRun.mode,
      startedAt: activeRun.startedAt,
      startPerfMs: activeRun.startPerfMs,
      configuredDurationMs: activeRun.configuredDurationMs,
      config: activeRun.config,
    };
  }
}
