export class RepositoryUnavailableError extends Error {
  constructor(model: string) {
    super(`Repository ${model} is temporarily unavailable`);
  }
}
