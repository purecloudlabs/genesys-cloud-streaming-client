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
});