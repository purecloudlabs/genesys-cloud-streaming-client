import request from 'superagent';

import reqlogger from './request-logger';
import { RetryPromise, retryPromise } from './utils';
import {
  RequestApiOptions,
  ISuperagentNetworkError,
  ISuperagentResponseError,
  IError,
  INetworkError,
  IResponseError
} from './types/interfaces';

export class HttpClient {
  private _httpRetryingRequests = new Map<string, RetryPromise<any>>();

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

    this._httpRetryingRequests.set(request._id, request);

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

    return response.send(opts.data) // trigger request
      .catch(err => { throw this.formatRequestError(err); });
  }

  stopAllRetries (): void {
    Array.from(this._httpRetryingRequests.keys())
      .forEach(key => this._cancelAndRemoveValueFromRetryMap(key));
  }

  formatRequestError (error: Error | ISuperagentNetworkError | ISuperagentResponseError): IError | INetworkError | IResponseError {
    /* if network error */
    if (this.isSuperagentNetworkError(error)) {
      return {
        status: error.status,
        method: error.method,
        url: error.url,
        crossDomain: error.crossDomain,
        message: error.message,
        name: error.name,
        stack: error.stack
      };
    }

    /* if superagent response error */
    if (this.isSuperagentResponseError(error)) {
      const res = error.response;
      return {
        status: error.status,

        correlationId: res.headers['inin-correlation-id'],
        responseBody: res.text,

        method: res.req.method,
        requestBody: res.req._data,

        url: res.error.url,
        message: res.error.message,
        name: res.error.name,
        stack: res.error.stack
      };
    }

    /* if we don't have a superagent error */
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }

  private isSuperagentNetworkError (error: any | ISuperagentNetworkError): error is ISuperagentNetworkError {
    return (
      error &&
      // these properties may have the value of `undefined` but they will still be set
      error.hasOwnProperty('status') &&
      error.hasOwnProperty('method') &&
      error.hasOwnProperty('url')
    );
  }

  private isSuperagentResponseError (error: any | ISuperagentNetworkError): error is ISuperagentResponseError {
    return !!(
      error &&
      error.response &&
      error.response.body &&
      error.response.req
    );
  }

  private _buildUri (host: string, path: string, version = 'v2') {
    path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
    if (host.indexOf('http') === 0) {
      return `${host}/api/${version}/${path}`;
    }
    return `https://api.${host}/api/${version}/${path}`;
  }

  private _cancelAndRemoveValueFromRetryMap (key: string): true {
    const value = this._httpRetryingRequests.get(key);
    if (value) {
      value.cancel(new Error('Retry request cancelled'));
      this._httpRetryingRequests.delete(key);
    }
    return true;
  }
}
