export interface ICounter<L extends string = string> {
  inc(labels?: Partial<Record<L, string | number>>): void;
}

export type StopTimerFn<L extends string = string> =
  (endLabels?: Partial<Record<L, string | number>>) => void;

export interface IHistogram<L extends string = string> {
  startTimer(labels?: Partial<Record<L, string | number>>): StopTimerFn<L>;
}

export interface IMetricsProvider {
  createCounter<const L extends string>(
    name: string, help: string, labelNames: L[]
  ): ICounter<L>;

  createHistogram<const L extends string>(
    name: string, help: string, labelNames: L[], buckets?: number[]
  ): IHistogram<L>;
}
