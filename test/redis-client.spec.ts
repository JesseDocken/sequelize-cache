import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PeerContext } from '../lib/peers';
import { RedisClient } from '../lib/engines/RedisClient';

import type { CacheClientOptions } from '../lib/engines/EngineClient';

// Direct integration tests for RedisClient — exercises the areas that the
// higher-level lifecycle/fallback/expiration suites don't reach.

let redis: Redis;
let badRedis: Redis;

const NAMESPACE = 'redis-client-test';

function createClient(
  conn: Redis,
  overrides?: Partial<CacheClientOptions>,
) {
  const ctx = new PeerContext({ engine: { connection: conn, type: 'redis' } });
  return new RedisClient({
    engine: { connection: conn, type: 'redis' },
    caching: { namespace: NAMESPACE },
    metricPrefix: 'test',
    codecs: {},
    ...overrides,
  }, ctx);
}

beforeAll(async () => {
  redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true });
  await redis.connect();

  badRedis = new Redis({
    host: '127.0.0.1',
    port: 6390,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 200,
    retryStrategy: () => null,
  });
});

beforeEach(async () => {
  const keys = await redis.keys(`${NAMESPACE}:*`);
  if (keys.length > 0) {
    await redis.del(keys);
  }
});

afterAll(() => {
  redis.disconnect();
  badRedis.disconnect();
});

describe('RedisClient', () => {
  describe('set + get', () => {
    it('stores and retrieves a JSON-serializable value', async () => {
      const client = createClient(redis);
      await client.set('model', 'pk:1', { name: 'Alice', age: 30 });

      const result = await client.get<{ name: string; age: number }>('model', 'pk:1');
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('returns undefined on a cache miss', async () => {
      const client = createClient(redis);
      const result = await client.get('model', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('set without TTL does not set an expiry', async () => {
      const client = createClient(redis);
      await client.set('model', 'no-ttl', { v: 1 });

      const ttl = await redis.ttl(`${NAMESPACE}:model:no-ttl`);
      // TTL returns -1 when the key has no associated expire.
      expect(ttl).toBe(-1);
    });

    it('set with TTL applies the expiry in seconds', async () => {
      const client = createClient(redis);
      await client.set('model', 'with-ttl', { v: 1 }, { expiresIn: 60 });

      const ttl = await redis.ttl(`${NAMESPACE}:model:with-ttl`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  describe('codecs', () => {
    it('serializer is applied during set', async () => {
      const client = createClient(redis, {
        codecs: {
          serializer: (_key, value) =>
            typeof value === 'bigint' ? `__bigint__${value.toString()}` : value,
        },
      });

      await client.set('model', 'codec', { id: 42n });

      // Read the raw Redis value to confirm the serializer ran.
      const raw = await redis.get(`${NAMESPACE}:model:codec`);
      expect(raw).toContain('__bigint__42');
    });

    it('deserializer is applied during get', async () => {
      const client = createClient(redis, {
        codecs: {
          serializer: (_key, value) =>
            typeof value === 'bigint' ? `__bigint__${value.toString()}` : value,
          deserializer: (_key, value) =>
            typeof value === 'string' && value.startsWith('__bigint__')
              ? BigInt(value.slice('__bigint__'.length))
              : value,
        },
      });

      await client.set('model', 'codec', { id: 42n });
      const result = await client.get<{ id: bigint }>('model', 'codec');
      expect(result!.id).toBe(42n);
    });
  });

  describe('del', () => {
    it('removes a single key', async () => {
      const client = createClient(redis);
      await client.set('model', 'to-delete', { v: 1 });

      await client.del('model', 'to-delete');

      const result = await client.get('model', 'to-delete');
      expect(result).toBeUndefined();
    });
  });

  describe('delMany', () => {
    it('removes multiple keys in one call', async () => {
      const client = createClient(redis);
      await client.set('model', 'a', { v: 1 });
      await client.set('model', 'b', { v: 2 });
      await client.set('model', 'c', { v: 3 });

      await client.delMany('model', ['a', 'b']);

      expect(await client.get('model', 'a')).toBeUndefined();
      expect(await client.get('model', 'b')).toBeUndefined();
      expect(await client.get('model', 'c')).toEqual({ v: 3 });
    });
  });

  describe('delAll', () => {
    it('removes all keys matching the prefix via SCAN', async () => {
      const client = createClient(redis);
      await client.set('model', 'x', { v: 1 });
      await client.set('model', 'y', { v: 2 });
      await client.set('other', 'z', { v: 3 });

      await client.delAll('model');

      expect(await client.get('model', 'x')).toBeUndefined();
      expect(await client.get('model', 'y')).toBeUndefined();
      // Different prefix — should survive.
      expect(await client.get('other', 'z')).toEqual({ v: 3 });
    });
  });

  describe('namespace', () => {
    it('uses the configured caching.namespace for key construction', async () => {
      const client = createClient(redis, {
        caching: { namespace: 'custom-ns' },
      });
      await client.set('model', 'key', { v: 1 });

      const exists = await redis.exists('custom-ns:model:key');
      expect(exists).toBe(1);
    });

    it('falls back to the default namespace when none is configured', async () => {
      const ctx = new PeerContext({ engine: { connection: redis, type: 'redis' } });
      const client = new RedisClient({
        engine: { connection: redis, type: 'redis' },
        metricPrefix: 'test',
        codecs: {},
        // No caching.namespace provided.
      }, ctx);

      await client.set('model', 'default-ns', { v: 1 });

      // Default namespace is 'modelcache'.
      const exists = await redis.exists('modelcache:model:default-ns');
      expect(exists).toBe(1);

      // Cleanup.
      await redis.del('modelcache:model:default-ns');
    });
  });

  describe('error handling', () => {
    it('set swallows errors and does not throw', async () => {
      const client = createClient(badRedis);
      // Should not throw even though Redis is unreachable.
      await expect(client.set('model', 'k', { v: 1 })).resolves.toBeUndefined();
    });

    it('get throws CacheUnavailableError when Redis is unreachable', async () => {
      const client = createClient(badRedis);
      await expect(client.get('model', 'k')).rejects.toThrow('Redis is not connected');
    });

    it('del swallows errors and does not throw', async () => {
      const client = createClient(badRedis);
      await expect(client.del('model', 'k')).resolves.toBeUndefined();
    });

    it('delMany swallows errors and does not throw', async () => {
      const client = createClient(badRedis);
      await expect(client.delMany('model', ['a', 'b'])).resolves.toBeUndefined();
    });

    it('delAll swallows errors and does not throw', async () => {
      const client = createClient(badRedis);
      await expect(client.delAll('model')).resolves.toBeUndefined();
    });
  });

  describe('buildKey', () => {
    it('joins components with the colon delimiter', () => {
      const client = createClient(redis);
      expect(client.buildKey(['a', 'b', 'c'])).toBe('a:b:c');
    });

    it('handles numeric components', () => {
      const client = createClient(redis);
      expect(client.buildKey(['ns', 42, 'key'])).toBe('ns:42:key');
    });
  });
});
