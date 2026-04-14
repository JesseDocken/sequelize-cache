
import { AppMetrics } from './metrics';
import { DebugLogger } from './peers/loggers/DebugLogger';
import { NoopLogger } from './peers/loggers/NoopLogger';
import { StructuredLogger } from './peers/loggers/StructuredLogger';
import { NoopMetricsProvider } from './peers/metrics/NoopMetricsProvider';
import { OpenTelemetryProvider } from './peers/metrics/OpenTelemetryProvider';
import { PrometheusProvider } from './peers/metrics/PrometheusProvider';

import type { ILogger } from './peers/ILogger';
import type { IMetricsProvider } from './peers/IMetricsProvider';
import type { GlobalCacheOptions } from './SequelizeCache';
import type { Registry } from 'prom-client';

function resolveLogger(options: GlobalCacheOptions): ILogger {
  if (options.logger) {
    return new StructuredLogger(options.logger);
  }

  try {
    return new DebugLogger();
  } catch {
    return new NoopLogger();
  }
}

function resolveMetrics(options: GlobalCacheOptions): IMetricsProvider {
  if (!options.metrics) {
    return new NoopMetricsProvider();
  }

  const metricsOpt = options.metrics;

  // prom-client Registry exposes registerMetric
  if ('registerMetric' in metricsOpt && typeof metricsOpt.registerMetric === 'function') {
    return new PrometheusProvider(options.metrics as Registry);
  }

  // OpenTelemetry Meter exposes createCounter
  if ('createCounter' in metricsOpt && typeof metricsOpt.createCounter === 'function') {
    return new OpenTelemetryProvider(options.metrics);
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
