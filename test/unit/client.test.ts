import WildEmitter from 'wildemitter';
import { TokenBucket } from 'limiter';

import { Client } from '../../src/client';
import { Logger } from 'genesys-cloud-client-logger';
import * as utils from '../../src/utils';
import { AxiosError, AxiosHeaders } from 'axios';
import SaslError from '../../src/types/sasl-error';
import { TimeoutError } from '../../src/types/timeout-error';
import OfflineError from '../../src/types/offline-error';
import EventEmitter from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { flushPromises } from '../helpers/testing-utils';
import { SCConnectionData, StreamingClientErrorTypes, StreamingClientError } from '../../src';
import { Ping } from '../../src/ping';
import { ServerMonitor } from '../../src/server-monitor';
import UserCancelledError from '../../src/types/user-cancelled-error';

jest.mock('genesys-cloud-client-logger');
jest.mock('../../src/ping');
jest.mock('../../src/server-monitor');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mocked-uuid'),
}));

const defaultOptions = {
  jid: 'anon@example.mypurecloud.com',
  authToken: 'AuthToken',
  host: 'wss://streaming.example.com',
  optOutOfWebrtcStatsTelemetry: true,
  logger: {
    warn () { },
    error () { },
    debug () { },
    info () { },
    log () { },
  },
  startServerLogging: jest.fn(),
  stopServerLogging: jest.fn()
};
Object.freeze(defaultOptions);

function getDefaultOptions () {
  return Object.assign({}, defaultOptions);
}

class TestExtension extends WildEmitter { }

Client.extend('testExtension', TestExtension as any);

const localStorageMock = (() => {
  let store = {};

  return {
    getItem(key: string) {
      return store[key] || null;
    },
    setItem(key: string, value: string) {
      store[key] = value.toString();
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'sessionStorage', {
  value: localStorageMock
});

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('constructor', () => {
  it('client creation', () => {
    const client = new Client(getDefaultOptions() as any);
    expect(typeof client.on).toBe('function');
    expect(typeof client.connect).toBe('function');
    expect(client.notifications).toBeTruthy();
  });

  it('logger should get the backgroundassistant url', () => {
    const loggerMock: jest.Mock<Logger> = Logger as any;

    loggerMock.mockClear();
    const spy = jest.spyOn(utils, 'parseJwt').mockReturnValue({
      iss: 'urn:purecloud:screenrecording'
    });

    const opts = {...getDefaultOptions(), jwt: 'myjwt'};
    delete (opts as any).authToken;

    const client = new Client(opts);
    spy.mockRestore();
    expect(loggerMock).toHaveBeenCalledWith(expect.objectContaining({url: expect.stringContaining('backgroundassistant')}));
  });

  it('should default to isGuest', () => {
    const loggerMock: jest.Mock<Logger> = Logger as any;

    loggerMock.mockClear();

    const opts = {...getDefaultOptions()};
    delete (opts as any).authToken;

    const client = new Client(opts);
    expect(client.isGuest).toBeTruthy();
  });
});

describe('getConnectionData', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
  });

  it('should return default on parse error', () => {
    window.sessionStorage.setItem('sc_connectionData_123', '{"lsdkn":');

    (client.logger as any)['clientId'] = '123'
    const warnSpy = client.logger.warn = jest.fn();

    expect(client['getConnectionData']()).toEqual({ currentDelayMs: 0 } as SCConnectionData);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to parse'));
  });

  it('should get data based on app name', () => {
    window.sessionStorage.setItem('sc_connectionData_myApp', '{"currentDelayMs": 44}');

    (client.logger as any)['clientId'] = '123';
    client.config.appName = 'myApp';

    expect(client['getConnectionData']()).toEqual({ currentDelayMs: 44 } as SCConnectionData);
  });
});

describe('increaseBackoff', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
  });

  it('should double current backoff', () => {
    let current = 0;
    const spy = client['setConnectionData'] = jest.fn().mockImplementation((data: SCConnectionData) => {
      current = data.currentDelayMs;
    });

    client['getConnectionData'] = jest.fn().mockImplementation((): SCConnectionData => {
      return { currentDelayMs: current }
    });

    client['increaseBackoff']();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ currentDelayMs: 4000 }));

    client['increaseBackoff']();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ currentDelayMs: 8000 }));

    client['increaseBackoff']();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ currentDelayMs: 16000 }));
  });
});

describe('descreaseBackoff', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
  });

  it('should reset backoff delay if timeOfTotalReset is past', () => {
    const mockConnectionData: SCConnectionData = {
      currentDelayMs: 10000,
      nextDelayReductionTime: new Date().getTime() + 10000, // 10 seconds in the future
      delayMsAfterNextReduction: 5000,
      timeOfTotalReset: new Date().getTime() - 1000 // 1 second ago
    };
    client['getConnectionData'] = jest.fn().mockReturnValue(mockConnectionData);
    const spy = client['setConnectionData'] = jest.fn();

    client['decreaseBackoff'](5000);

    expect(spy).toHaveBeenCalledWith({
      currentDelayMs: 0
    } as SCConnectionData);
  });

  it('should update and update the delay to half its current value', () => {
    jest.useFakeTimers();

    const mockConnectionData: SCConnectionData = {
      currentDelayMs: 10000,
      nextDelayReductionTime: new Date().getTime() + 10000, // 10 seconds in the future
      delayMsAfterNextReduction: 5000,
      timeOfTotalReset: new Date().getTime() + (1000 * 60 * 60) // 1 hour in the future
    };
    client['getConnectionData'] = jest.fn().mockReturnValue(mockConnectionData);
    const spy = client['setConnectionData'] = jest.fn();

    client['decreaseBackoff'](5000);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      currentDelayMs: 5000,
      delayMsAfterNextReduction: 2500,
      nextDelayReductionTime: expect.any(Number),
    }));

    const calls = spy.mock.calls;

    const spyCallArg = calls[0][0];

    const expectedNextReductionTime = new Date().getTime() + (5000 * 5);
    expect(spyCallArg.nextDelayReductionTime).toBeGreaterThanOrEqual(expectedNextReductionTime - 1000);
    expect(spyCallArg.nextDelayReductionTime).toBeLessThanOrEqual(expectedNextReductionTime + 1000);

    const recursiveSpy = jest.spyOn(client as any, 'decreaseBackoff');
    jest.advanceTimersByTime(expectedNextReductionTime + 100);
    expect(recursiveSpy).toHaveBeenCalledWith(2500);
  });
});

describe('getStartingDelay', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
  });

  it('should never return a value less than 2000', () => {
    expect(client['getStartingDelay']({
      currentDelayMs: 500
    }, 90000)).toEqual(2000);

    expect(client['getStartingDelay']({
      currentDelayMs: 5000
    }, 90000)).toEqual(5000);
  });

  it('should never return value greater than maxDelay', () => {
    expect(client['getStartingDelay']({
      currentDelayMs: 95000
    }, 90000)).toEqual(90000);
  });

  it('should return initialDelay if timeOfTotalReset has past', () => {
    expect(client['getStartingDelay']({
      currentDelayMs: 50000,
      timeOfTotalReset: new Date().getTime() - 1000 // 1 second ago
    }, 90000)).toEqual(2000);
  });
});

describe('connect', () => {
  let connectionAttemptSpy: jest.Mock;
  let backoffRetrySpy: jest.Mock;
  let client: Client;

  beforeEach(() => {
    client = new Client({
      host: defaultOptions.host
    });

    connectionAttemptSpy = client['makeConnectionAttempt'] = jest.fn();
    backoffRetrySpy = client['backoffConnectRetryHandler'] = jest.fn();
  });

  it('should set cancelConnectionAttempt to false', async () => {
    connectionAttemptSpy.mockResolvedValue(null);
    client['cancelConnectionAttempt'] = true;

    await client.connect();
    expect(client['cancelConnectionAttempt']).toBeFalsy();
  });

  it('should do nothing if already connecting', async () => {
    client.connecting = true;
    await client.connect();
    expect(connectionAttemptSpy).not.toHaveBeenCalled();
  });

  it('should set a backoff reduction timer upon success', async () => {
    jest.useFakeTimers();
    client['makeConnectionAttempt'] = jest.fn().mockResolvedValue(null);
    const spy = client['decreaseBackoff'] = jest.fn();

    const mockConnectionData: SCConnectionData = {
      currentDelayMs: 10000,
      nextDelayReductionTime: new Date().getTime() + 10000, // 10 seconds in the future
      delayMsAfterNextReduction: 5000
    };
    client['getConnectionData'] = jest.fn().mockReturnValue(mockConnectionData);

    await client.connect();
    await flushPromises();
    jest.advanceTimersToNextTimer();

    expect(client['backoffReductionTimer']).toBeTruthy();

    jest.advanceTimersByTime(10100);
    expect(spy).toHaveBeenCalledWith(5000);
  });

  it('should set next backoff value to 0 if there is no value but there is a time', async () => {
    jest.useFakeTimers();
    client['makeConnectionAttempt'] = jest.fn().mockResolvedValue(null);
    const spy = client['decreaseBackoff'] = jest.fn();

    const mockConnectionData: SCConnectionData = {
      currentDelayMs: 10000,
      nextDelayReductionTime: new Date().getTime() + 10000, // 10 seconds in the future
    };
    client['getConnectionData'] = jest.fn().mockReturnValue(mockConnectionData);

    await client.connect();
    await flushPromises();
    jest.advanceTimersToNextTimer();

    expect(client['backoffReductionTimer']).toBeTruthy();

    jest.advanceTimersByTime(10100);
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('should resolve if connection attempt is successful', async () => {
    connectionAttemptSpy.mockResolvedValue(null);

    await client.connect();
    expect(connectionAttemptSpy).toHaveBeenCalled();
  });

  it('should throw if connection attempt fails and no keepTryingOnFailure', async () => {
    const error = new Error('fake error');
    connectionAttemptSpy.mockRejectedValue(error);

    try {
      await client.connect({ keepTryingOnFailure: true })
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.generic);
      expect(err['details']).toBe(error);
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });

  it('should throw a user_cancelled error if the connection attempt was cancelled regardless of the thrown error', async () => {
    const error = new SaslError('incorrect-encoding', 'channelId', 'instanceId');
    connectionAttemptSpy.mockRejectedValue(error);
    connectionAttemptSpy.mockImplementation(() => {
      client['cancelConnectionAttempt'] = true;
      throw error;
    });

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.userCancelled);
      expect(err['details']).toBe(error);
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });

  it('should handle undefined error', async () => {
    connectionAttemptSpy.mockRejectedValue(undefined);

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.generic);
      expect(err['details']).toBeFalsy();
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });

  it('should handle error with no config property', async () => {
    const error = new AxiosError('fake error', 'FAKE_ERROR', {
      url: 'fakeUrl',
      method: 'get',
      headers: new AxiosHeaders()
    },
    undefined,
    { status: 401 } as any
    );

    delete (error as any).config;
    connectionAttemptSpy.mockRejectedValue(error);

    const errorSpy = jest.spyOn(client.logger, 'error');

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.invalid_token);
    }

    expect(errorSpy).toHaveBeenCalledWith('Failed to connect streaming client', {
      error: {
        config: {
          url: undefined,
          method: undefined
        },
        status: error.response?.status,
        code: error.code,
        name: error.name,
        message: error.message
      }
    });
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);

    expect.assertions(4);
  });

  it('should throw if connection attempt fails and retry handler returns false', async () => {
    const error = new Error('fake error');
    connectionAttemptSpy.mockRejectedValue(error);
    backoffRetrySpy.mockReturnValue(false);

    try {
      await client.connect({ keepTryingOnFailure: true })
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.generic);
      expect(err['details']).toBe(error);
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect(backoffRetrySpy).toHaveBeenCalledTimes(1);
    expect.assertions(5);
  });

  it('should massage AxiosError on failure', async () => {
    const error = new AxiosError('fake error', 'FAKE_ERROR', {
      url: 'fakeUrl',
      method: 'get',
      headers: new AxiosHeaders()
    },
    undefined,
    { status: 401 } as any
    );
    connectionAttemptSpy.mockRejectedValue(error);

    const errorSpy = jest.spyOn(client.logger, 'error');

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.invalid_token);
    }

    expect(errorSpy).toHaveBeenCalledWith('Failed to connect streaming client', {
      error: {
        config: {
          url: error.config!.url,
          method: error.config!.method
        },
        status: error.response?.status,
        code: error.code,
        name: error.name,
        message: error.message
      }
    });
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);

    expect.assertions(4);
  });

  it('should massage AxiosError (no response object) on failure', async () => {
    const error = new AxiosError('fake error', 'FAKE_ERROR', {
      url: 'fakeUrl',
      method: 'get',
      headers: new AxiosHeaders()
    });
    connectionAttemptSpy.mockRejectedValue(error);

    const errorSpy = jest.spyOn(client.logger, 'error');

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.generic);
      expect(err['details']).toBe(error);
    }

    expect(errorSpy).toHaveBeenCalledWith('Failed to connect streaming client', {
      error: {
        config: {
          url: error.config!.url,
          method: error.config!.method
        },
        status: error.response?.status,
        code: error.code,
        name: error.name,
        message: error.message
      }
    });
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);

    expect.assertions(5);
  });

  it('should throw an invalid_token error if SASL error is not one we deem to be retryable', async () => {
    // Ref: https://www.rfc-editor.org/rfc/rfc6120.html#section-6.5
    const error = new SaslError('not-authorized', 'channelId', 'instanceId');
    connectionAttemptSpy.mockRejectedValue(error);

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.invalid_token);
      expect(err['details']).toBe(error);
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });

  it('should throw a generic error if we deem a SASL error to be retryable', async () => {
    const error = new SaslError('incorrect-encoding', 'channelId', 'instanceId');
    connectionAttemptSpy.mockRejectedValue(error);

    try {
      await client.connect({ keepTryingOnFailure: false });
    } catch (err) {
      expect(err).toBeInstanceOf(StreamingClientError);
      expect(err['type']).toBe(StreamingClientErrorTypes.generic);
      expect(err['details']).toBe(error);
    }
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect.assertions(4);
  });
});

describe('disconnect', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
    client['autoReconnect'] = true;
  });

  it('should stop HTTP retries and resolve when there is a current stanza instance', async () => {
    let isResolved = false;

    client.http.stopAllRetries = jest.fn();
    const stanza = new EventEmitter() as any;
    client['connectionManager'].currentStanzaInstance = stanza;

    let resolve;
    stanza.disconnect = jest.fn().mockImplementation(() => {
      return new Promise(r => {
        resolve = r;
      });
    });

    client.disconnect().then(() => isResolved = true);
    await flushPromises();

    expect(client.http.stopAllRetries).toHaveBeenCalled();
    expect(stanza.disconnect).toHaveBeenCalled();
    expect(isResolved).toBeFalsy();

    resolve();
    await flushPromises();

    expect(isResolved).toBeTruthy();
    expect(client['autoReconnect']).toBeFalsy();
    expect(client['cancelConnectionAttempt']).toBeTruthy();
  });

  it('should stop HTTP retries and resolve when there is no current stanza instance', async () => {
    let isResolved = false;

    client.http.stopAllRetries = jest.fn();
    client['connectionManager'].currentStanzaInstance = undefined;

    await client.disconnect().then(() => isResolved = true);

    expect(client.http.stopAllRetries).toHaveBeenCalled();
    expect(isResolved).toBeTruthy();
    expect(client['autoReconnect']).toBeFalsy();
    expect(client['cancelConnectionAttempt']).toBeTruthy();
  });
});

describe('backoffConnectRetryHandler', () => {
  let client: Client;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new Client({
      host: defaultOptions.host
    });

    errorSpy = jest.spyOn(client.logger, 'error');
  });

  it('should return false if cancelConnectionAttempt is true', async () => {
    const error = new UserCancelledError('user cancelled');
    client['cancelConnectionAttempt'] = true;
    const result = await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1);
    expect(result).toBeFalsy();
  });

  it('should return false if cancelConnectionAttempt is true even if called with another error', async () => {
    const error = new TimeoutError('fake timeout');
    client['cancelConnectionAttempt'] = true;

    const result = await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1);
    expect(result).toBeFalsy();
  });

  it('should return false if not keepTryingOnFailure', async () => {
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 1 }, {}, 1)).toBeFalsy();
  });

  it('should return false if AxiosError with a 401 code', async () => {
    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get',
        headers: new AxiosHeaders()
      },
      {},
      {
        status: 401
      } as any
    );
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });

  it('should return false if error has no config', async () => {
    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get',
        headers: new AxiosHeaders()
      },
      {},
      {
        status: 401
      } as any
    );

    delete (error as any).config;
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });

  it('should wait until retryAfter has elapsed (axiosError)', async () => {
    jest.useFakeTimers();

    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get',
        headers: new AxiosHeaders()
      },
      {},
      {
        status: 429,
        headers: {
          'retry-after': '13'
        }
      } as any
    );

    const errorSpy = jest.spyOn(client.logger, 'error');
    const debugSpy = jest.spyOn(client.logger, 'debug');

    const promise = client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1);

    await flushPromises();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('respecting retry-after header'), expect.anything(), expect.anything());
    expect(debugSpy).not.toHaveBeenCalled();

    await flushPromises();
    jest.advanceTimersByTime(10000);
    await flushPromises();
    expect(debugSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4000);
    await flushPromises();
    expect(debugSpy).toHaveBeenCalled();

    await expect(promise).resolves.toBeTruthy();
    jest.useRealTimers();
  });

  it('should wait until retryAfter has elapsed (xmlhttperror)', async () => {
    jest.useFakeTimers();

    const error = {
      response: {
        status: 429,
        getResponseHeader: () => '12'
      }
    };

    const errorSpy = jest.spyOn(client.logger, 'error');
    const debugSpy = jest.spyOn(client.logger, 'debug');

    const promise = client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1);

    await flushPromises();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('respecting retry-after header'), expect.anything(), expect.anything());
    expect(debugSpy).not.toHaveBeenCalled();

    await flushPromises();
    jest.advanceTimersByTime(10000);
    await flushPromises();
    expect(debugSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4000);
    await flushPromises();
    expect(debugSpy).toHaveBeenCalled();

    await expect(promise).resolves.toBeTruthy();
    jest.useRealTimers();
  });

  it('should handle response with no headers', async () => {
    const error = {
      response: {
        status: 429
      }
    };

    const promise = client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1);
    expect(await promise).toBeTruthy();
  });

  it('should return false if AxiosError with a 403 code', async () => {
    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get',
        headers: new AxiosHeaders()
      },
      {},
      {
        status: 403
      } as any
    );
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });

  it('should handle AxiosError without a response', async () => {
    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get',
        headers: new AxiosHeaders()
      },
      {} as any
    );
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
  });

  it('should return false if SaslError will need re-authentication', async () => {
    const error = new SaslError('not-authorized', 'channelId', 'instanceId');
    expect (await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });

  it('should return false if SaslError is unknown', async () => {
    // Ref: https://www.rfc-editor.org/rfc/rfc6120.html#section-6.5
    const error = new SaslError('new-unknown-error' as any, 'channelId', 'instanceId');
    expect (await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });

  it('should set hardReconnectRequired if SaslError can\'t be solved with re-authenticating', async () => {
    const error = new SaslError('incorrect-encoding', 'channelId', 'instanceId');
    client.hardReconnectRequired = false;
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
    expect(client.hardReconnectRequired).toBeTruthy();
  });

  it('should strip out irrelevant stack for timeout error', async () => {
    const error = new TimeoutError('fake timeout');
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith('Failed streaming client connection attempt, retrying', expect.objectContaining({
      error: error.message
    }), { skipServer: false });
  });

  it('should handle undefined error', async () => {
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, undefined, 1)).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith('Failed streaming client connection attempt, retrying', expect.objectContaining({
      error: expect.objectContaining({ message: 'streaming client backoff handler received undefined error' })
    }), { skipServer: false });
  });

  it('should log additional details if included in timeout error', async () => {
    const error = new TimeoutError('fake timeout');
    const details = (error as any).details = { };
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith('Failed streaming client connection attempt, retrying', expect.objectContaining({
      error: error.message,
      details
    }), { skipServer: false });
  });

  it('should skip server logging if offline error', async () => {
    const error = new OfflineError('here we go');
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith('Failed streaming client connection attempt, retrying', expect.objectContaining({
      error
    }), { skipServer: true });
  });
});

describe('makeConnectionAttempt', () => {
  let client: Client;
  let prepareSpy: jest.SpyInstance;
  let getConnectionSpy: jest.SpyInstance;
  let pingerMock: jest.Mock<Ping> = Ping as any;

  beforeEach(() => {
    client = new Client({
      host: defaultOptions.host
    });
    prepareSpy = client['prepareForConnect'] = jest.fn();
    getConnectionSpy = client['connectionManager'].getNewStanzaConnection = jest.fn();

    pingerMock.mockClear();
  });

  it('should not attempt if the connection attempt has been cancelled', async () => {
    client['cancelConnectionAttempt'] = true;

    await expect(client['makeConnectionAttempt']()).rejects.toThrow(UserCancelledError);
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(getConnectionSpy).not.toHaveBeenCalled();
  });

  it('should not attempt if offline', async () => {
    const spy = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(client['makeConnectionAttempt']()).rejects.toThrow(OfflineError);
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(getConnectionSpy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('should not set up a stanza instance if the connection attempt is cancelled after preparing to connect', async () => {
    prepareSpy.mockImplementation(() => client['cancelConnectionAttempt'] = true);

    await expect(client['makeConnectionAttempt']()).rejects.toThrow(UserCancelledError);

    expect(prepareSpy).toHaveBeenCalled();
    expect(getConnectionSpy).not.toHaveBeenCalled();
  });

  it('should set up stanzaInstance and emit connected event', async () => {
    expect.assertions(8);
    const fakeInstance = {};
    getConnectionSpy.mockResolvedValue(fakeInstance);
    prepareSpy.mockResolvedValue(null);

    const addHandlersSpy = client['addInateEventHandlers'] = jest.fn();
    const proxyEventsSpy = client['proxyStanzaEvents'] = jest.fn();

    const fakeExtension = {
      configureNewStanzaInstance: jest.fn().mockResolvedValue(null),
      handleStanzaInstanceChange: jest.fn()
    }

    client['extensions'] = [fakeExtension];

    client.on('connected', () => {
      expect(true).toBeTruthy();
    });

    await client['makeConnectionAttempt']();
    expect(client.activeStanzaInstance).toBe(fakeInstance);
    expect(addHandlersSpy).toHaveBeenCalled();
    expect(proxyEventsSpy).toHaveBeenCalled();
    expect(fakeExtension.configureNewStanzaInstance).toHaveBeenCalled();
    expect(fakeExtension.handleStanzaInstanceChange).toHaveBeenCalled();
    expect(client.connected).toBeTruthy();
    expect(client.connecting).toBeFalsy();
  });

  it('should clean up connection if an extension fails configureNewStanzaInstance', async () => {
    const disconnectSpy = jest.fn();
    const fakeEmit = jest.fn();
    const fakeInstance = {
      disconnect: disconnectSpy,
      emit: null,
      originalEmitter: fakeEmit
    };
    const cleanupSpy = jest.spyOn(client as any, 'removeStanzaBoundEventHandlers');
    client['boundStanzaDisconnect'] = async () => {};
    client['boundStanzaNoLongerSubscribed'] = () => {};
    client['boundStanzaDuplicateId'] = () => {};
    getConnectionSpy.mockResolvedValue(fakeInstance);
    prepareSpy.mockResolvedValue(null);
    const clientEmitSpy = jest.spyOn(client, 'emit');
    client.connecting = true;

    const addHandlersSpy = client['addInateEventHandlers'] = jest.fn();
    const proxyEventsSpy = client['proxyStanzaEvents'] = jest.fn();

    const fakeExtension = {
      configureNewStanzaInstance: jest.fn().mockResolvedValue(null),
      handleStanzaInstanceChange: jest.fn()
    }

    const err = new Error('Whoops, this is on purpose');
    const fakeExtension2 = {
      configureNewStanzaInstance: jest.fn().mockRejectedValue(err),
      handleStanzaInstanceChange: jest.fn()
    }

    client['extensions'] = [fakeExtension, fakeExtension2];

    client.on('connected', () => {
      fail('This should not have happened');
    });

    await expect(client['makeConnectionAttempt']()).rejects.toThrow(err);
    expect(clientEmitSpy).not.toHaveBeenCalled();
    expect(client.activeStanzaInstance).toBeUndefined();
    expect(addHandlersSpy).toHaveBeenCalled();
    expect(proxyEventsSpy).toHaveBeenCalled();
    expect(client.connected).toBeFalsy();
    expect(client.connecting).toBeTruthy();
    expect(cleanupSpy).toHaveBeenCalled();
    expect(fakeInstance.disconnect).toHaveBeenCalled();
    expect(client['boundStanzaDisconnect']).toBeUndefined();
    expect(client['boundStanzaNoLongerSubscribed']).toBeUndefined();
    expect(client['boundStanzaDuplicateId']).toBeUndefined();
  });

  it('should cleanup event handlers and connection monitors', async () => {
    const disconnectSpy = jest.fn();
    const fakeEmit = jest.fn();
    const fakeInstance = {
      disconnect: disconnectSpy,
      emit: null,
      originalEmitter: fakeEmit,
      subscribeToNode: jest.fn().mockResolvedValue({}),
      pinger: {
        stop: jest.fn()
      },
      serverMonitor: {
        stop: jest.fn()
      }
    };
    const cleanupSpy = jest.spyOn(client as any, 'removeStanzaBoundEventHandlers');
    client['boundStanzaDisconnect'] = async () => {};
    client['boundStanzaNoLongerSubscribed'] = () => {};
    getConnectionSpy.mockResolvedValue(fakeInstance);
    prepareSpy.mockResolvedValue(null);
    client.connecting = true;
    const normalEmit = client.emit;
    const emitSpy = jest.spyOn(client, 'emit').mockImplementation(function (name) {
      if (name === 'connected') {
        throw new Error('this is expected');
      }

      return normalEmit.apply(client, arguments as any);
    });

    const addHandlersSpy = client['addInateEventHandlers'] = jest.fn();
    const proxyEventsSpy = client['proxyStanzaEvents'] = jest.fn();

    const fakeExtension = {
      configureNewStanzaInstance: jest.fn().mockResolvedValue(null),
      handleStanzaInstanceChange: jest.fn()
    }

    client['extensions'] = [fakeExtension];

    client.on('connected', () => {
      fail('This should not have happened');
    });

    await expect(client['makeConnectionAttempt']()).rejects.toThrow();
    expect(emitSpy).toHaveBeenCalled();
    expect(addHandlersSpy).toHaveBeenCalled();
    expect(proxyEventsSpy).toHaveBeenCalled();
    expect(client.connected).toBeFalsy();
    expect(client.connecting).toBeTruthy();
    expect(cleanupSpy).toHaveBeenCalled();
    expect(fakeInstance.pinger.stop).toHaveBeenCalled();
    expect(fakeInstance.serverMonitor.stop).toHaveBeenCalled();
    expect(fakeInstance.disconnect).toHaveBeenCalled();
  });
});

describe('setupConnectionMonitoring', () => {
  let pingerMock: jest.Mock<Ping>;
  let serverMonitorMock: jest.Mock<ServerMonitor>;

  beforeEach(() => {
    pingerMock = Ping as any;
    pingerMock.mockClear();

    serverMonitorMock = ServerMonitor as any;
    serverMonitorMock.mockClear();
  });

  it('uses client-side pings if useServerSidePings is false', async () => {
    const opts = {...getDefaultOptions(), useServerSidePings: false};
    let client = new Client(opts);

    client['prepareForConnect'] = jest.fn();
    client['connectionManager'].getNewStanzaConnection = jest.fn().mockResolvedValue({});
    client['addInateEventHandlers'] = jest.fn();
    client['proxyStanzaEvents'] = jest.fn();
    client['extensions'] = [];

    await client['makeConnectionAttempt']();
    expect(pingerMock).toHaveBeenCalled();
    expect(serverMonitorMock).not.toHaveBeenCalled();
  });

  it('uses client-side pings if server-side pings aren\'t available', async () => {
    let client = new Client(getDefaultOptions());

    client['prepareForConnect'] = jest.fn();
    const mockSubscribeToNode = () => {
      throw new Error('pretending server-side pings don\'t work');
    };
    client['connectionManager'].getNewStanzaConnection = jest.fn().mockResolvedValue({
      subscribeToNode: mockSubscribeToNode
    });
    client['addInateEventHandlers'] = jest.fn();
    client['proxyStanzaEvents'] = jest.fn();
    client['extensions'] = [];

    await client['makeConnectionAttempt']();
    expect(pingerMock).toHaveBeenCalled();
    expect(serverMonitorMock).not.toHaveBeenCalled();
  });

  it('uses server-side pings if available', async () => {
    let client = new Client(getDefaultOptions());

    client['prepareForConnect'] = jest.fn();
    const subscribeToNodeSpy = jest.fn().mockResolvedValue({});
    client['connectionManager'].getNewStanzaConnection = jest.fn().mockResolvedValue({
      subscribeToNode: subscribeToNodeSpy
    });
    client['addInateEventHandlers'] = jest.fn();
    client['proxyStanzaEvents'] = jest.fn();
    client['extensions'] = [];

    await client['makeConnectionAttempt']();
    expect(pingerMock).not.toHaveBeenCalled();
    expect(serverMonitorMock).toHaveBeenCalled();
    expect(subscribeToNodeSpy).toHaveBeenCalledWith(expect.any(String), 'enable.server.side.pings');
  });
});

describe('prepareForConnect', () => {
  let client: Client;
  let httpSpy: jest.Mock;
  let setConfigSpy = jest.mock;

  beforeEach(() => {
    client = new Client({
      host: defaultOptions.host
    });

    setConfigSpy = client['connectionManager'].setConfig = jest.fn();
    httpSpy = client.http.requestApi = jest.fn().mockImplementation((path) => {
      const promise = new Promise((resolve, reject) => {
        if (path === 'users/me') {
          return resolve({ data: { chat: { jabberId: 'myRequestedJid' } } });
        } else if (path.startsWith('notifications/channels')) {
          return resolve({ data: { id: 'myNotiChannel' } });
        }

        reject('unknown path');
      });

      return promise;
    })
  });

  it('should set config and not request jid and channel if jwt', async () => {
    client.config.jwt = "myjwt";

    await client['prepareForConnect']();

    expect(setConfigSpy).toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
  });

  it('should do nothing if not jwt and not hardReconnectRequired', async () => {
    client.hardReconnectRequired = false;

    await client['prepareForConnect']();
    expect(setConfigSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
  });

  it('should fetch jid if it doesnt have one', async () => {
    await client['prepareForConnect']();
    expect(httpSpy).toHaveBeenCalledTimes(2);
    expect(client.config).toEqual(expect.objectContaining({
      jid: 'myRequestedJid',
      channelId: 'myNotiChannel'
    }));

    expect(client.hardReconnectRequired).toBeFalsy();
    expect(setConfigSpy).toHaveBeenCalled();
  });

  it('should not fetch jid if it already had one', async () => {
    client.config.jid = 'myJid';

    await client['prepareForConnect']();
    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(client.config).toEqual(expect.objectContaining({
      jid: 'myJid',
      channelId: 'myNotiChannel'
    }));

    expect(client.hardReconnectRequired).toBeFalsy();
    expect(setConfigSpy).toHaveBeenCalled();
  });

  it('should set hardReconnectRequired if max channel reuses are hit', async () => {
    client.hardReconnectRequired = false;
    client['channelReuses'] = 11;

    await client['prepareForConnect']();
    expect(setConfigSpy).toHaveBeenCalled();
    expect(httpSpy).toHaveBeenCalled();
    expect(client['channelReuses']).toEqual(0);
    expect(client.hardReconnectRequired).toBeFalsy();
  });
});

describe('proxyStanzaEvents', () => {
  it('should remap the disconnected event', () => {
    const client = new Client(getDefaultOptions());
    const stanza = new EventEmitter();

    const clientHandler = jest.fn();
    const clientHandler2 = jest.fn();
    const stanzaHandler = jest.fn();

    client.on('disconnected', clientHandler);
    client.on('stanzaDisconnected', clientHandler2);
    stanza.on('disconnected', stanzaHandler);
    client['proxyStanzaEvents'](stanza as any);

    stanza.emit('disconnected');

    expect(clientHandler).not.toHaveBeenCalled();
    expect(clientHandler2).toHaveBeenCalled();
    expect(stanzaHandler).toHaveBeenCalled();
  });

  it('should swallow the connected event', () => {
    const client = new Client(getDefaultOptions());
    const stanza = new EventEmitter();

    const clientHandler = jest.fn();
    const stanzaHandler = jest.fn();

    client.on('connected', clientHandler);
    stanza.on('connected', stanzaHandler);
    client['proxyStanzaEvents'](stanza as any);

    stanza.emit('connected');

    expect(clientHandler).not.toHaveBeenCalled();
    expect(stanzaHandler).toHaveBeenCalled();
  });

  it('events emitted by stanza should be emitted by the client', () => {
    const client = new Client(getDefaultOptions());
    const stanza = new EventEmitter();

    const testEventData = { id: 'test' };

    const handler = jest.fn();

    client.on('myTestEvent', handler);

    stanza.emit('myTestEvent', testEventData);

    expect(handler).not.toHaveBeenCalled();

    client['proxyStanzaEvents'](stanza as any);
    stanza.emit('myTestEvent', testEventData);

    expect(handler).toHaveBeenCalledWith(testEventData);
  });
});

describe('addInateEventHandlers', () => {
  it('should proxy iq stanzas to all extensions', () => {
    const client = new Client(getDefaultOptions());

    const ext1 = {
      handleIq: jest.fn(),
      handleMessage: jest.fn()
    };

    const ext2 = {
      handleIq: jest.fn(),
      handleMessage: jest.fn()
    };

    client['extensions'] = [ext1, ext2] as any;

    const stanza = new EventEmitter();
    client['addInateEventHandlers'](stanza as any);

    stanza.emit('iq', { id: 'iqId' });
    expect(ext1.handleIq).toHaveBeenCalledWith({ id: 'iqId' });
    expect(ext2.handleIq).toHaveBeenCalledWith({ id: 'iqId' });
    expect(ext1.handleMessage).not.toHaveBeenCalled();
    expect(ext2.handleMessage).not.toHaveBeenCalled();
  });

  it('should proxy message stanzas to all extensions', () => {
    const client = new Client(getDefaultOptions());

    const ext1 = {
      handleIq: jest.fn(),
      handleMessage: jest.fn()
    };

    const ext2 = {
      handleIq: jest.fn(),
      handleMessage: jest.fn()
    };

    client['extensions'] = [ext1, ext2] as any;

    const stanza = new EventEmitter();
    client['addInateEventHandlers'](stanza as any);

    stanza.emit('message', { id: 'messageId' });
    expect(ext1.handleIq).not.toHaveBeenCalled();
    expect(ext2.handleIq).not.toHaveBeenCalled();
    expect(ext1.handleMessage).toHaveBeenCalledWith({ id: 'messageId' });
    expect(ext2.handleMessage).toHaveBeenCalledWith({ id: 'messageId' });
  });
});

describe('handleStanzaDisconnectedEvent', () => {
  let client: Client;
  let connectSpy: jest.Mock;
  let fakeStanza: NamedAgent;

  beforeEach(() => {
    client = new Client(getDefaultOptions());

    fakeStanza = {
      emit: jest.fn(),
      pinger: { stop: jest.fn() },
      serverMonitor: { stop: jest.fn() }
    } as any;

    client.connected = true;

    client.activeStanzaInstance = fakeStanza;

    connectSpy = client.connect = jest.fn().mockResolvedValue(null);
  });

  it('should not reconnect if not autoReconnect', async () => {
    client['autoReconnect'] = false;

    const disconnectHandler = jest.fn();
    client.on('disconnected', disconnectHandler);

    await client['handleStanzaDisconnectedEvent'](fakeStanza);

    expect(client.connected).toBeFalsy();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(disconnectHandler).toHaveBeenCalled();
  });

  it('should reconnect if autoReconnect', async () => {
    client['autoReconnect'] = true;
    fakeStanza.pinger = undefined;
    fakeStanza.serverMonitor = undefined;

    const disconnectHandler = jest.fn();
    client.on('disconnected', disconnectHandler);

    await client['handleStanzaDisconnectedEvent'](fakeStanza);

    expect(client.connected).toBeFalsy();
    expect(disconnectHandler).toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalled();
  });

  it('should unproxy events', async () => {
    client['autoReconnect'] = false;

    fakeStanza.originalEmitter = {} as any;

    await client['handleStanzaDisconnectedEvent'](fakeStanza);

    expect(fakeStanza.emit).toBe(fakeStanza.originalEmitter);
  });
});

describe('handleNoLongerSubscribed', () => {
  let client: Client;
  let fakeStanza: NamedAgent;

  beforeEach(() => {
    client = new Client(getDefaultOptions());

    fakeStanza = {
      emit: jest.fn(),
      pinger: { stop: jest.fn() },
      serverMonitor: { stop: jest.fn() }
    } as any;

    client.connected = true;

    client.activeStanzaInstance = fakeStanza;
  });

  it('should set autoReconnect to false', () => {
    client.hardReconnectRequired = false;
    client.reconnectOnNoLongerSubscribed = false;
    client['autoReconnect'] = true;

    client['handleNoLongerSubscribed'](fakeStanza);

    expect(client['autoReconnect']).toBeFalsy();
  });

  it('should set hardReconnect to true', () => {
    client.hardReconnectRequired = false;
    client.reconnectOnNoLongerSubscribed = true;
    client['autoReconnect'] = true;
    fakeStanza.pinger = undefined;
    fakeStanza.serverMonitor = undefined;

    client['handleNoLongerSubscribed'](fakeStanza);

    expect(client['autoReconnect']).toBeTruthy();
  });
});

describe('handleDuplicateId', () => {
  let client: Client;
  let fakeStanza: NamedAgent;

  beforeEach(() => {
    client = new Client(getDefaultOptions());

    fakeStanza = {
      emit: jest.fn(),
      pinger: { stop: jest.fn() },
      serverMonitor: { stop: jest.fn() }
    } as any;

    client.connected = true;

    client.activeStanzaInstance = fakeStanza;
  });

  it('should set hardReconnect to true', () => {
    client.hardReconnectRequired = false;
    fakeStanza.pinger = undefined;
    fakeStanza.serverMonitor = undefined;

    client['handleDuplicateId'](fakeStanza);

    expect(client['hardReconnectRequired']).toBeTruthy();
  });

  it('should set hardReconnect to true - with pinger', () => {
    client.hardReconnectRequired = false;
    const spy = jest.fn();
    fakeStanza.pinger = { stop: spy } as any;
    fakeStanza.serverMonitor = { stop: spy } as any;

    client['handleDuplicateId'](fakeStanza);

    expect(client['hardReconnectRequired']).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('handleSendEventFromExtension', () => {
  let client: Client;
  let sendIqSpy: jest.Mock;
  let sendMessageSpy: jest.Mock;

  beforeEach(() => {
    client = new Client(getDefaultOptions());

    sendIqSpy = jest.fn();
    sendMessageSpy = jest.fn();
    client.activeStanzaInstance = {
      sendIQ: sendIqSpy,
      sendMessage: sendMessageSpy
    } as any;
  });

  it('extension.on(send) will send a stanza', async () => {
    (client as any)._testExtension.emit('send', { some: 'stanza' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sendIqSpy).toHaveBeenCalledTimes(1);
  });

  it('extension.on(send) will send a message stanza', async () => {
    (client as any)._testExtension.emit('send', { some: 'stanza' }, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('should log a message if no active stanza instance', async () => {
    const logSpy = client.logger.warn = jest.fn();

    client.activeStanzaInstance = undefined;
    client['handleSendEventFromExtension']((client as any)._testExtension, {});
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(logSpy).toHaveBeenCalledWith('cannot send message, no active stanza client', expect.anything(), expect.anything());
  });

  it('it will rate limit extensions sending stanzas', async () => {
    for (let i = 0; i < 100; i++) {
      (client as any)._testExtension.emit('send', { some: 'data' });
    }

    await new Promise(resolve => setTimeout(resolve, 1001));


    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value)).toBeLessThanOrEqual(deviation);
    }
    within((sendIqSpy).mock.calls.length, 45, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 70, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 95, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 100, 3);
  });

  it('it will rate limit extensions with their own tokenBucket', async () => {
    Client.extend('tokenBucket', class CustomExtension extends WildEmitter {
      tokenBucket: any;

      constructor () {
        super();
        this.tokenBucket = new TokenBucket(40, 50, 1000);
        this.tokenBucket.content = 40;
      }
    } as any);
    const client = new Client(getDefaultOptions() as any);
    client.activeStanzaInstance = {
      sendIQ: sendIqSpy,
      sendMessage: sendMessageSpy
    } as any;

    for (let i = 0; i < 200; i++) {
      (client as any)._tokenBucket.emit('send', { some: 'data' });
    }

    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value) <= deviation).toBe(true);
    }
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 90, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 140, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 190, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((sendIqSpy).mock.calls.length, 200, 3);
  });
});

describe('setAccessToken()', () => {
  it('should update token and logger token', () => {
    const token = 'I_AM_A_NEW_TOKEN';
    const client = new Client(getDefaultOptions() as any);
    const loggerSpy = jest.spyOn(client.logger, 'setAccessToken');

    expect(client.config.authToken).toBe(defaultOptions.authToken);

    client.setAccessToken(token);

    expect(client.config.authToken).toBe(token);
    expect(loggerSpy).toHaveBeenCalledWith(token);
  });
});

describe('versions', () => {
  it('it will return the static app version', () => {
    expect(Client.version).toBe('__STREAMING_CLIENT_VERSION__');
  });

  it('it will return the app version', () => {
    const client = new Client(getDefaultOptions() as any);
    expect(client.version).toBe('__STREAMING_CLIENT_VERSION__');
  });
});

describe('startServerLogging', () => {
  it('should tell the logger to start', () => {
    const client = new Client(getDefaultOptions() as any);
    const spy = client.logger.startServerLogging = jest.fn();

    client.startServerLogging();
    expect(spy).toHaveBeenCalled();
  });
});

describe('stopServerLogging', () => {
  it('should send everything then stop', () => {
    const client = new Client(getDefaultOptions() as any);
    const spy = client.logger.stopServerLogging = jest.fn();

    client.stopServerLogging();
    expect(spy).toHaveBeenCalled();
  });
});

describe('extend', () => {
  it('extend throws if an extension is already registered to a namespace', () => {
    expect(() => {
      Client.extend('testExtension', () => { });
    }).toThrow();
  });
});

describe('JID maintenance', () => {
  let client: Client;
  let httpSpy: jest.SpyInstance;
  let setConfigSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new Client({
      host: 'wss://streaming.example.com',
      apiHost: 'api.example.com'
    });

    client.http = {
      requestApi: jest.fn().mockImplementation((path) => {
        if (path === 'users/me') {
          return Promise.resolve({ data: { chat: { jabberId: 'test-jid' } } });
        }
        if (path === 'notifications/channels?connectionType=streaming') {
          return Promise.resolve({ data: { id: 'test-channel' } });
        }
        return Promise.reject(new Error('Unexpected path'));
      })
    } as any;

    httpSpy = jest.spyOn(client.http, 'requestApi');
    setConfigSpy = jest.spyOn(client['connectionManager'], 'setConfig');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should maintain same JID resource across hard reconnects', async () => {
    client['jidResource'] = 'mocked-uuid';
    await client['prepareForConnect']();
    expect(httpSpy).toHaveBeenCalledWith('users/me', expect.any(Object));
    expect(client.config.jid).toBe('test-jid');
    expect(client.config.jidResource).toBe('mocked-uuid');


    client.hardReconnectRequired = true;
    httpSpy.mockClear();

    await client['prepareForConnect']();
    expect(httpSpy).not.toHaveBeenCalledWith('users/me', expect.any(Object));
    expect(client.config.jid).toBe('test-jid');
    expect(client.config.jidResource).toBe('mocked-uuid');
  });

  it('should use provided JID resource if available', async () => {
    client = new Client({
      host: 'wss://streaming.example.com',
      apiHost: 'api.example.com',
      jid: 'provided-jid',
      jidResource: 'provided-jid-resource',
    });

    client.http = {
      requestApi: jest.fn().mockImplementation((path) => {
        if (path === 'users/me') {
          return Promise.resolve({ data: { chat: { jabberId: 'test-jid' } } });
        }
        if (path === 'notifications/channels?connectionType=streaming') {
          return Promise.resolve({ data: { id: 'test-channel' } });
        }
        return Promise.reject(new Error('Unexpected path'));
      })
    } as any;

    httpSpy = jest.spyOn(client.http, 'requestApi');
    setConfigSpy = jest.spyOn(client['connectionManager'], 'setConfig');

    client.hardReconnectRequired = true;
    await client['prepareForConnect']();

    expect(httpSpy).not.toHaveBeenCalledWith('users/me', expect.any(Object));
    expect(client['jidResource']).toBe('provided-jid-resource');
    expect(client.config.jid).toBe('provided-jid');
    expect(client.config.jidResource).toBe('provided-jid-resource');
  });

  it('should pass maintained JID resource to new stanza instances', async () => {
    await client['prepareForConnect']();
    const jidResource = client['jidResource'];

    const connectionManager = client['connectionManager'];
    const stanzaOptions = connectionManager['getStandardOptions']();

    expect(stanzaOptions.resource).toBe(jidResource);
  });
});
