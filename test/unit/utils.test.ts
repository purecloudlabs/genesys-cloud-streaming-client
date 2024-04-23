import * as utils from '../../src/utils';
import { retryPromise } from '../../src/utils';
import { flushPromises } from '../helpers/testing-utils';

const sdp: Readonly<String> = 
`
v=0\r\n
o=- 2890844526 2890844526 IN IP4 192.0.2.1\r\n
s=Softphone Call\r\n
c=IN IP4 192.0.2.1\r\n
t=0 0\r\n
m=audio 49170 RTP/AVP 0 8 97\r\n
a=rtpmap:0 PCMU/8000\r\n
a=rtpmap:8 PCMA/8000\r\n
a=rtpmap:97 iLBC/8000\r\n
a=ptime:20\r\n
a=sendrecv\r\n
a=ice-ufrag:as34d\r\n
a=ice-pwd:asf44fwerwe34f34s\r\n
`;

describe('Utils', () => {
  describe('jid utils', () => {
    it('isAcdJid', () => {
      expect(utils.isAcdJid('acd-sdkfjk@test.com')).toBeTruthy();
      expect(utils.isAcdJid('acd-sdkfjk@gjoll.com')).toBeFalsy();
      expect(utils.isAcdJid('sdkfjk@test.com')).toBeFalsy();
    });

    it('isScreenRecordingJid', () => {
      expect(utils.isScreenRecordingJid('screenrecording-sdkfjk@test.com')).toBeTruthy();
      expect(utils.isScreenRecordingJid('screenrecording-sdkfjk@gjoll.test.com')).toBeFalsy();
      expect(utils.isScreenRecordingJid('sdkfjk@test.com')).toBeFalsy();
    });

    it('isSoftphoneJid', () => {
      expect(utils.isSoftphoneJid('sdkfjk@gjoll.test.com')).toBeTruthy();
      expect(utils.isSoftphoneJid('sdkfjk@test.com')).toBeFalsy();
      expect(utils.isSoftphoneJid('')).toBeFalsy();
    });

    it('isVideoJid', () => {
      expect(utils.isVideoJid('sdkfjk@conference.test.com')).toBeTruthy();
      expect(utils.isVideoJid('acd-sdkfjk@conference.test.com')).toBeFalsy();
      expect(utils.isVideoJid('sdkfjk@test.com')).toBeFalsy();
    });
  });

  describe('retryPromise()', () => {
    const flush = async (ms?: number) => {
      await new Promise(res => setImmediate(res));
      if (ms) {
        jest.advanceTimersByTime(ms);
      }
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    it('should keep retrying function until it passes', async (done) => {
      const DELAY = 1000;
      let retryCount = 0;
      let retryFn = jest.fn().mockImplementation(() => {
        return retryCount++ > 2 ? Promise.resolve('Yeet') : Promise.reject('No')
      });

      const retry = retryPromise(retryFn, () => true, DELAY, { debug: jest.fn() });

      /* do not finish the test until this completes */
      retry.promise.then(value => {
        expect(value).toBe('Yeet');
        done();
      });

      /* expected to be called right away */
      expect(retryFn).toHaveBeenCalledTimes(1);

      /* called a 2nd time after waiting */
      await flush(DELAY);
      expect(retryFn).toHaveBeenCalledTimes(2);
      expect(retry.hasCompleted()).toBe(false);

      /* called a 3rd time after waiting */
      await flush(DELAY);
      expect(retryFn).toHaveBeenCalledTimes(3);
      expect(retry.hasCompleted()).toBe(false);

      /* after waiting the 4th time, it should complete */
      await flush(DELAY);
      expect(retryFn).toHaveBeenCalledTimes(4);
      expect(retry.hasCompleted()).toBe(true);
    });

    it('should wait the amount of time returned from the retry handler', async () => {
      jest.useFakeTimers();

      const fn = jest.fn().mockRejectedValueOnce({}).mockResolvedValue(null);
      const retry = retryPromise(
        fn,
        () => 2000
      );

      await flushPromises();
      expect(fn).toHaveBeenCalledTimes(1);
      fn.mockReset();

      jest.advanceTimersByTime(1000);
      await flushPromises();

      expect(fn).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1100);
      await flushPromises();

      expect(fn).toHaveBeenCalled();
    });
  });

  describe('getUfragFromSdp', () => {
    it('should return null if no sdp is provided', () => {
      expect(utils.getUfragFromSdp(undefined)).toBeNull();
    });
    
    it('should return null if ufrag is not found', () => {
      expect(utils.getUfragFromSdp('sdllksdnflskdnflkasd')).toBeNull();
    });

    it('should return the ufrag', () => {
      expect(utils.getUfragFromSdp(sdp as string)).toEqual('as34d');
    });
  });

  describe('getIcePwdFromSdp', () => {
    it('should return null if no sdp is provided', () => {
      expect(utils.getIcePwdFromSdp(undefined)).toBeNull();
    });
    
    it('should return null if icepwd is not found', () => {
      expect(utils.getIcePwdFromSdp('lskdjfksnnsn')).toBeNull();
    });

    it('should return the icepwd', () => {
      expect(utils.getIcePwdFromSdp(sdp as string)).toEqual('asf44fwerwe34f34s');
    });
  });
});
