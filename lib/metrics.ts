import type { ICounter, IHistogram, IMetricsProvider } from './peers/IMetricsProvider';

/**
 * Application-level metric definitions for the cache library. All metrics are
 * created eagerly from the provided `IMetricsProvider` - if no provider was
 * configured (or the provider is a noop), every metric is safe to call but
 * does nothing.
 */
export class AppMetrics {
  readonly provider: IMetricsProvider;
  readonly lookupCount: ICounter<'model' | 'method' | 'target'>;
  readonly lookupTime: IHistogram<'model' | 'method' | 'target'>;
  readonly hydrateCacheMiss: ICounter<'component'>;
  readonly cacheOperation: ICounter<'component' | 'operation'>;
  readonly cacheOperationDuration: IHistogram<'component' | 'operation'>;
  readonly cacheOperationError: ICounter<'component' | 'operation'>;

  constructor(provider: IMetricsProvider) {
    this.provider = provider;
    this.lookupCount = provider.createCounter(
      'sequelize_model_cache_lookup',
      'The number of times a cached model processed a lookup, and whether it hit the cache or database',
      ['model', 'method', 'target'],
    );

    this.lookupTime = provider.createHistogram(
      'sequelize_model_cache_lookup_duration_seconds',
      'How long it took to look up a model, either from the cache or database',
      ['model', 'method', 'target'],
    );

    this.hydrateCacheMiss = provider.createCounter(
      'hydrate_cache_miss',
      'The number of times a cache miss triggered hydration of a value',
      ['component'],
    );

    this.cacheOperation = provider.createCounter(
      'cache_operation',
      'Number of cache operations',
      ['component', 'operation'],
    );

    this.cacheOperationDuration = provider.createHistogram(
      'cache_operation_duration_seconds',
      'Duration of cache operations',
      ['component', 'operation'],
      [0.1, 0.5, 1, 2, 5, 10],
    );

    this.cacheOperationError = provider.createCounter(
      'cache_operation_error',
      'Number of cache operation errors',
      ['component', 'operation'],
    );
  }
}
