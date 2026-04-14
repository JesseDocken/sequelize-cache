import { createNoopMeter } from '@opentelemetry/api';
import { pino as PinoLogger } from 'pino';
import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { Logger as WinstonLogger } from 'winston';

import { PeerContext } from '../../lib/peers';
import { DebugLogger } from '../../lib/peers/loggers/DebugLogger';
import { StructuredLogger } from '../../lib/peers/loggers/StructuredLogger';
import { NoopMetricsProvider } from '../../lib/peers/metrics/NoopMetricsProvider';
import { OpenTelemetryProvider } from '../../lib/peers/metrics/OpenTelemetryProvider';
import { PrometheusProvider } from '../../lib/peers/metrics/PrometheusProvider';

// The "debug peer is unavailable" scenario lives in peers.no-debug.spec.ts.

describe('PeerContext', () => {
  describe('constructor', () => {
    it('debug module returns the DebugLogger', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
      });

      expect(context.log).to.be.instanceOf(DebugLogger);
      expect(context.metrics.provider).to.be.instanceOf(NoopMetricsProvider);
    });

    it('pino log provider returns the StructuredLogger', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
        logger: PinoLogger(),
      });

      expect(context.log).to.be.instanceOf(StructuredLogger);
      expect(context.metrics.provider).to.be.instanceOf(NoopMetricsProvider);
    });

    it('winston log provider returns the StructuredLogger', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
        logger: new WinstonLogger(),
      });

      expect(context.log).to.be.instanceOf(StructuredLogger);
      expect(context.metrics.provider).to.be.instanceOf(NoopMetricsProvider);
    });

    it('Prometheus registry returns PrometheusProvider', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
        metrics: new Registry(),
      });

      expect(context.log).to.be.instanceOf(DebugLogger);
      expect(context.metrics.provider).to.be.instanceOf(PrometheusProvider);
    });

    it('OpenTelemetry meter returns OpenTelemetryProvider', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
        metrics: createNoopMeter(),
      });

      expect(context.log).to.be.instanceOf(DebugLogger);
      expect(context.metrics.provider).to.be.instanceOf(OpenTelemetryProvider);
    });

    it('Incompatible metric provider returns NoopProvider', () => {
      const context = new PeerContext({
        engine: {
          connection: null as any,
          type: 'redis',
        },
        metrics: {} as any,
      });

      expect(context.log).to.be.instanceOf(DebugLogger);
      expect(context.metrics.provider).to.be.instanceOf(NoopMetricsProvider);
    });
  });
});
