# Contributing to sequelize-model-cache

Thank you for your interest in contributing! This document explains how to set up the project for local development, run the test suite, and submit changes.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or higher
- [Docker](https://www.docker.com/) and Docker Compose (for integration tests)
- npm (included with Node.js)

## Getting Started

Fork the repository, clone your fork, and install dependencies:

```bash
git clone https://github.com/<your username>/sequelize-model-cache.git
cd sequelize-model-cache
npm install
```

## Running the Tests

### Unit Tests

Unit tests do not require any external services and can be run immediately:

```bash
npm run test:unit
```

### Integration Tests

Integration tests run against a real Redis instance. You can automatically spin up Redis via Docker Compose using the appropriate NPM script:

```bash
npm run test:integration:docker
```

By default, integration tests connect to Redis at `redis://localhost:6379`. You can override this by setting the `REDIS_URL` environment variable:

```bash
REDIS_URL=redis://custom-host:6380 npm run test:integration
```

### Full Suite

To run all tests:

```bash
docker compose up -d
npm test
docker compose down
```

### Watch Mode

For active development, vitest can re-run tests on file changes:

```bash
npm run test:watch
```

Note that watch mode will run both unit and integration tests, so Redis should be running.

## Linting

The project uses ESLint for code quality. Run the linter with:

```bash
npm run lint
```

To auto-fix issues where possible:

```bash
npm run lint:fix
```

## Building

To compile TypeScript:

```bash
npm run build
```

The compiled output goes to `dist/`. You can verify the build is clean by running:

```bash
npm run clean && npm run build
```

## Project Structure

```
sequelize-model-cache/
├── index.ts                     # Package entry point
├── lib/
│   ├── index.ts                 # SequelizeCache class, findByPk/findOne overrides
│   ├── SequelizeModelCache.ts   # Per-model cache logic, key encoding/decoding
│   ├── peers.ts                 # Logger and metrics provider resolution
│   ├── metrics.ts               # Metric definitions
│   └── engines/
│       ├── EngineClient.ts      # Abstract cache engine interface
│       └── RedisClient.ts       # Redis implementation
├── test/
│   ├── unit/                    # Unit tests (mirrors lib/ structure)
│   └── integration/             # Integration tests (organized by functional area)
└── sequelize-cached-model.d.ts  # Sequelize type augmentations
```

## Submitting Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes following the guidelines below.
3. Ensure all tests pass and linting is clean.
4. Open a pull request against `main`. The PR template will guide you through the submission checklist.

### Guidelines

**Testing.** All changes should have adequate test coverage. Unit tests should cover the logic in isolation; integration tests should cover the behavior end-to-end against real services. If you're adding a new code path, add tests for both the happy path and failure cases.

**Type safety.** All new code should be properly typed. Avoid `any` unless there is a clear justification, and document the reason with a comment if you do use it.

**Documentation.** Add JSDoc comments to any new public or internal APIs. If your change affects user-facing behavior, update the README or other relevant documentation.

**Observability.** New operations should emit appropriate metrics and log messages. Follow the existing patterns:

- Use `debug` level for routine operations (cache hits, key lookups)
- Use `info` level for significant state changes (key set in cache)
- Use `warn` level for recoverable failures (invalidation failed for non-connectivity reasons)
- Use `error` level for unexpected failures

**Error handling.** Follow the established error contract:

- Cache reads respect the consumer's `fallback` preference
- Cache writes are best-effort and never surface errors to the caller
- Cache invalidation is best-effort and never causes transaction rollbacks
- All failures should be observable via metrics and logs

**Backward compatibility.** Avoid breaking changes to the public API. If a breaking change is necessary, clearly document it in your PR description and the changelog.

## Reporting Issues

If you find a bug, please open an issue using the bug report template. If you have a feature idea, use the feature request template.

For security vulnerabilities, please see [SECURITY.md](SECURITY.md) for responsible disclosure instructions.
