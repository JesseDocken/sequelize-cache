import { describe, expect, it, vi } from 'vitest';

import { StructuredLogger } from '../../../../lib/peers/loggers/StructuredLogger';

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('StructuredLogger', () => {
  describe.each(['debug', 'info', 'warn', 'error'] as const)('%s()', (method) => {
    it('formats string arguments via util.format before forwarding', () => {
      const inner = createMockLogger();
      const logger = new StructuredLogger(inner as any);

      logger[method]('hello %s, your id is %d', 'world', 42);

      expect(inner[method]).toHaveBeenCalledOnce();
      expect(inner[method]).toHaveBeenCalledWith('hello world, your id is 42');
    });

    it('passes object payloads through unchanged', () => {
      const inner = createMockLogger();
      const logger = new StructuredLogger(inner as any);
      const payload = { foo: 'bar', count: 1 };

      logger[method](payload);

      expect(inner[method]).toHaveBeenCalledOnce();
      expect(inner[method]).toHaveBeenCalledWith(payload);
    });

    it('does not invoke other log levels', () => {
      const inner = createMockLogger();
      const logger = new StructuredLogger(inner as any);

      logger[method]('test');

      const others = (['debug', 'info', 'warn', 'error'] as const).filter((m) => m !== method);
      for (const other of others) {
        expect(inner[other]).not.toHaveBeenCalled();
      }
    });
  });
});
