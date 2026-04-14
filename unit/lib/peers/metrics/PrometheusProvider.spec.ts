import { Counter, Histogram, Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';

import { PrometheusProvider } from '../../../../lib/peers/metrics/PrometheusProvider';

// Uses a real prom-client Registry. The library is deterministic and
// pure-JS — there's nothing to gain from mocking it, and we get end-to-end
// confirmation that the metrics actually land where consumers expect.

describe('PrometheusProvider', () => {
  describe('createCounter', () => {
    it('registers a Counter on the provided registry', () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);

      provider.createCounter('test_counter', 'help text', ['kind']);

      const metric = registry.getSingleMetric('test_counter');
      expect(metric).toBeInstanceOf(Counter);
    });

    it('inc() with labels increments the counter for that label set', async () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);
      const c = provider.createCounter('inc_test', 'help', ['kind']);

      c.inc({ kind: 'hit' });
      c.inc({ kind: 'hit' });
      c.inc({ kind: 'miss' });

      const data = await registry.getSingleMetric('inc_test')!.get();
      const hit = data.values.find((v) => v.labels.kind === 'hit');
      const miss = data.values.find((v) => v.labels.kind === 'miss');
      expect(hit?.value).toBe(2);
      expect(miss?.value).toBe(1);
    });

    it('inc() with no labels increments the counter for an empty label set', async () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);
      const c = provider.createCounter('inc_no_labels', 'help', []);

      c.inc();
      c.inc();

      const data = await registry.getSingleMetric('inc_no_labels')!.get();
      expect(data.values[0].value).toBe(2);
    });
  });

  describe('createHistogram', () => {
    it('registers a Histogram on the provided registry', () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);

      provider.createHistogram('test_hist', 'help text', ['kind']);

      const metric = registry.getSingleMetric('test_hist');
      expect(metric).toBeInstanceOf(Histogram);
    });

    it('honors custom buckets when provided', async () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);
      const buckets = [0.001, 0.01, 0.1, 1];

      provider.createHistogram('bucketed', 'help', [], buckets);

      const data = await registry.getSingleMetric('bucketed')!.get();
      const bucketLabels = data.values
        .filter((v) => 'le' in v.labels && v.labels.le !== '+Inf')
        .map((v) => Number(v.labels.le));
      expect(bucketLabels).toEqual(buckets);
    });

    it('startTimer records an observation when the stop callback is invoked', async () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);
      const h = provider.createHistogram('timer_test', 'help', []);

      const stop = h.startTimer();
      stop();

      const data = await registry.getSingleMetric('timer_test')!.get();
      const count = data.values.find((v) => v.metricName === 'timer_test_count');
      expect(count?.value).toBe(1);
    });

    it('passes labels through start and stop', async () => {
      const registry = new Registry();
      const provider = new PrometheusProvider(registry);
      const h = provider.createHistogram('label_test', 'help', ['kind']);

      const stop = h.startTimer({ kind: 'a' });
      stop();

      const data = await registry.getSingleMetric('label_test')!.get();
      const counts = data.values.filter((v) => v.metricName === 'label_test_count');
      expect(counts.some((c) => c.labels.kind === 'a' && c.value === 1)).toBe(true);
    });
  });
});
