import request from 'superagent';

import reqlogger from './request-logger';
import { RetryPromise, retryPromise } from './utils';

export type RequestApiOptions = {
  method?: string;
  data?: any;
  host: string;
  version?: string;
  contentType?: string;
  authToken?: string;
  logger?: any
};

export class HttpClient {
  private _apiRequestsMap = new Map<string, RetryPromise<any>>();

  static retryStatusCodes = new Set([
    408,
    413,
    429,
    500,
    502,
    503,
    504
  ]);

  async requestApiWithRetry (path: string, opts: RequestApiOptions, retryInterval?: number): Promise<any> {
    const request = retryPromise<any>(
      this.requestApi.bind(this, path, opts),
      (error: any) => error && HttpClient.retryStatusCodes.has(error.status),
      retryInterval
    );

    this._apiRequestsMap.set(request._id, request);

    try {
      const result = await request.promise;
      return result;
    } finally {
      this._cancelAndRemoveValueFromRetryMap(request._id);
    }
  }

  requestApi (path: string, opts: RequestApiOptions): Promise<any> {
    let response = request[opts.method](this._buildUri(opts.host, path, opts.version))
      .use(reqlogger.bind(this, opts.logger, opts.data))
      .set('Authorization', `Bearer ${opts.authToken}`)
      .type(opts.contentType || 'json');

    return response.send(opts.data); // trigger request
  }

  stopAllRetries (): void {
    Array.from(this._apiRequestsMap.keys())
      .forEach(key => this._cancelAndRemoveValueFromRetryMap(key));
  }

  private _buildUri (host: string, path: string, version = 'v2') {
    path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
    if (host.indexOf('http') === 0) {
      return `${host}/api/${version}/${path}`;
    }
    return `https://api.${host}/api/${version}/${path}`;
  }

  private _cancelAndRemoveValueFromRetryMap (key: string): true {
    const value = this._apiRequestsMap.get(key);
    if (value) {
      value.cancel(new Error('Retry request cancelled'));
      this._apiRequestsMap.delete(key);
    }
    return true;
  }
}
