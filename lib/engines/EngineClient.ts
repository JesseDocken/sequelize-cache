import type { GlobalCacheOptions } from "..";
import { UnsupportedEngineError } from "../errors/UnsupportedEngineError";
import { PeerContext } from "../peers";
import { RedisClient } from "./RedisClient";

export type CacheEntryOptions = {
  expiresIn?: number;
};

export type CacheClientOptions = Pick<GlobalCacheOptions, 'connection'> & {
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
    try {
      const { Redis } = require('ioredis');
      if (options.connection instanceof Redis) {
        return new RedisClient(options, context);
      }
    } catch {
      // Not a Redis client
    }

    throw new UnsupportedEngineError(options.connection);
  }
}
