import {
  difference,
  has,
  isBoolean,
  isEqual,
  isNil,
  isNumber,
  isObjectLike,
  isString,
  transform,
} from 'lodash';
import { Op } from 'sequelize';

import { CachedModelInstance } from './CachedModelInstance';
import { AlreadyCachedError } from './errors/AlreadyCachedError';
import { CacheUnavailableError } from './errors/CacheUnavailableError';
import { NonconformantQueryError } from './errors/NonconformantQueryError';
import { PeerContext } from './peers';

import type { KeyType, ModelKeyLookup } from './CachedModelInstance';
import type { Meter } from '@opentelemetry/api';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import type { Registry } from 'prom-client';
import type {
  Attributes,
  CreationAttributes,
  DestroyOptions,
  FindCacheOptions,
  FindOptions,
  Identifier,
  Model,
  ModelStatic,
  UpdateOptions,
  WhereOptions,
} from 'sequelize';
import type { Logger as WinstonLogger } from 'winston';

/**
 * Specifies the configuration options for the cache.
 */
export type GlobalCacheOptions = {
  /**
   * Properties related to the caching engine to be used.
   */
  engine: {
    /**
     * The connection to the caching service.
     */
    connection: Redis;
    /**
     * The type of engine in use (currently only `redis` is supported).
     */
    type: 'redis';
  }
  /**
   * An optional metrics provider. If provided, the cache will automatically
   * surface telemetry data to the given provider.
   */
  metrics?: Registry | Meter;
  /**
   * An optional logger. If provided, log messages will be surfaced to the
   * provided preconfigured logger. If not provided, you can still get debug
   * logging via the `debug` module using the DEBUG environment variable. See
   * documentation on the `debug` module for additional usage information.
   */
  logger?: PinoLogger | WinstonLogger;
  /**
   * Options that modify how caching operates internally.
   */
  caching?: {
    /**
     * An optional namespace that all model instances should be prefixed with
     * when stored in the cache. This can be used to help avoid potential
     * collisions.
     */
    namespace?: string;
  };
};

/**
 * Caching options (for typed models)
 */
export type CacheOptions<M extends Model = Model> = {
  /**
   * Specifies what unique keys to allow for querying that are guaranteed unique. Each grouping of columns
   * that form the unique key should be in separate arrays. For example, if you want to permit lookup by
   * name or by serial number and hardware class, you could set this to:
   * `[['name'], ['serialNbr', 'hwType']]
   */
  uniqueKeys?: (keyof Attributes<M>)[][];
  /**
   * Hooks that should be called when interacting with cached models.
   */
  hooks?: {
    /**
     * A hook to invoke when a single model is retrieved. The hook will not be invoked if `model` is null.
     * @param model The model retrieved by cache
     * @returns optionally a promise for async calls
     */
    getOne?: (model: M) => Promise<void> | void;
  };
  ttl?: number;
};

/**
 * Caching options (for untyped models)
 */
export type UntypedCacheOptions = {
  /**
   * Specifies what unique keys to allow for querying that are guaranteed unique. Each grouping of columns
   * that form the unique key should be in separate arrays. For example, if you want to permit lookup by
   * name or by serial number and hardware class, you could set this to:
   * `[['name'], ['serialNbr', 'hwType']]
   */
  uniqueKeys?: string[][];
  /**
   * Hooks that should be called when interacting with cached models.
   */
  hooks?: {
    /**
     * A hook to invoke when a single model is retrieved. The hook will not be invoked if `model` is null.
     * @param model The model retrieved by cache
     * @returns optionally a promise for async calls
     */
    getOne?: (model: any) => Promise<void> | void;
  };
  ttl?: number;
};

const DEFAULT_TTL = 3600; // Default TTL of 1 hour

/**
 * Manages the configuration of the cache and its integration with Sequelize. This acts as the main
 * interface point and allows you to designate what models you wish to cache.
 */
export class SequelizeCache {
  #opt: GlobalCacheOptions;
  #ctx: PeerContext;
  private static cachedModels = new WeakSet<ModelStatic<any>>();

  /**
   * Creates a new instance of `SequelizeCache` with the provided options.
   * @param options the configuration options for the cache
   */
  constructor(options: GlobalCacheOptions) {
    this.#opt = options;
    this.#ctx = new PeerContext(options);
  }

  /**
   * Configures the provided Sequelize model to enable caching support. This will modify the
   * `findByPk` and `findOne` methods on the model to read from the cache instead of the database
   * when certain criteria are met. In addition, cached instances will automatically be invalidated
   * if they have been updated or destroyed.
   *
   * @param model the model to enable caching for
   * @param options optional settings for the cache layer
   */
  cacheModel<M extends Model>(model: ModelStatic<M>, options?: CacheOptions<M>): void;
  cacheModel(model: any, options?: UntypedCacheOptions): void;
  cacheModel<M extends Model = Model>(
    model: ModelStatic<M>,
    options: CacheOptions<M> | UntypedCacheOptions = {}
  ) {
    const cache = new CachedModelInstance({
      engine: this.#opt.engine,
      caching: this.#opt.caching,
      modelOptions: {
        uniqueKeys: options.uniqueKeys as string[][],
        timeToLive: options.ttl ?? DEFAULT_TTL,
      },
    }, this.#ctx, model);

    const keys = cache.modelKeys;

    const originalFindByPk = model.findByPk;
    const originalFindOne = model.findOne;
    const ctx = this.#ctx;

    if (SequelizeCache.cachedModels.has(model)) {
      throw new AlreadyCachedError(model);
    }

    SequelizeCache.cachedModels.add(model);

    model.findByPk = async function (
      id?: Identifier,
      opt?: Omit<FindOptions<Attributes<M>>, 'where'>
    ) {
      if (isNil(id)) {
        return null;
      }
      const cacheOpt = normalizeCacheOptions(opt);
      // If scope() has been called against the model, we don't want to use the cache, since that'll bypass
      // the scopes.
      if (shouldUseCache(this, keys, id, opt)) {
        const metricsOptions = {
          model: model.name,
          method: 'findByPk',
          target: 'cache',
        };
        const cacheLookupComplete = ctx.metrics.lookupTime.startTimer();
        try {
          const result = await cache.getModel('primary', [id]);
          if (options.hooks?.getOne && result) {
            ctx.log.debug('Invoking getOne hook for %s ID %s', model.name, id);
            await options.hooks.getOne(result);
          }
          ctx.metrics.lookupCount.inc(metricsOptions);
          return result;
        } catch (e) {
          if (
            e instanceof CacheUnavailableError &&
            (cacheOpt.fallback !== 'fail')
          ) {
            // If the cache engine is unavailable, fall back to using the database.
            metricsOptions.target = 'database';
            const result = await originalFindByPk.call(this, id, opt);
            ctx.metrics.lookupCount.inc(metricsOptions);
            return result;
          }
          ctx.log.error('Cache could not be used', e);
          throw e;
        } finally {
          cacheLookupComplete(metricsOptions);
        }
      } else {
        const metricsOptions = {
          model: model.name,
          method: 'findByPk',
          target: 'database',
        };
        ctx.metrics.lookupCount.inc(metricsOptions);
        const dbLookupComplete = ctx.metrics.lookupTime.startTimer(metricsOptions);
        try {
          return await originalFindByPk.call(this, id, opt);
        } finally {
          dbLookupComplete();
        }
      }
    };

    model.findOne = async function (opt?: FindOptions<Attributes<M>>) {
      // We only support lookups against the primary key or the unique keys specified.
      const cacheOpt = normalizeCacheOptions(opt);
      const key = keysMatchCandidates(Object.keys(opt?.where ?? {}), keys);
      if (shouldUseCache(this, keys, undefined, opt) && key) {
        const cacheLookupComplete = ctx.metrics.lookupTime.startTimer();
        const metricsOptions = {
          model: model.name,
          method: 'findOne',
          target: 'cache',
        };

        try {
          const fixed = transform(
            opt!.where as WhereOptions<Attributes<M>>,
            (r, v, k) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- WhereOptions values are untyped at runtime
              r[k] = isObjectLike(v) && has(v, Op.eq) ? v[Op.eq] : v;
            },
            {} as Record<string, Identifier>
          );

          const fields = Object.keys(fixed);
          const identifiers = Object.values(fixed);
          const result = await cache.getModel(key.type, identifiers, fields);
          if (options.hooks?.getOne && result) {
            ctx.log.debug(
              'Invoking getOne hook for %s keys [%s] values [%s]',
              model.name,
              fields,
              identifiers
            );
            await options.hooks.getOne(result);
          }
          ctx.metrics.lookupCount.inc(metricsOptions);
          return result;
        } catch (e) {
          if (
            e instanceof CacheUnavailableError &&
            (cacheOpt.fallback !== 'fail')
          ) {
            // If Redis is unavailable, fall back to the original database.
            metricsOptions.target = 'database';
            const result = await originalFindOne.call(this, opt);
            ctx.metrics.lookupCount.inc(metricsOptions);
            return result;
          }
          ctx.log.error('Cache could not be used', e);
          throw e;
        } finally {
          cacheLookupComplete(metricsOptions);
        }
      } else {
        const metricsOptions = {
          model: model.name,
          method: 'findOne',
          target: 'database',
        };
        ctx.metrics.lookupCount.inc(metricsOptions);
        const dbLookupComplete = ctx.metrics.lookupTime.startTimer(metricsOptions);
        try {
          return await originalFindOne.call(this, opt);
        } finally {
          dbLookupComplete();
        }
      }
    };

    async function instanceHandler(instance: M) {
      try {
        await cache.invalidate(instance);
      } catch (e) {
        // Suppress cache invalidation errors but log the rest. Caching should never cause a transaction
        // to roll back.
        if (!(e instanceof CacheUnavailableError)) {
          ctx.log.warn('Failed to invalidate for model %s', model.name, e);
        } else {
          ctx.log.debug('Cache unavailable, skipping invalidation for model %s', model.name, e);
        }
      }
    }

    async function bulkHandler(opt?: UpdateOptions<Attributes<M>> | DestroyOptions<Attributes<M>>) {
      // If individualHooks is enabled, then we will let the individual hooks instead and not attempt to
      // handle things here.
      if (opt?.individualHooks) {
        return;
      }
      // The bulk handler can only invalidate an individual record if the were references the primary key and
      // no unique keys were provided. Otherwise we _have_ to invalidate all cache entries as a precaution,
      // since we don't know what models were potentially affected and don't have access to the instances.
      const matchKey = keysMatchCandidates(Object.keys(opt?.where ?? {}), keys);
      try {
        if (matchKey?.type !== 'primary' || keys.unique.length > 0) {
          // We don't have a choice but to do a full flush.
          // TODO: We're temporarily disabling bulk invalidation.
          await cache.invalidateAll();
        } else {
          // We can just invalidate the model based on the PK. It doesn't matter here whether the model is
          // "real", at least for now.
          await cache.invalidate(model.build(opt!.where as CreationAttributes<M>));
        }
      } catch (e) {
        // Suppress cache unavailable errors, but log the rest. Regardless we don't want to bubble them up
        // since that will (potentially) rollback the transaction, which the cache should never do.
        if (!(e instanceof CacheUnavailableError)) {
          ctx.log.warn('Failed to invalidate for model %s', model.name, e);
        } else {
          ctx.log.debug('Cache unavailable, skipping invalidation for model %s', model.name, e);
        }
      }
    }

    model.addHook('afterUpdate', 'model-cache-update', instanceHandler);
    model.addHook('afterDestroy', 'model-cache-destroy', instanceHandler);
    model.addHook('afterBulkUpdate', 'model-cache-bulk-update', bulkHandler);
    model.addHook('afterBulkDestroy', 'model-cache-bulk-destroy', bulkHandler);
  }
}

/**
 * Identifies if a set of keys provided matches any of the provided candidates.
 *
 * @param keys the column names to match against
 * @param candidates all of the candidates to search against
 * @returns an object indicating which candidate matched
 */
export function keysMatchCandidates(
  keys: string[],
  candidates: ModelKeyLookup
): { type: KeyType; match: string[] } | undefined {
  const whereKeys = keys.sort();
  const primary = candidates.primary.sort();
  const unique = candidates.unique.map((uK) => uK.sort());

  if (!keys.length) {
    return undefined;
  }

  if (isEqual(whereKeys, primary)) {
    return {
      type: 'primary',
      match: primary,
    };
  }
  for (const candidate of unique) {
    if (isEqual(keys, candidate)) {
      return {
        type: 'unique',
        match: candidate,
      };
    }
  }
  return undefined;
}

/**
 * Determines whether or not the cached value should be used instead of calling out to the database.
 * Contractually, we only guarantee that this function does not throw an exception and will only
 * return true if it's safe to make use of the cache.
 *
 * @param model the model being queried
 * @param keys the supported keys to query against
 * @param id the identifier being queried
 * @param options the options provided with the query
 * @returns true if the cache can be used, otherwise false
 */
export function shouldUseCache<M extends Model>(
  model: ModelStatic<M>,
  keys: ModelKeyLookup,
  id?: Identifier,
  options?: FindOptions<Attributes<M>>
): boolean {
  // Leveraging the cache is currently opt-in.
  if (!options?.cache) {
    return false;
  }

  const cacheOpt = normalizeCacheOptions(options);

  if (cacheOpt.enabled !== true) {
    return false;
  }

  // Caching is unavailable if you use scopes.
  if ('scoped' in model && model.scoped) {
    if (cacheOpt.fallback === 'fail') {
      throw new NonconformantQueryError('model is scoped');
    } else {
      return false;
    }
  }

  // Caching is unavailable if you use any other options besides where or attributes.
  const permittedKeys = Object.freeze(['where', 'attributes', 'cache'] as const);
  const optionKeys = Object.keys(options);
  const notPermitted = difference(optionKeys, permittedKeys);

  if (notPermitted.length > 0) {
    if (cacheOpt.fallback === 'fail') {
      throw new NonconformantQueryError(`unsupported options: ${notPermitted.join(', ')}`);
    } else {
      return false;
    }
  }

  // If we're using an identifier, we're good at this point.
  if (id) {
    return true;
  }

  const whereKeys = Object.keys(options?.where ?? {}).sort();
  const values = Object.values(options?.where ?? {});

  // If we're using where, we only allow use of the cache if you're filtering by the primary
  // key or one of the specified unique keys.
  // If you're using a Sequelize operator, it _must_ be eq.
  if (
    keysMatchCandidates(whereKeys, keys) &&
    values.every(
      (v) =>
        isString(v) ||
        isNumber(v) ||
        typeof v === 'bigint' ||
        (isObjectLike(v) && isEqual(Reflect.ownKeys(v as object), [Op.eq]))
    )
  ) {
    return true;
  }

  // We didn't meet the above conditions, so we won't use the cache.
  if (cacheOpt.fallback === 'fail') {
    throw new NonconformantQueryError('Invalid where condition');
  } else {
    return false;
  }
}

function normalizeCacheOptions(options?: FindOptions<Model<any>>): FindCacheOptions {
  if (!options?.cache) {
    return {
      enabled: false,
    };
  } else if (isBoolean(options.cache)) {
    return { enabled: options.cache, fallback: 'database' };
  } else {
    return options.cache;
  }
}

// This is for tests only.
export function clearCachedModels() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  (SequelizeCache as any).cachedModels = new WeakSet();
}
