export interface ILogger {
  debug(data: string | Record<string, unknown>, ...args: unknown[]): void;
  info(data: string | Record<string, unknown>, ...args: unknown[]): void;
  warn(data: string | Record<string, unknown>, ...args: unknown[]): void;
  error(data: string | Record<string, unknown>, ...args: unknown[]): void;
}
