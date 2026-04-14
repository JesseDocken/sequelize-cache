import { BaseClient } from './EngineClient';
import { CacheUnavailableError } from '../errors/CacheUnavailableError';

import type { CacheClientOptions } from './EngineClient';
import type { PeerContext } from '../peers';
import type { Redis } from 'ioredis';

export const KEY_DELIMITER = ':';
const REDIS_NAMESPACE = 'modelcache';

export class RedisClient extends BaseClient {
  private conn: Redis;
  private metricPrefix: string;
  private namespace: string;

  constructor(options: CacheClientOptions, context: PeerContext) {
    super(options, context);
    this.conn = options.engine.connection;
    this.metricPrefix = options.metricPrefix;
    this.namespace = options.caching?.namespace || REDIS_NAMESPACE;
  }

  /**
   * Set a value in Redis. Format of the key will be namespace:prefix:key.
   * If options.expiresIn is provided, the value will expire after that many seconds.
   *
   * @param prefix Prefix for the key. Generally is the model name.
   * @param key Key for the value. Used to identify the model instance.
   * @param value Value to store. Must be JSON serializable.
   * @param options Options for how the value should be cached.
   */
  async set<M>(
    prefix: string,
    key: string,
    value: M,
    options?: { expiresIn?: number }
  ) {
    this.ctx.log.debug('Setting key %s in Redis as: %s', key, this.buildKey([this.namespace, prefix, key]));
    const stopSetTimer = this.ctx.metrics.cacheOperationDuration.startTimer({
      component: this.metricPrefix,
      operation: 'set',
    });

    try {
      const redisKey = this.buildKey([this.namespace, prefix, key]);
      const redisValue = JSON.stringify(value, this.opts.codecs.serializer);

      if (options?.expiresIn) {
        await this.conn.set(redisKey, redisValue, 'EX', options.expiresIn);
      } else {
        await this.conn.set(redisKey, redisValue);
      }
      this.ctx.log.info('Key %s set in Redis.', redisKey);
      this.ctx.metrics.cacheOperation.inc({
        component: this.metricPrefix,
        operation: 'set',
      });
    } catch (error) {
      this.ctx.log.error('Error setting key %s in Redis.', key, error);

      this.ctx.metrics.cacheOperationError.inc({
        component: this.metricPrefix,
        operation: 'set',
      });
    } finally {
      stopSetTimer();
    }
  }

  /**
   * Get a value from Redis. Returns the value if it exists, otherwise returns undefined.
   *
   * @param keyPrefix keyPrefix for the key. Used to group keys together.
   * @param key Key for the value. Used to identify the value.
   * @returns The value from Redis or undefined.
   */
  async get<M>(keyPrefix: string, key: string): Promise<M | undefined> {
    const redisKey = this.buildKey([this.namespace, keyPrefix, key]);
    this.ctx.log.debug('Getting key $%s from Redis.', redisKey);

    const stopGetTimer = this.ctx.metrics.cacheOperationDuration.startTimer({
      component: this.metricPrefix,
      operation: 'get',
    });

    try {
      this.ctx.metrics.cacheOperation.inc({
        component: this.metricPrefix,
        operation: 'get',
      });

      return await this.internalGet<M>(keyPrefix, key);
    } catch (error: any) {
      this.ctx.log.error('Error retrieving key %s from Redis.', redisKey, error);

      this.ctx.metrics.cacheOperationError.inc({
        component: this.metricPrefix,
        operation: 'get',
      });

      throw new CacheUnavailableError({ cause: error });
    } finally {
      stopGetTimer();
    }
  }

  async internalGet<M>(keyPrefix: string, key: string): Promise<M | undefined> {
    const redisKey = this.buildKey([this.namespace, keyPrefix, key]);
    const redisValue = await this.conn.get(redisKey);

    if (!redisValue) {
      this.ctx.log.debug('Key %s not found in Redis.', redisKey);

      return undefined;
    }

    this.ctx.log.debug('Key %s found in Redis.', redisKey);

    return JSON.parse(redisValue, this.opts.codecs.deserializer) as M;
  }

  async del(keyPrefix: string, key: string) {
    const stopDelTimer = this.ctx.metrics.cacheOperationDuration.startTimer({
      component: this.metricPrefix,
      operation: 'del',
    });

    const redisKey = this.buildKey([this.namespace, keyPrefix, key]);
    try {
      await this.conn.del(redisKey);

      this.ctx.log.debug('Deleted key %s from Redis.', redisKey);

      this.ctx.metrics.cacheOperation.inc({
        component: this.metricPrefix,
        operation: 'del',
      });
    } catch (error: any) {
      this.ctx.log.error('Error deleting key %s from Redis.', redisKey, error);

      this.ctx.metrics.cacheOperationError.inc({
        component: this.metricPrefix,
        operation: 'del',
      });
    } finally {
      stopDelTimer();
    }
  }

  async delMany(keyPrefix: string, keys: string[]) {
    const stopDelTimer = this.ctx.metrics.cacheOperationDuration.startTimer({
      component: this.metricPrefix,
      operation: 'delMany',
    });

    const redisKeys = keys.map((key) => this.buildKey([this.namespace, keyPrefix, key]));

    try {
      await this.conn.del(redisKeys);

      this.ctx.log.debug('Deleted keys from Redis: %s', redisKeys);

      this.ctx.metrics.cacheOperation.inc({
        component: this.metricPrefix,
        operation: 'delMany',
      });
    } catch (error: any) {
      this.ctx.log.error('Error deleting keys %s from Redis.', redisKeys, error);

      this.ctx.metrics.cacheOperationError.inc({
        component: this.metricPrefix,
        operation: 'delMany',
      });
    } finally {
      stopDelTimer();
    }
  }

  async delAll(keyPrefix: string) {
    const stopDelTimer = this.ctx.metrics.cacheOperationDuration.startTimer({
      component: this.metricPrefix,
      operation: 'delAll',
    });

    try {
      let cursor = '0';
      let count = 0;
      do {
        const result = await this.conn.scan(
          cursor,
          'MATCH',
          `${this.namespace}${KEY_DELIMITER}${keyPrefix}${KEY_DELIMITER}*`,
          'COUNT',
          100
        );
        cursor = result[0];
        const elements = result[1];
        await this.conn.unlink(elements);
      } while (cursor !== '0' && ++count < 10000);

      if (cursor !== '0') {
        this.ctx.log.warn('Bailed before cache was fully invalidated!');
      }

      this.ctx.metrics.cacheOperation.inc({
        component: this.metricPrefix,
        operation: 'delAll',
      });
    } catch (error) {
      this.ctx.log.error(`Error deleting keys of ${this.namespace}${KEY_DELIMITER}${keyPrefix} from Redis.`, error);
      this.ctx.metrics.cacheOperationError.inc({
        component: this.metricPrefix,
        operation: 'delAll',
      });
    } finally {
      stopDelTimer();
    }
  }

  buildKey(components: (string | number)[]) {
    return components.join(KEY_DELIMITER);
  }
}
