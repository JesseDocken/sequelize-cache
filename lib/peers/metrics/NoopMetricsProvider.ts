import type { ICounter, IHistogram, IMetricsProvider } from '../IMetricsProvider';

export class NoopMetricsProvider implements IMetricsProvider {
  createCounter<const L extends string>(): ICounter<L> {
    return { inc() { } };
  }

  createHistogram<const L extends string>(): IHistogram<L> {
    return { startTimer() { return () => { }; } };
  }
}
