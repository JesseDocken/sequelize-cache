export class InvalidIdentifierError extends Error {
  constructor(reason: string) {
    super(`Cache identifier is invalid: ${reason}`);
  }
}
