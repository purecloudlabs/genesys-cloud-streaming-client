"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const tslib_1 = require("tslib");
const axios_1 = tslib_1.__importStar(require("axios"));
const utils_1 = require("./utils");
const correlationIdHeaderName = 'inin-correlation-id';
class HttpClient {
    constructor(httpClientOptions) {
        this._httpRetryingRequests = new Map();
        this.customHeaders = httpClientOptions === null || httpClientOptions === void 0 ? void 0 : httpClientOptions.customHeaders;
    }
    requestApiWithRetry(path, opts, retryInterval) {
        const maxRetries = opts.maxAttempts || 10;
        let retryCount = 0;
        const retry = (0, utils_1.retryPromise)(this.requestApi.bind(this, path, opts), (error) => {
            var _a, _b, _c;
            retryCount++;
            if (retryCount >= maxRetries) {
                (opts.logger || console).info('Max retries reached, will not retry.', { maxRetries, retryCount, path });
                return false;
            }
            let retryValue = false;
            if (error === null || error === void 0 ? void 0 : error.response) {
                retryValue = HttpClient.retryStatusCodes.has(error.response.status || 0);
                // This *should* be an axios error according to typings, but it appears this could be an AxiosError *or* and XmlHttpRequest
                // we'll check both to be safe
                const retryAfter = ((_a = error.response.headers) === null || _a === void 0 ? void 0 : _a['retry-after']) || ((_c = (_b = error.response).getResponseHeader) === null || _c === void 0 ? void 0 : _c.call(_b, 'retry-after'));
                if (retryAfter) {
                    (opts.logger || console).debug('retry-after header found on response. setting retry delay', { retryAfter });
                    // retry after comes in seconds, we need to return milliseconds
                    retryValue = parseInt(retryAfter, 10) * 1000;
                }
            }
            // Check network error codes independently - error may have both response (with status 0) and a network error code.
            if ((error === null || error === void 0 ? void 0 : error.code) && retryValue === false) {
                // Retry on network error codes - request didn't make it to the server or no response was received
                if (HttpClient.retryNetworkErrorCodes.has(error.code)) {
                    (opts.logger || console).debug('Retry network error code found, will retry.', { code: error.code });
                    retryValue = true;
                }
            }
            return retryValue;
        }, retryInterval, opts.logger);
        this._httpRetryingRequests.set(retry._id, retry);
        retry.promise.then(() => this.cancelRetryRequest(retry._id), () => this.cancelRetryRequest(retry._id));
        return retry;
    }
    requestApi(path, opts) {
        const logger = opts.logger || console;
        const start = new Date().getTime();
        opts.customHeaders = {
            ...(this.customHeaders || {}),
            ...(opts.customHeaders || {})
        };
        const url = this._buildUri(opts.host, path, opts.version);
        const headers = {
            'content-type': opts.contentType || 'application/json',
            ...opts.customHeaders
        };
        const params = {
            method: opts.method,
            url,
            data: opts.data,
            responseType: opts.responseType,
            timeout: opts.requestTimeout || 30000,
            headers,
            signal: opts.signal
        };
        // default to include auth header
        if (!opts.noAuthHeader) {
            params.headers.Authorization = `Bearer ${opts.authToken}`;
        }
        const boundHandler = this.handleResponse.bind(this, logger, start, params);
        return (0, axios_1.default)(params)
            .then(boundHandler, boundHandler);
    }
    handleResponse(logger, start, params, res) {
        var _a, _b, _c;
        const now = new Date().getTime();
        const elapsed = (now - start) + 'ms';
        if (res instanceof axios_1.AxiosError) {
            // sanitize the auth token
            if ((_b = (_a = res.config) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b.Authorization) {
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
            const response = res.response || {};
            const status = response.status;
            const correlationId = response.headers && response.headers[correlationIdHeaderName];
            const body = response.data;
            const error = {
                ...res,
                text: (_c = response.request) === null || _c === void 0 ? void 0 : _c.response
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
        const status = res.status;
        const correlationId = res.headers[correlationIdHeaderName];
        const body = JSON.stringify(res.data);
        logger.debug(`response: ${params.method.toUpperCase()} ${params.url}`, {
            now,
            status,
            elapsed,
            correlationId,
            body
        }, { skipServer: true });
        return Promise.resolve(res);
    }
    stopAllRetries() {
        Array.from(this._httpRetryingRequests.keys())
            .forEach(key => this.cancelRetryRequest(key));
    }
    cancelRetryRequest(retryId) {
        const value = this._httpRetryingRequests.get(retryId);
        if (value) {
            /* if the promise has already completed, this will do nothing. Still need to remove it from the map */
            value.cancel(new Error('Retry request cancelled'));
            this._httpRetryingRequests.delete(retryId);
        }
        return true;
    }
    formatRequestError(error) {
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
    isSuperagentNetworkError(error) {
        return (error &&
            // these properties may have the value of `undefined` but they will still be set
            error.hasOwnProperty('status') &&
            error.hasOwnProperty('method') &&
            error.hasOwnProperty('url'));
    }
    isSuperagentResponseError(error) {
        return !!(error &&
            error.response &&
            error.response.body &&
            error.response.req);
    }
    _buildUri(host, path, version = 'v2') {
        path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
        if (host.indexOf('http') === 0) {
            return `${host}/api/${version}/${path}`;
        }
        return `https://api.${host}/api/${version}/${path}`;
    }
}
exports.HttpClient = HttpClient;
HttpClient.retryStatusCodes = new Set([
    408,
    413,
    429,
    500,
    502,
    503,
    504
]);
HttpClient.retryNetworkErrorCodes = new Set([
    'ECONNABORTED',
    'ECONNRESET',
    'ERR_NETWORK',
    'ETIMEDOUT'
]);
