import { loadDebug } from '../../loadDebug';

import type { ILogger } from '../ILogger';

export class DebugLogger implements ILogger {
  #debug: (...args: unknown[]) => void;

  constructor() {
    this.#debug = loadDebug()('sequelize-cache');
  }

  debug(data: string | Record<string, unknown>, ...args: unknown[]) {
    if (typeof data === 'string') {
      this.#debug(data, ...args);
    } else {
      this.#debug('%O', data);
    }
  }

  info(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }

  warn(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }

  error(data: string | Record<string, unknown>, ...args: unknown[]) {
    this.debug(data, ...args);
  }
}
