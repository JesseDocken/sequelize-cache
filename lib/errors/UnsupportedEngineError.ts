export class UnsupportedEngineError extends Error {
  constructor(provided: object) {
    super(`Cache database type ${provided.constructor.name} is not supported. Only Redis is currently supported.`);
  }
}
