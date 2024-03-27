import axios, { Axios, AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

import { RetryPromise, retryPromise } from './utils';
import {
  RequestApiOptions,
  ISuperagentNetworkError,
  ISuperagentResponseError,
  INetworkError,
  IResponseError,
  IAxiosResponseError
} from './types/interfaces';
import Logger from 'genesys-cloud-client-logger';

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
        let retryValue: boolean | number = false;

        if (error?.response) {
          retryValue = HttpClient.retryStatusCodes.has((error.response as XMLHttpRequest).status || 0);

          // This *should* be an axios error according to typings, but it appears this could be an AxiosError *or* and XmlHttpRequest
          // we'll check both to be safe
          const retryAfter = (error as AxiosError).response!.headers?.['retry-after'] || (error.response as XMLHttpRequest).getResponseHeader?.('retry-after');
          if (retryAfter) {
            (opts.logger || console).debug('retry-after header found on response. setting retry delay', { retryAfter });

            // retry after comes in seconds, we need to return milliseconds
            retryValue = parseInt(retryAfter, 10) * 1000;
          }
        }

        return retryValue;
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
      responseType: opts.responseType,
      timeout: opts.requestTimeout || 30000,
      headers: {
        'content-type': opts.contentType || 'application/json',
        'genesys-app': 'developercenter-cdn--streaming-client-webui'
      }
    };

    // default to include auth header
    if (!opts.noAuthHeader) {
      params.headers!['Authorization'] = `Bearer ${opts.authToken}`;
    }

    const boundHandler = this.handleResponse.bind(this, logger, start, params);

    return axios(params)
      .then(boundHandler, boundHandler);
  }

  private handleResponse (logger: Logger, start: number, params: AxiosRequestConfig, res: AxiosResponse): Promise<AxiosResponse> {
    let now = new Date().getTime();
    let elapsed = (now - start) + 'ms';
    if (res instanceof AxiosError) {
      // sanitize the auth token
      if (res.config?.headers?.Authorization) {
        res.config.headers.Authorization = 'redacted';
      }

      // handles request timeout
      if (res.code === 'ECONNABORTED') {
        logger.debug(`request error: ${params.url}`, {
          message: res.message,
          now,
          elapsed
        }, { skipServer: true });

        return Promise.reject(res);
      }

      /* istanbul ignore next */
      const response = res.response || {} as any;
      let status = response.status;
      let correlationId = response.headers && response.headers[correlationIdHeaderName];
      let body = response.data;
      let error: IAxiosResponseError = {
        ...res,
        text: response.request?.response
      };

      logger.debug(`request error: ${params.url}`, {
        message: res.message,
        now,
        elapsed,
        status,
        correlationId,
        body
      }, { skipServer: true });

      return Promise.reject(error);
    }

    let status = res.status;
    let correlationId = res.headers[correlationIdHeaderName];
    let body = JSON.stringify(res.data);

    logger.debug(`response: ${params.method!.toUpperCase()} ${params.url}`, {
      now,
      status,
      elapsed,
      correlationId,
      body
    }, { skipServer: true });

    return Promise.resolve(res);
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
