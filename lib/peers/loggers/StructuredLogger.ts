import type { GlobalCacheOptions } from '../../SequelizeCache';
import type { ILogger } from '../ILogger';

import { format } from 'node:util';

export class StructuredLogger implements ILogger {
  #logger: {
    debug(...args: unknown[]): unknown;
    info(...args: unknown[]): unknown;
    warn(...args: unknown[]): unknown;
    error(...args: unknown[]): unknown;
  };

  constructor(logger: GlobalCacheOptions['logger']) {
    this.#logger = logger!;
  }

  debug(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.debug(format(data, ...args));
    } else {
      this.#logger.debug(data);
    }
  }

  info(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.info(format(data, ...args));
    } else {
      this.#logger.info(data);
    }
  }

  warn(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.warn(format(data, ...args));
    } else {
      this.#logger.warn(data);
    }
  }

  error(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#logger.error(format(data, ...args));
    } else {
      this.#logger.error(data);
    }
  }
}
