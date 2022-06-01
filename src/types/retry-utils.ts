import { v4 } from 'uuid';
import WildEmitter from 'wildemitter';

export interface IRetryConfig<T = any> {
  /**
   * Function to attempt until it completes or rejects based on the
   *  criteria for retrying.
   */
  promiseFn: () => Promise<T>;
  /**
   * Retry criteria to retry the promise function on failure. Available options:
   * - `boolean`: if `true`, it will _always_ be retried. if `false`, it will _never_
   *  be retried.
   * - `number`: max attempts to retry
   * - `function`: a function that accepts the error thrown and determines if it
   *  should be retried. It will be passed the `Error` and the `attemptCount`.
   *
   * Default: `false`
   */
  retry?: boolean | number | ((error?: Error | any, attemptCount?: number) => boolean);
  /**
   * Milliseconds to wait inbetween next retry of the promise function on failure.
   *
   * Default: `15000`
   */
  retryInterval?: number;
}

type Required<T> = {
  [P in keyof T]-?: T[P]
};

export class RetryPromise<T = any> extends WildEmitter {
  promise: Promise<T>;
  _id = v4();

  private _reject!: (reason?: string | Error | any) => void;
  private _resolve!: (value: T | PromiseLike<T>) => void;
  private _hasCompleted = false;
  private _attemptCount = 0;
  private _timeout: any;
  private _config: Required<IRetryConfig>;

  constructor (config: IRetryConfig) {
    super();
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    this._config = {
      promiseFn: config.promiseFn,
      retry: config.retry || false,
      retryInterval: config.retryInterval !== undefined && config.retryInterval > -1 ? config.retryInterval : 15000
    };

    /* tslint:disable:no-floating-promises */
    this._tryPromiseFn();
  }

  /**
   * @deprecated use `reject(reason)`
   * @param reason value to reject the promise with
   * @returns void
   */
  cancel (reason?: string | Error | any): void {
    return this.reject(reason);
  }

  reject (reason?: string | Error | any): void {
    this._reject(reason);
    clearTimeout(this._timeout);
    this._hasCompleted = true;
    this.emit('rejected', reason);
  }

  /**
   * @deprecated use `resolve(reason)`
   * @param value to resolve the promise with
   * @returns void
   */
  complete (value: T | PromiseLike<T>) {
    return this.resolve(value);
  }

  resolve (value: T | PromiseLike<T>) {
    this._resolve(value);
    clearTimeout(this._timeout);
    this._hasCompleted = true;
    this.emit('resolved', value);
  }

  hasCompleted (): boolean {
    return this._hasCompleted;
  }

  attemptCount (): number {
    return this._attemptCount;
  }

  private async _tryPromiseFn (): Promise<void> {
    const { retry, retryInterval } = this._config;
    try {
      this._attemptCount++;

      this.emit('trying', {
        attemptCount: this._attemptCount,
        promise: this.promise
      });

      const val = await this._config.promiseFn();
      this.resolve(val);
    } catch (error: any) {
      if (
        /* always retry */
        retry === true ||
        /* retry if under max retry attempts */
        typeof retry === 'number' && this._attemptCount <= retry ||
        /* retry if retry function returns true */
        typeof retry === 'function' && retry(error, this._attemptCount + 1)
      ) {
        this.emit('retrying', {
          error,
          attemptCount: this._attemptCount,
          retryInterval
        });
        this._timeout = setTimeout(this._tryPromiseFn.bind(this), retryInterval);
        return;
      }

      this.reject(error);
    }
  }
}

export function retryPromise<T = any> (
  promiseFn: () => Promise<T>,
  retry?: boolean | number | ((error?: Error | any, attemptCount?: number) => boolean),
  retryInterval: number = 15000,
  _logger: any = console
): RetryPromise<T> {
  return new RetryPromise({ promiseFn, retry, retryInterval });
}
