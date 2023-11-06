import nock from 'nock';

import { HttpClient } from '../../src/http-client';
import { wait } from '../helpers/testing-utils';
import { ILogger } from '../../src/types/interfaces';
import * as utils from '../../src/utils';
import AxiosMockAdapter from 'axios-mock-adapter';

import axios, { AxiosError, AxiosHeaders } from 'axios';

describe('HttpRequestClient', () => {
  let http: HttpClient;
  let logger: ILogger;

  beforeEach(() => {
    logger = {
      debug: jest.fn()
    } as any;
    http = new HttpClient();
  });

  afterEach(async () => {
    http.stopAllRetries();
    await Promise.resolve();
  });

  describe('requestApi()', () => {
    let axiosMock: AxiosMockAdapter;
    beforeEach(() => {
      axiosMock = new AxiosMockAdapter(axios);
    });

    describe('axios error without response', () => {
      let originalAdapter: any;

      afterAll(() => {
        axios.defaults.adapter = originalAdapter;
      });

      it('should handle axios errors without a response', async () => {
        const host = 'example.com';
        const path = 'users/me';

        try {
          const response = await http.requestApi(path, { host, method: 'get', requestTimeout: 1000 });
          fail('should have thrown');
        } catch (e) {
          expect(e).toBeTruthy();
        }
      });
    });

    it('should make a request with authorization header', async () => {
      const host = 'example.com';
      const path = 'users/me';

      const url = `https://api.${host}/api/v2/${path}`;
      axiosMock.onGet(url).reply(200, []);

      const response = await http.requestApi(path, { host, method: 'get', authToken: '123' });

      expect(response.data).toEqual([]);

      expect(axiosMock.history.get.length).toBe(1);
      const req = axiosMock.history.get[0]!;
      expect((req.headers!.get as any)('authorization')).toEqual('Bearer 123');
    });

    it('should make a request without an authorization header', async () => {
      const host = 'example.com';
      const path = 'users/me';

      const url = `https://api.${host}/api/v2/${path}`;
      axiosMock.onGet(url).reply(200, []);

      const response = await http.requestApi(path, { host, method: 'get', noAuthHeader: true, logger });

      expect(response.data).toEqual([]);
      expect(axiosMock.history.get.length).toBe(1);
      const req = axiosMock.history.get[0]!;
      expect((req.headers!.get as any)('authorization')).toBeUndefined();
    });

    it('should handle errors', async () => {
      const host = 'example.com';
      const path = 'users/me';

      const url = `https://api.${host}/api/v2/${path}`;
      axiosMock.onGet(url).reply(404, { message: 'bad request' }, { ['inin-correlation-id']: 'abc123' });

      try {
        await http.requestApi(path, { host, method: 'get', logger });
        fail('should have thrown');
      } catch (error) {
        expect(error.response.data.message).toBe('bad request');
      }
    });
  });

  describe('retryStatusCodes', () => {
    it('Set should contain all retriable status codes', () => {
      const set = HttpClient.retryStatusCodes;
      const codes = [
        408,
        413,
        429,
        500,
        502,
        503,
        504,
      ];

      expect(set.size).toBe(codes.length);
      codes.forEach(c => expect(set.has(c)).toBe(true));
    });
  });

  describe('requestApiWithRetry()', () => {
    it('should not retry if there is no error passed in', async () => {
      jest.spyOn(http, 'requestApi').mockRejectedValue(undefined);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise
        .catch(e => expect(e).toBe(undefined));
    });

    it('should not retry if there is no status code', async () => {
      const error = new Error('bad');
      jest.spyOn(http, 'requestApi').mockRejectedValue(error);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise
        .catch(e => expect(e).toBe(error));
    });

    it('should retry if there is a retriable status', async () => {
      const error = new Error('bad');
      (error as any).response = { status: 429, headers: {} };
      const spy = jest.spyOn(http, 'requestApi').mockRejectedValueOnce(error).mockResolvedValue(null);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }, 0).promise;
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should not retry if it is not a retriable status code', async () => {
      const error = new Error('bad http request');
      (error as any).status = 400;

      jest.spyOn(http, 'requestApi').mockRejectedValue(error);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise
        .catch(e => expect(e).toBe(error));
    });

    it('retry handler should return the retry-after value in milliseconds', async () => {
      const spy = jest.spyOn(utils as any, 'retryPromise').mockReturnValue({ _id: '3', promise: Promise.resolve(), cancel: jest.fn() });

      const error = {
        response: {
          headers: {
            'retry-after': '42'
          }
        }
      };

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise;

      const errFn: (error: any) => boolean | number = spy.mock.calls[0][1] as any;
      expect(errFn(error)).toEqual(42000);
      spy.mockRestore();
    });

    it('retry handler should should handle XMLHttpRequest', async () => {
      const spy = jest.spyOn(utils as any, 'retryPromise').mockReturnValue({ _id: '3', promise: Promise.resolve(), cancel: jest.fn() });

      const error = {
        response: {
          getResponseHeader: () => '42'
        }
      };

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise;

      const errFn: (error: any) => boolean | number = spy.mock.calls[0][1] as any;
      expect(errFn(error)).toEqual(42000);
      spy.mockRestore();
    });

    it('should not blow up if there are no headers', async () => {
      const spy = jest.spyOn(utils as any, 'retryPromise').mockReturnValue({ _id: '4', promise: Promise.resolve(), cancel: jest.fn() });

      const error = {
        response: { }
      };

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise;

      const errFn: (error: any) => boolean | number = spy.mock.calls[0][1] as any;
      expect(errFn(error)).toEqual(false);
      spy.mockRestore();
    });

    it('should not blow up if there is no response object', async () => {
      const spy = jest.spyOn(utils as any, 'retryPromise').mockReturnValue({ _id: '4', promise: Promise.resolve(), cancel: jest.fn() });

      const error = {};

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' }).promise;

      const errFn: (error: any) => boolean | number = spy.mock.calls[0][1] as any;
      expect(errFn(error)).toEqual(false);
      spy.mockRestore();
    });
  });

  describe('stopAllRetries()', () => {
    it('should canel and remove all pending retry promises', async () => {
      const cancelRetryRequestSpy = jest.spyOn(http, 'cancelRetryRequest' as any);
      jest.spyOn(http, 'requestApi').mockResolvedValue(wait(150));

      const prom1 = http.requestApiWithRetry('some/resource/1', { method: 'get', host: '' });
      const prom2 = http.requestApiWithRetry('some/resource/2', { method: 'get', host: '' });

      http.stopAllRetries();

      /* should call through to cancel before the promises have completed */
      expect(cancelRetryRequestSpy).toHaveBeenCalledTimes(2);

      await prom1.promise.then(() => fail('should have thrown'))
        .catch(e => expect(e.message).toBe('Retry request cancelled'));

      await prom2.promise.then(() => fail('should have thrown'))
        .catch(e => expect(e.message).toBe('Retry request cancelled'));

      /* calls through in the `finally` block – but won't do anything */
      expect(cancelRetryRequestSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('formatRequestError()', () => {
    it('should return a new object for superagent network errors', () => {
      const origError = new Error('something failed') as any;
      origError.status = undefined;
      origError.method = 'get'
      origError.url = 'http//example.com/resource';
      origError.crossDomain = false;

      expect(http.formatRequestError(origError)).toEqual({
        status: origError.status,
        method: origError.method,
        url: origError.url,
        crossDomain: origError.crossDomain,
        message: origError.message,
        name: origError.name,
        stack: origError.stack
      });
    });

    it('should return a new object for superagent response errors', () => {
      const actualError = new Error('something failed') as any;
      actualError.url = 'http//example.com/resource';

      const res = {
        body: { message: 'failed' },
        headers: {
          'inin-correlation-id': 'some-id'
        },
        text: '{"message": "failed"}',
        req: {
          method: 'post',
          _data: '{"data": "to save"}'
        },
        error: actualError
      };

      const origError = new Error() as any;
      origError.response = res;
      origError.status = 404;

      expect(http.formatRequestError(origError)).toEqual({
        status: origError.status,

        correlationId: res.headers['inin-correlation-id'],
        // responseBody: res.text,

        method: res.req.method,
        // requestBody: res.req._data,

        // url: res.error.url,
        message: 'Error making HTTP request', //res.error.message,
        name: res.error.name,
        stack: res.error.stack
      });
    });

    it('should return the original error as a new object', () => {
      const error = new Error('This is broken');

      expect(http.formatRequestError(error)).toBe(error);
    });
  });

  describe('isSuperagentNetworkError()', () => {
    let isSuperagentNetworkErrorFn: typeof http['isSuperagentNetworkError'];

    beforeEach(() => {
      isSuperagentNetworkErrorFn = http['isSuperagentNetworkError'];
    });

    it('should false for non-conformant errors', () => {
      const error = new Error() as any;
      expect(isSuperagentNetworkErrorFn(error)).toBe(false);

      error.status = 202;
      expect(isSuperagentNetworkErrorFn(error)).toBe(false);

      error.method = 'get';
      expect(isSuperagentNetworkErrorFn(error)).toBe(false);

      delete error.status;
      error.url = 'https://example.com';
      expect(isSuperagentNetworkErrorFn(error)).toBe(false);
    });

    it('should true for conformant errors', () => {
      const error = new Error() as any;
      error.status = undefined;
      error.method = 'get';
      error.url = 'https://example.com';

      expect(isSuperagentNetworkErrorFn(error)).toBe(true);
    });
  });

  describe('isSuperagentResponseError()', () => {
    let isSuperagentResponseErrorFn: typeof http['isSuperagentResponseError'];

    beforeEach(() => {
      isSuperagentResponseErrorFn = http['isSuperagentResponseError'];
    });

    it('should false for non-conformant errors', () => {
      const error = new Error() as any;
      expect(isSuperagentResponseErrorFn(error)).toBe(false);

      error.response = {};
      expect(isSuperagentResponseErrorFn(error)).toBe(false);

      error.response.body = {};
      expect(isSuperagentResponseErrorFn(error)).toBe(false);

      delete error.response.body;
      error.response.req = {};
      expect(isSuperagentResponseErrorFn(error)).toBe(false);
    });

    it('should true for conformant errors', () => {
      const error = new Error() as any;
      error.response = {};
      error.response.body = {};
      error.response.req = {};

      expect(isSuperagentResponseErrorFn(error)).toBe(true);
    });
  });

  describe('handleResponse', () => {
    it('should sanitize and reject timeout error', async () => {
      const error = new AxiosError('fake error', 'ECONNABORTED');

      const spy = jest.fn();
      const logger = {
        debug: spy
      };

      await expect(http['handleResponse'](logger as any, new Date().getTime(), { url: 'http://test.com' }, error as any)).rejects.toThrow(error);

      expect(spy).toHaveBeenCalledWith('request error: http://test.com', expect.objectContaining({
        message: 'fake error',
        elapsed: expect.anything()
      }), { skipServer: true });
    });

    it('should sanitize access token from ECONNABORTED error', async () => {
      const error = new AxiosError('fake error', 'ECONNABORTED');
      error.config = { headers: new AxiosHeaders({ Authorization: 'mysupersecretaccesstoken' })};

      const spy = jest.fn();
      const logger = {
        debug: spy
      };

      http['handleResponse'](logger as any, new Date().getTime(), { url: 'http://test.com' }, error as any)
        .catch((e) => {
          expect(e.config.headers.Authorization).toBe('redacted');
        });
    });

    it('should sanitize access token from error', async () => {
      const error = new AxiosError('fake error');
      error.config = { headers: new AxiosHeaders({ Authorization: 'mysupersecretaccesstoken' })};

      const spy = jest.fn();
      const logger = {
        debug: spy
      };

      http['handleResponse'](logger as any, new Date().getTime(), { url: 'http://test.com' }, error as any)
        .catch((e) => {
          expect(e.config.headers.Authorization).toBe('redacted');
        });
    });

    it('should handle no request object', async () => {
      const error = new AxiosError('fake error', 'HELLO');

      const spy = jest.fn();
      const logger = {
        debug: spy
      };

      delete error.request;

      await expect(http['handleResponse'](logger as any, new Date().getTime(), { url: 'http://test.com' }, error as any)).rejects.toEqual({...error, text: undefined});
    });
  });

  describe('_buildUri', () => {
    it('should return url with http', () => {
      expect(http['_buildUri']('http://unsecure.com', 'test')).toEqual('http://unsecure.com/api/v2/test');
    });
  });
});
