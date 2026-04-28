export class CouldNotBuildIdentifierError extends Error {
  constructor(reason: string) {
    super(reason);
  }
}
