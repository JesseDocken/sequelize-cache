import type { ICounter, IHistogram, IMetricsProvider, StopTimerFn } from '../IMetricsProvider';

export class OpenTelemetryProvider implements IMetricsProvider {
  #meter: import('@opentelemetry/api').Meter;

  constructor(meter: unknown) {
    this.#meter = meter as import('@opentelemetry/api').Meter;
  }

  createCounter<const L extends string>(
    name: string, help: string, _labelNames: L[]
  ): ICounter<L> {
    const counter = this.#meter.createCounter(name, { description: help });
    return {
      inc(labels?: Partial<Record<L, string | number>>) {
        counter.add(1, labels as Record<string, string | number> | undefined);
      },
    };
  }

  createHistogram<const L extends string>(
    name: string, help: string, _labelNames: L[], _buckets?: number[]
  ): IHistogram<L> {
    const histogram = this.#meter.createHistogram(name, {
      description: help,
      unit: 's',
    });
    return {
      startTimer(labels?: Partial<Record<L, string | number>>): StopTimerFn<L> {
        const start = performance.now();
        return (endLabels) => {
          const duration = (performance.now() - start) / 1000;
          histogram.record(duration, { ...labels, ...endLabels } as Record<string, string | number>);
        };
      },
    };
  }
}
