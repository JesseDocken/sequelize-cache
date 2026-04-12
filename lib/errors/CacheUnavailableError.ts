export class CacheUnavailableError extends Error {
  constructor() {
    super('Redis is not connected');
  }
}
