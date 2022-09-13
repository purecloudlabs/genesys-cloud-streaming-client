import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

import { RetryPromise, retryPromise } from './utils';
import {
  RequestApiOptions,
  ISuperagentNetworkError,
  ISuperagentResponseError,
  INetworkError,
  IResponseError,
  IAxiosResponseError
} from './types/interfaces';

const correlationIdHeaderName = 'inin-correlation-id';

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

  requestApiWithRetry<T = any> (path: string, opts: RequestApiOptions, retryInterval?: number): RetryPromise<T> {
    const retry = retryPromise<T>(
      this.requestApi.bind(this, path, opts),
      (error: any) => {
        return error && error.response && HttpClient.retryStatusCodes.has(error.response.status);
      },
      retryInterval,
      opts.logger
    );

    this._httpRetryingRequests.set(retry._id, retry);

    /* tslint:disable:no-floating-promises */
    retry.promise.then(
      () => this.cancelRetryRequest(retry._id),
      () => this.cancelRetryRequest(retry._id)
    );

    return retry;
  }

  requestApi (path: string, opts: RequestApiOptions): Promise<any> {
    const logger = opts.logger || console;
    const start = new Date().getTime();

    const url = this._buildUri(opts.host, path, opts.version);

    const params: AxiosRequestConfig = {
      method: opts.method,
      url,
      data: opts.data,
      headers: {
        'content-type': opts.contentType || 'application/json'
      }
    };

    // default to include auth header
    if (!opts.noAuthHeader) {
      params.headers!['Authorization'] = `Bearer ${opts.authToken}`;
    }

    const handleResponse = (res: AxiosResponse): Promise<AxiosResponse> => {
      let now = new Date().getTime();
      let elapsed = (now - start) + 'ms';

      if (res instanceof AxiosError) {
        /* istanbul ignore next */
        const response = res.response || {} as any;
        let status = response.status;
        let correlationId = response.headers?.[correlationIdHeaderName];
        let body = response.data;
        let error: IAxiosResponseError = {
          ...res,
          text: response.request.response
        };

        logger.debug(`request error: ${params.url}`, {
          message: res.message,
          now,
          elapsed,
          status,
          correlationId,
          body
        }, true);

        return Promise.reject(error);
      }

      let status = res.status;
      let correlationId = res.headers[correlationIdHeaderName];
      let body = JSON.stringify(res.data);

      logger.debug(`response: ${opts.method.toUpperCase()} ${params.url}`, {
        now,
        status,
        elapsed,
        correlationId,
        body
      }, true);

      return Promise.resolve(res);
    };

    return axios(params)
      .then(handleResponse.bind(this), handleResponse.bind(this));
  }

  stopAllRetries (): void {
    Array.from(this._httpRetryingRequests.keys())
      .forEach(key => this.cancelRetryRequest(key));
  }

  cancelRetryRequest (retryId: string): true {
    const value = this._httpRetryingRequests.get(retryId);
    if (value) {
      /* if the promise has already completed, this will do nothing. Still need to remove it from the map */
      value.cancel(new Error('Retry request cancelled'));
      this._httpRetryingRequests.delete(retryId);
    }
    return true;
  }

  formatRequestError (error: Error | ISuperagentNetworkError | ISuperagentResponseError): Error | INetworkError | IResponseError {
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
        // Potentially could contain PII
        // responseBody: res.text,
        // requestBody: res.req._data,
        // url: res.error.url,
        message: 'Error making HTTP request', // res.error.message,

        method: res.req.method,

        name: res.error.name,
        stack: res.error.stack
      };
    }

    /* if we don't have a superagent error */
    return error;
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
}
