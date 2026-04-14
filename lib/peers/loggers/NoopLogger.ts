import type { ILogger } from '../ILogger';

export class NoopLogger implements ILogger {
  debug() { }
  info() { }
  warn() { }
  error() { }
}
