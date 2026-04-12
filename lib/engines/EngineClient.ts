import { RedisClient } from './RedisClient';
import { UnsupportedEngineError } from '../errors/UnsupportedEngineError';

import type { GlobalCacheOptions } from '..';
import type { PeerContext } from '../peers';

export type CacheEntryOptions = {
  expiresIn?: number;
};

export type CacheClientOptions = Pick<GlobalCacheOptions, 'engine' | 'caching'> & {
  metricPrefix: string;
  codecs: {
    deserializer?: (key: string, value: any) => any;
    serializer?: (key: string, value: any) => any;
  };
}

export abstract class EngineClient {
  protected opts: CacheClientOptions;
  protected ctx: PeerContext;

  constructor(options: CacheClientOptions, context: PeerContext) {
    this.opts = options;
    this.ctx = context;
  }

  abstract set<M>(prefix: string, key: string, value: M, options?: CacheEntryOptions): Promise<void>;

  abstract get<M>(prefix: string, key: string): Promise<M | undefined>;

  abstract del(prefix: string, key: string): Promise<void>;

  abstract delMany(prefix: string, keys: string[]): Promise<void>;

  abstract delAll(prefix: string): Promise<void>;

  static get(options: CacheClientOptions, context: PeerContext): EngineClient {
    switch (options.engine.type) {
      case 'redis':
        return new RedisClient(options, context);
      default:
        throw new UnsupportedEngineError(options.engine.type);
    }
  }
}
