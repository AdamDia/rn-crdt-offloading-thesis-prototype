import type {BenchmarkRun} from './types';

type RunWithoutId = Omit<BenchmarkRun, 'runId'>;

function toISOStringSafe(date: Date): string {
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    throw new Error('Invalid date');
  }
  return date.toISOString();
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const raw = String(value);
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const needsQuotes =
    normalized.includes(',') ||
    normalized.includes('"') ||
    normalized.includes('\n');
  const escapedQuotes = normalized.replace(/"/g, '""');
  return needsQuotes ? `"${escapedQuotes}"` : escapedQuotes;
}

const CSV_HEADERS: Array<keyof BenchmarkRun> = [
  'runId',
  'startedAt',
  'endedAt',
  'mode',
  'benchmarkCategory',
  'scenarioName',
  'intervalMs',
  'durationMs',
  'operationCount',
  'finalCrdtValue',
  'averageOperationTimeMs',
  'maxOperationTimeMs',
  'burstSize',
  'burstMergeTimeMs',
  'notes',
];

export class BenchmarkLogger {
  private runs: BenchmarkRun[] = [];

  addRun(runWithoutId: RunWithoutId): BenchmarkRun {
    const now = new Date();
    const run: BenchmarkRun = {
      runId: generateRunId(),
      ...runWithoutId,
    };

    if (
      typeof run.scenarioName !== 'string' ||
      run.scenarioName.trim() === ''
    ) {
      throw new Error('scenarioName must be a non-empty string');
    }

    if (typeof run.mode !== 'string') {
      throw new Error('mode must be defined');
    }

    if (typeof run.startedAt !== 'string' || run.startedAt.trim() === '') {
      run.startedAt = toISOStringSafe(now);
    }
    if (typeof run.endedAt !== 'string' || run.endedAt.trim() === '') {
      run.endedAt = toISOStringSafe(now);
    }

    this.runs.push(run);
    return run;
  }

  getRuns(): BenchmarkRun[] {
    return [...this.runs];
  }

  clear(): void {
    this.runs = [];
  }

  exportToCSV(): string {
    const lines: string[] = [];
    lines.push(CSV_HEADERS.join(','));

    for (const run of this.runs) {
      const row = CSV_HEADERS.map(h => csvEscape(run[h]));
      lines.push(row.join(','));
    }

    return `${lines.join('\n')}\n`;
  }
}
