import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const debugFn = vi.fn();
  const createDebug = vi.fn((_namespace: string) => debugFn);
  return { debugFn, createDebug };
});

vi.mock('../../../../lib/loadDebug', () => ({
  loadDebug: () => mocks.createDebug,
}));

// eslint-disable-next-line import-x/first
import { DebugLogger } from '../../../../lib/peers/loggers/DebugLogger';

describe('DebugLogger', () => {
  beforeEach(() => {
    mocks.debugFn.mockClear();
    mocks.createDebug.mockClear();
  });

  it('initializes the underlying debug fn with the sqlcache namespace', () => {
    new DebugLogger();
    expect(mocks.createDebug).toHaveBeenCalledWith('sqlcache');
  });

  describe('debug()', () => {
    it('forwards string + args to the underlying debug fn unchanged', () => {
      const logger = new DebugLogger();
      logger.debug('hello %s, count %d', 'world', 42);
      expect(mocks.debugFn).toHaveBeenCalledWith('hello %s, count %d', 'world', 42);
    });

    it('uses %O placeholder for object payloads', () => {
      const logger = new DebugLogger();
      const payload = { foo: 'bar', count: 1 };
      logger.debug(payload);
      expect(mocks.debugFn).toHaveBeenCalledWith('%O', payload);
    });
  });

  it.each(['info', 'warn', 'error'] as const)('%s() delegates to debug()', (method) => {
    const logger = new DebugLogger();
    logger[method]('msg');
    expect(mocks.debugFn).toHaveBeenCalledWith('msg');
  });
});
