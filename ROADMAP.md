# Roadmap

Outlined here are the next major features planned to be implemented in Sequelize Cache in the future. Each of the items listed below are listed in planned priority order; see the [roadmap](https://github.com/users/JesseDocken/projects/1/views/1) on Github for the latest version of the roadmap.

## Cache Key Deduplication (Pointer/Alias Keys)

Currently, looking up the same model by primary key and by a unique key results in two independent cache entries with no linkage between them. This means redundant database hits, duplicated memory usage, and potentially incomplete invalidation: clearing one key does not affect the other.

The planned approach is for the cached model to be stored under a pointer key that both the primary key and unique keys point to. This deduplicates model data stored in the cache and simplifies the invalidation strategy.

This is a prerequisite for several downstream features, as it changes the fundamental key structure and invalidation semantics.

## Memcached Support

Add memcached as a supported cache engine alongside Redis. Memcached does note that it is not meant to be as scalable, but is useful for smaller sites/applications.

## Improve `invalidateAll` Strategy

With the current implementation, `invalidateAll` uses `SCAN` + `UNLINK` in a loop, which is O(n) on the keyspace and has a safety bail-out at 10,000 iterations that may leave keys behind. Once the pointer/alias key structure is in place, this should be revisited — for example, using a generation or version prefix in the cache key so that "invalidate all" becomes an O(1) version increment, with old keys either expiring naturally via TTL or being cleaned up opportunistically.

## TTL Refresh on Cache Hit

Currently, TTL is set once during hydration and never extended, meaning frequently-read keys expire at the same rate as rarely-read ones. Once pointer/alias keys are implemented, TTL refresh on read becomes straightforward: refresh the primary key entry's TTL on any hit (direct or via pointer). This will be configurable to let consumers choose between bounded staleness and hot-key longevity.

## Cache Stampede Protection

Currently when a model is being hydrated into the cache, it's possible that another query will be executed that will attempt to load the same model from the cache. This results in the model being loaded from the database multiple times, which could induce unexpectedly high database load depending on the database backend.

We need to explore a way to ensure that we avoid hitting the database too frequently for the same query when the cache is being populated. Ideally this should leverage distributed locking but will require further exploration (particularly with memcached).

This is a prerequisite for batch lookups.

## Batch Lookups

Support `findAll`-style queries with certain guardrails in place to prevent excessive models from being stored. This requires some exploration, but will allow for more use cases to leverage the cache. This requires stampede protection to be in place, since a batch miss on many keys simultaneously could otherwise cause significant database load.

## Scoped Model Support

Currently, `shouldUseCache` rejects scoped models entirely — if `scope()` has been called on a model, the cache is bypassed. Supporting scopes would require incorporating the active scope into the cache key so that differently-scoped queries don't collide, and ensuring invalidation accounts for all scope variants of a cached instance.

## Configurable Serialization

JSON serialization is currently hardcoded in `RedisClient`. Some consumers may benefit from alternative formats for reduced payload size or faster serialization. This would involve making the serialization strategy pluggable, either via the `GlobalCacheOptions` or per-model configuration.
