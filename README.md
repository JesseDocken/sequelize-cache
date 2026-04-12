# Sequelize Cache

[![npm version](https://img.shields.io/npm/v/sequelize-cache.svg)](https://www.npmjs.com/package/sequelize-cache)
[![CI](https://github.com/JesseDocken/sequelize-cache/actions/workflows/ci.yml/badge.svg)](https://github.com/JesseDocken/sequelize-cache/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A caching layer for [Sequelize](https://sequelize.org/) models backed by high-performance caching datastores such as Redis. Cache management is designed to be seamless and work transparently in your application on an opt-in basis, and the library is designed to never break your application — cache failures fall back gracefully to the database.

## Installation

*Note:* You must be running in Node 20 or higher.

```bash
npm install sequelize-cache
```

### Peer Dependencies

The only required peer dependency is a cache engine. Currently, Redis is supported via [ioredis](https://github.com/redis/ioredis):

```bash
npm install ioredis
```

The following optional peer dependencies enable additional features:

| Package | Purpose |
|---------|---------|
| `prom-client` | Prometheus metrics |
| `@opentelemetry/api` | OpenTelemetry metrics |
| `pino` | Library logging |
| `winston` | Library logging |
| `debug` | Debug-level logging (used automatically as a fallback if no structured logger is provided) |

## Quick Start

```typescript
import { Sequelize, DataTypes, Model } from 'sequelize';
import Redis from 'ioredis';
import { SequelizeCache } from 'sequelize-cache';

// Set up Sequelize and Redis as usual
const sequelize = new Sequelize('sqlite::memory:');
const redis = new Redis();

// Initialize the cache
const cache = new SequelizeCache({
  engine: {
    type: 'redis',
    connection: redis,
  },
});

// Define a model (also supports sequelize-typescript models)
class User extends Model {
  declare id: number;
  declare username: string;
  declare email: string;
}

User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false },
}, { sequelize, modelName: 'User' });

// Enable caching for the model
cache.cacheModel(User, {
  uniqueKeys: [['username'], ['email']],
});
```

## Usage

### Opting Into the Cache

Cache usage is opt-in per query via the `cache` option on `findByPk` and `findOne`. Queries without the `cache` option always go directly to the database.

```typescript
// Cache lookup by primary key
const user = await User.findByPk(1, {
  cache: { enabled: true, fallback: 'database' },
});

// Cache lookup by unique key
const user = await User.findOne({
  where: { username: 'alice' },
  cache: { enabled: true, fallback: 'database' },
});

// Shorthand: cache: true is equivalent to { enabled: true, fallback: 'database' }
const user = await User.findByPk(1, { cache: true });
```

### Cache Options

The `cache` option accepts either a boolean or an object:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | — | Whether to use the cache for this query |
| `fallback` | `'database' \| 'fail'` | `'database'` | What to do if the cache is unavailable. `'database'` falls back to a normal Sequelize query. `'fail'` throws a `CacheUnavailableError`. |

### Supported Queries

The cache supports lookups by primary key (single or composite) and by unique key groups specified during `cacheModel` configuration. The `where` clause must exactly match one of these key groups — partial matches or queries with additional operators (other than `Op.eq`) will bypass the cache.

The `attributes` option is permitted on cached queries, but cached results always return the full model regardless of what attributes are specified. The cache does not filter attributes, and specifying `attributes` will not affect which attributes are stored in the cache.

Options such as `include`, `order`, `limit`, and `group` are not compatible with caching. If these options are present, the query will fall back to the database.

Scoped models are not currently compatible with caching and will always bypass the cache.

For any query that is unsupported, the cache will honor the `fallback` rule configured. If set to `database` or left unconfigured, the query will be executed against the database directly. If set to `fail`, an error will be thrown instead.

### Automatic Invalidation

When caching is enabled for a model, Sequelize hooks are automatically registered to invalidate cached entries when instances are updated or destroyed:

```typescript
// This automatically invalidates the cached entry for this user
await user.update({ email: 'newemail@example.com' });

// This also invalidates the cached entry
await user.destroy();
```

Bulk operations (`bulkUpdate`, `bulkDestroy`) will invalidate all cached entries for the model as a precaution, since the library cannot determine which specific instances were affected without `individualHooks` enabled.

### Model Configuration

```typescript
cache.cacheModel(User, {
  // Unique key groups that can be used for cache lookups.
  // Each array represents a group of columns that together form a unique key.
  uniqueKeys: [['username'], ['email']],

  // Optional hook called when a cached model is retrieved
  hooks: {
    getOne: async (user) => {
      // e.g., track access, populate virtual fields, perform side effects
    },
  },
  // Optional time-to-live for cached model instances (in seconds, defaults to 1 hour)
  ttl: 3600,
});
```

**Note:** `cacheModel` should only be called once per model. Calling it a second time on the same model will throw an error.

### Global Configuration

```typescript
const cache = new SequelizeCache({
  // Required: the backing cache engine
  engine: {
    // The type of cache engine to be used
    type: 'redis',
    // Required: the connection to the cache engine
    connection: redis,
  },
  // Optional: configuration for cache key namespacing
  caching: {
    // A namespace prefix for all cache keys. Useful when multiple applications
    // share the same Redis instance or the Redis instance is used for multiple
    // purposes. Defaults to `modelcache`.
    namespace: 'myapp',
  },
});
```

## Time-to-Live (TTL)

Cached model instances expire after a configurable time-to-live. The default TTL is 3600 seconds (1 hour). TTL is currently set once during hydration and is not refreshed on subsequent cache hits.

## Error Handling

The library follows a consistent error contract designed to ensure that caching never breaks your application:

**Cache reads** only fail if you explicitly opt into failure via `fallback: 'fail'`. With the default `fallback: 'database'`, any cache error results in a transparent fallback to the database.

**Cache writes** (storing a hydrated value after a cache miss) are best-effort. If Redis is unavailable or the write fails, the value is still returned to the caller but won't be cached for subsequent requests until the next attempt.

**Cache invalidation** is best-effort and will never cause a database transaction to roll back. If invalidation fails, the stale entry will remain in the cache until its TTL expires.

### Error Types

| Error | When it's thrown |
|-------|-----------------|
| `CacheUnavailableError` | Thrown on cache read when `fallback: 'fail'` and Redis is unavailable or returns an error |
| `UnsupportedEngineError` | Thrown during initialization if the `engine` option is not recognized |

## Logging

The library supports structured logging via Pino or Winston, and falls back to the `debug` module if neither is provided. If none of these are available, logging is disabled.

### Pino

```typescript
import pino from 'pino';

const logger = pino({ level: 'debug' });

const cache = new SequelizeCache({
  engine: {},
  logger,
});
```

### Winston

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

const cache = new SequelizeCache({
  engine: {},
  logger,
});
```

### Debug Module

If no logger is provided but the `debug` package is installed, the library automatically uses it under the `sequelize-cache` namespace:

```bash
DEBUG=sequelize-cache node app.js
```

## Metrics

The library supports metrics collection via Prometheus (`prom-client`) or OpenTelemetry. If no metrics provider is configured, metrics are silently disabled.

### Prometheus

```typescript
import { Registry } from 'prom-client';

const registry = new Registry();

const cache = new SequelizeCache({
  engine: {},
  metrics: registry,
});
```

### OpenTelemetry

```typescript
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('my-application');

const cache = new SequelizeCache({
  engine: {},
  metrics: meter,
});
```

### Provided Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `sequelize_model_cache_lookup` | Counter | `model`, `method`, `target` | Number of lookups and whether they hit the cache or database |
| `sequelize_model_cache_lookup_duration_seconds` | Histogram | `model`, `method`, `target` | Query lookup duration (both cache and database) |
| `hydrate_cache_miss` | Counter | `component` | Number of cache misses that triggered hydration |
| `cache_operation` | Counter | `component`, `operation` | Number of cache engine operations (get, set, del, etc.) |
| `cache_operation_duration_seconds` | Histogram | `component`, `operation` | Cache engine operation duration |
| `cache_operation_error` | Counter | `component`, `operation` | Number of failed cache engine operations |

## License

[This code is licensed under the MIT license.](LICENSE)