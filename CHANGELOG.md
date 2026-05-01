# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**This project is in early development.** The API is stabilizing but not yet guaranteed. Per semver, all 0.x releases may contain breaking changes in any minor version bump.

## [Unreleased]

## [0.5.1] - 2026-05-01

### Added

- Redis engine support for models
- Opt-in cache usage per query via `cache` option on `findByPk` and `findOne`
- Support for primary key and unique key lookups (both single and composite)
- Automatic cache invalidation via Sequelize hooks
- Configurable TTL per model (default: 1 hour)
- Configurable fallback behavior (`'database'` or `'fail'`) when the cache is unavailable
- Boolean shorthand for cache option (`cache: true`)
- Structured logging support via Pino or Winston, with `debug` module fallback
- Metrics support via Prometheus (`prom-client`) or OpenTelemetry
- Cache key namespacing to avoid collisions in shared Redis instances
- Type-safe serialization and deserialization for all Sequelize data types including BigInt, Date, and BIT fields
