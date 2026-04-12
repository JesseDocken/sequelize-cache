import { format } from 'node:util';

import { AppMetrics } from './metrics';

import type { GlobalCacheOptions } from '.';

// ─── Logger ──────────────────────────────────────────────────────────

export interface ILogger {
  debug(data: string | Record<string, unknown>, ...args: unknown[]): void;
  info(data: string | Record<string, unknown>, ...args: unknown[]): void;
  warn(data: string | Record<string, unknown>, ...args: unknown[]): void;
  error(data: string | Record<string, unknown>, ...args: unknown[]): void;
}

export class NoopLogger implements ILogger {
  debug() {}
  info() {}
  warn() {}
  error() {}
}

class DebugLogger implements ILogger {
  #debug: (...args: unknown[]) => void;

  constructor() {
    const createDebug = require('debug') as (namespace: string) => (...args: unknown[]) => void;
    this.#debug = createDebug('sequelize-cache');
  }

  debug(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#debug(data, ...args);
    } else {
      this.#debug('%O', data);
    }
  }

  info(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }

  warn(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }

  error(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }
}

class StructuredLogger implements ILogger {
  #logger: {
    debug(...args: unknown[]): unknown;
    info(...args: unknown[]): unknown;
    warn(...args: unknown[]): unknown;
    error(...args: unknown[]): unknown;
  };

  constructor(logger: GlobalCacheOptions['logger']) {
    this.#logger = logger!;
  }

  debug(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.debug(format(data, ...args));
    } else {
      this.#logger.debug(data);
    }
  }

  info(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.info(format(data, ...args));
    } else {
      this.#logger.info(data);
    }
  }

  warn(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.warn(format(data, ...args));
    } else {
      this.#logger.warn(data);
    }
  }

  error(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.error(format(data, ...args));
    } else {
      this.#logger.error(data);
    }
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────

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

export class NoopMetricsProvider implements IMetricsProvider {
  createCounter<const L extends string>(): ICounter<L> {
    return { inc() {} };
  }

  createHistogram<const L extends string>(): IHistogram<L> {
    return { startTimer() { return () => {}; } };
  }
}

class PromClientProvider implements IMetricsProvider {
  #registry: unknown;

  constructor(registry: unknown) {
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
        const stop = histogram.startTimer(labels as any);
        return (endLabels) => {
          stop(endLabels as any);
        };
      },
    };
  }
}

class OtelProvider implements IMetricsProvider {
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

// ─── PeerContext ──────────────────────────────────────────────────────

function resolveLogger(options: GlobalCacheOptions): ILogger {
  if (options.logger) {
    return new StructuredLogger(options.logger);
  }

  try {
    require.resolve('debug');
    return new DebugLogger();
  } catch {
    return new NoopLogger();
  }
}

function resolveMetrics(options: GlobalCacheOptions): IMetricsProvider {
  if (!options.metrics) {
    return new NoopMetricsProvider();
  }

  // prom-client Registry exposes registerMetric
  if (typeof (options.metrics as any).registerMetric === 'function') {
    return new PromClientProvider(options.metrics);
  }

  // OpenTelemetry Meter exposes createCounter
  if (typeof (options.metrics as any).createCounter === 'function') {
    return new OtelProvider(options.metrics);
  }

  return new NoopMetricsProvider();
}

/**
 * Resolves the logger and metrics provider from the given options based on
 * the peer dependencies available. Each `SequelizeCache` instance should
 * create its own `PeerContext` so that multiple instances with different
 * providers can coexist.
 */
export class PeerContext {
  readonly log: ILogger;
  readonly metrics: AppMetrics;

  constructor(options: GlobalCacheOptions) {
    this.log = resolveLogger(options);
    this.metrics = new AppMetrics(resolveMetrics(options));
  }
}
