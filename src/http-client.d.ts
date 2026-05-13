import { RetryPromise } from './utils';
import { RequestApiOptions, ISuperagentNetworkError, ISuperagentResponseError, INetworkError, IResponseError, ICustomHeader, IHttpClientOptions } from './types/interfaces';
export declare class HttpClient {
    customHeaders?: ICustomHeader;
    private _httpRetryingRequests;
    static retryStatusCodes: Set<number>;
    static retryNetworkErrorCodes: Set<string>;
    constructor(httpClientOptions?: IHttpClientOptions);
    requestApiWithRetry<T = any>(path: string, opts: RequestApiOptions, retryInterval?: number): RetryPromise<T>;
    requestApi(path: string, opts: RequestApiOptions): Promise<any>;
    private handleResponse;
    stopAllRetries(): void;
    cancelRetryRequest(retryId: string): true;
    formatRequestError(error: Error | ISuperagentNetworkError | ISuperagentResponseError): Error | INetworkError | IResponseError;
    private isSuperagentNetworkError;
    private isSuperagentResponseError;
    private _buildUri;
}
