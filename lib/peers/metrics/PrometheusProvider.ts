/* eslint-disable @typescript-eslint/no-require-imports */
import type { ICounter, IHistogram, IMetricsProvider, StopTimerFn } from '../IMetricsProvider';
import type { Registry } from 'prom-client';

export class PrometheusProvider implements IMetricsProvider {
  #registry: unknown;

  constructor(registry: Registry) {
    this.#registry = registry;
  }

  createCounter<const L extends string>(
    name: string, help: string, labelNames: L[]
  ): ICounter<L> {
    const { Counter } = require('prom-client') as typeof import('prom-client');
    const counter = new Counter({
      name,
      help,
      labelNames,
      registers: [this.#registry as import('prom-client').Registry],
    });
    return {
      inc(labels?: Partial<Record<L, string | number>>) {
        if (labels) {
          counter.inc(labels as Record<string, string | number>);
        } else {
          counter.inc();
        }
      },
    };
  }

  createHistogram<const L extends string>(
    name: string, help: string, labelNames: L[], buckets?: number[]
  ): IHistogram<L> {
    const { Histogram } = require('prom-client') as typeof import('prom-client');
    const histogram = new Histogram({
      name,
      help,
      labelNames,
      ...(buckets ? { buckets } : {}),
      registers: [this.#registry as import('prom-client').Registry],
    });
    return {
      startTimer(labels?: Partial<Record<L, string | number>>): StopTimerFn<L> {
        const stop = histogram.startTimer(labels);
        return (endLabels) => {
          stop(endLabels);
        };
      },
    };
  }
}
