import nock from 'nock';

import { HttpClient } from '../../src/http-client';
import { wait } from '../helpers/testing-utils';

describe('HttpRequestClient', () => {
  let http: HttpClient;

  beforeEach(() => {
    http = new HttpClient();
  });

  afterEach(async () => {
    http.stopAllRetries();
    await Promise.resolve();
  });

  describe('requestApi()', () => {
    it('should make a request using superagent', async () => {
      const host = 'example.com';
      const path = 'users/me';

      const api = nock(`https://api.${host}`);

      const users = api.get(`/api/v2/${path}`)
        .reply(200, []);

      const response = await http.requestApi(path, { host, method: 'get' });

      expect(response.body).toEqual([]);
      expect(users.isDone()).toBe(true);
    });

    it('should handle errors from superagent', async () => {
      const host = 'example.com';
      const path = 'users/me';

      const api = nock(`https://api.${host}`);

      const users = api.get(`/api/v2/${path}`)
        .reply(404, { message: 'bad request' }, { ['inin-correlation-id']: 'abc123' });

      try {
        await http.requestApi(path, { host, method: 'get' });
        fail('should have thrown');
      } catch (error) {
        expect(error.correlationId).toBe('abc123');
        expect(users.isDone()).toBe(true);
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

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' })
        .catch(e => expect(e).toBe(undefined));
    });

    it('should not retry if there is no status code', async () => {
      const error = new Error('bad');
      jest.spyOn(http, 'requestApi').mockRejectedValue(error);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' })
        .catch(e => expect(e).toBe(error));
    });

    it('should not retry if it is not a retriable status code', async () => {
      const error = new Error('bad http request');
      (error as any).status = 400;

      jest.spyOn(http, 'requestApi').mockRejectedValue(error);

      await http.requestApiWithRetry('some/path', { method: 'get', host: 'inin.com' })
        .catch(e => expect(e).toBe(error));
    });
  });

  describe('stopAllRetries()', () => {
    it('should canel and remove all pending retry promises', async () => {
      const _cancelAndRemoveValueFromRetryMapSpy = jest.spyOn(http, '_cancelAndRemoveValueFromRetryMap' as any);
      jest.spyOn(http, 'requestApi').mockResolvedValue(wait(150));

      const prom1 = http.requestApiWithRetry('some/resource/1', { method: 'get', host: '' });
      const prom2 = http.requestApiWithRetry('some/resource/2', { method: 'get', host: '' });

      http.stopAllRetries();

      /* should call through to cancel before the promises have completed */
      expect(_cancelAndRemoveValueFromRetryMapSpy).toHaveBeenCalledTimes(2);

      await prom1.then(() => fail('should have thrown'))
        .catch(e => expect(e.message).toBe('Retry request cancelled'));

      await prom2.then(() => fail('should have thrown'))
        .catch(e => expect(e.message).toBe('Retry request cancelled'));

      /* calls through in the `finally` block – but won't do anything */
      expect(_cancelAndRemoveValueFromRetryMapSpy).toHaveBeenCalledTimes(4);
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
        responseBody: res.text,

        method: res.req.method,
        requestBody: res.req._data,

        url: res.error.url,
        message: res.error.message,
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
});