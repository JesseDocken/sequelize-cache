import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenTelemetryProvider } from '../../../../lib/peers/metrics/OpenTelemetryProvider';

function createMockMeter() {
  const counter = { add: vi.fn() };
  const histogram = { record: vi.fn() };
  const meter = {
    createCounter: vi.fn(() => counter),
    createHistogram: vi.fn(() => histogram),
  };
  return { meter, counter, histogram };
}

describe('OpenTelemetryProvider', () => {
  describe('createCounter', () => {
    it('creates an OTel counter named for the metric with the help text as description', () => {
      const { meter } = createMockMeter();
      const provider = new OpenTelemetryProvider(meter);

      provider.createCounter('my_counter', 'help text', ['label1', 'label2']);

      expect(meter.createCounter).toHaveBeenCalledWith('my_counter', { description: 'help text' });
    });

    it('inc() with labels adds 1 with the labels passed through', () => {
      const { meter, counter } = createMockMeter();
      const provider = new OpenTelemetryProvider(meter);
      const c = provider.createCounter('c', 'h', ['kind']);

      c.inc({ kind: 'hit' });

      expect(counter.add).toHaveBeenCalledWith(1, { kind: 'hit' });
    });

    it('inc() with no labels still adds 1', () => {
      const { meter, counter } = createMockMeter();
      const provider = new OpenTelemetryProvider(meter);
      const c = provider.createCounter('c', 'h', []);

      c.inc();

      expect(counter.add).toHaveBeenCalledWith(1, undefined);
    });
  });

  describe('createHistogram', () => {
    it('creates an OTel histogram with the help text and seconds unit', () => {
      const { meter } = createMockMeter();
      const provider = new OpenTelemetryProvider(meter);

      provider.createHistogram('my_hist', 'help text', ['l']);

      expect(meter.createHistogram).toHaveBeenCalledWith('my_hist', {
        description: 'help text',
        unit: 's',
      });
    });

    describe('startTimer', () => {
      let now = 0;

      beforeEach(() => {
        now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
      });

      it('records elapsed time in seconds when the stop callback is invoked', () => {
        const { meter, histogram } = createMockMeter();
        const provider = new OpenTelemetryProvider(meter);
        const h = provider.createHistogram('h', 'help', []);

        now = 1000; // start time in ms
        const stop = h.startTimer();
        now = 3500; // 2500ms elapsed
        stop();

        expect(histogram.record).toHaveBeenCalledOnce();
        const [duration] = histogram.record.mock.calls[0];
        expect(duration).toBe(2.5);
      });

      it('merges start labels with end labels (end takes precedence)', () => {
        const { meter, histogram } = createMockMeter();
        const provider = new OpenTelemetryProvider(meter);
        const h = provider.createHistogram('h', 'help', ['shared', 'startOnly', 'endOnly']);

        const stop = h.startTimer({ shared: 'start', startOnly: 'a' });
        stop({ shared: 'end', endOnly: 'b' });

        expect(histogram.record).toHaveBeenCalledOnce();
        const [, labels] = histogram.record.mock.calls[0];
        expect(labels).toEqual({ shared: 'end', startOnly: 'a', endOnly: 'b' });
      });

      it('records with empty labels when neither start nor end labels are provided', () => {
        const { meter, histogram } = createMockMeter();
        const provider = new OpenTelemetryProvider(meter);
        const h = provider.createHistogram('h', 'help', []);

        const stop = h.startTimer();
        stop();

        const [, labels] = histogram.record.mock.calls[0];
        expect(labels).toEqual({});
      });
    });
  });
});
