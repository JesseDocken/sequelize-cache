export class CacheUnavailableError extends Error {
  constructor(options: { cause: Error }) {
    super('Redis is not connected', options);
  }
}
