export class NonconformantQueryError extends Error {
  constructor(reason: string) {
    super(`Query is nonconformant: ${reason}`);
  }
}
