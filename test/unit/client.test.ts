import WildEmitter from 'wildemitter';
import { TokenBucket } from 'limiter';
import nock from 'nock';

import { Client } from '../../src/client';
import { Logger } from 'genesys-cloud-client-logger';
import * as utils from '../../src/utils';
import { AxiosError } from 'axios';
import SaslError from '../../src/types/sasl-error';
import { TimeoutError } from '../../src/types/timeout-error';
import OfflineError from '../../src/types/offline-error';
import { reject } from 'lodash';
import EventEmitter from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { flushPromises } from '../helpers/testing-utils';

jest.mock('genesys-cloud-client-logger');

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

function mockApi () {
  nock.restore();
  nock.cleanAll();
  nock.activate();
  const api = nock('https://api.example.com');
  const channel = api
    .post('/api/v2/notifications/channels', () => true)
    .query(true)
    .reply(200, { id: 'streaming-someid' });
  const me = api
    .get('/api/v2/users/me')
    .reply(200, { chat: { jabberId: defaultOptions.jid } });
  const subscriptions = api
    .post('/api/v2/notifications/channels/streaming-someid/subscriptions', () => true)
    .reply(202);
  return { api, channel, me, subscriptions };
}

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

  it('should do nothing if already connecting', async () => {
    client.connecting = true;
    await client.connect();
    expect(connectionAttemptSpy).not.toHaveBeenCalled();
  });

  it('should resolve if connection attempt is successful', async () => {
    connectionAttemptSpy.mockResolvedValue(null);

    await client.connect();
    expect(connectionAttemptSpy).toHaveBeenCalled();
  });

  it('should throw if connection attempt fails and no keepTryingOnFailure', async () => {
    const error = new Error('fake error');
    connectionAttemptSpy.mockRejectedValue(error);

    await expect(client.connect({ keepTryingOnFailure: false })).rejects.toThrow(error);
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle undefined error', async () => {
    connectionAttemptSpy.mockRejectedValue(undefined);

    await expect(client.connect({ keepTryingOnFailure: false })).rejects.toThrow('Streaming client connection attempted received and undefined error');
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
  });

  it('should throw if connection attempt fails and retry handler returns false', async () => {
    const error = new Error('fake error');
    connectionAttemptSpy.mockRejectedValue(error);
    backoffRetrySpy.mockReturnValue(false);

    await expect(client.connect({ keepTryingOnFailure: true })).rejects.toThrow(error);
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
    expect(backoffRetrySpy).toHaveBeenCalledTimes(1);
  });

  it('should massage AxiosError on failure', async () => {
    const error = new AxiosError('fake error', 'FAKE_ERROR', {
      url: 'fakeUrl',
      method: 'get'
    },
    undefined,
    { status: 401 } as any
    );
    connectionAttemptSpy.mockRejectedValue(error);

    const errorSpy = jest.spyOn(client.logger, 'error');

    await expect(client.connect({ keepTryingOnFailure: false })).rejects.toThrow(error);
    expect(errorSpy).toHaveBeenCalledWith('Failed to connect streaming client', {
      error: {
        config: {
          url: error.config.url,
          method: error.config.method
        },
        status: error.response?.status,
        code: error.code,
        name: error.name,
        message: error.message
      }
    });
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
  });
  
  it('should massage AxiosError (no response object) on failure', async () => {
    const error = new AxiosError('fake error', 'FAKE_ERROR', {
      url: 'fakeUrl',
      method: 'get'
    });
    connectionAttemptSpy.mockRejectedValue(error);

    const errorSpy = jest.spyOn(client.logger, 'error');

    await expect(client.connect({ keepTryingOnFailure: false })).rejects.toThrow(error);
    expect(errorSpy).toHaveBeenCalledWith('Failed to connect streaming client', {
      error: {
        config: {
          url: error.config.url,
          method: error.config.method
        },
        status: error.response?.status,
        code: error.code,
        name: error.name,
        message: error.message
      }
    });
    expect(connectionAttemptSpy).toHaveBeenCalledTimes(1);
  });
});

describe('disconnect', () => {
  let client: Client;

  beforeEach(() => {
    client = new Client(getDefaultOptions());
  });

  it('should do nothing if no stanza instance', async () => {
    client.activeStanzaInstance = undefined;

    const spy = client.http.stopAllRetries = jest.fn();

    await client.disconnect();

    expect(spy).not.toHaveBeenCalled();
  });

  it('should resolve when a disconnected event is received', async () => {
    let isResolved = false;

    const stanza = client.activeStanzaInstance = new EventEmitter() as any;

    stanza.disconnect = jest.fn();
    client.http.stopAllRetries = jest.fn();

    const promise = client.disconnect().then(() => isResolved = true);
    await flushPromises();

    expect(stanza.disconnect).toHaveBeenCalled();
    expect(isResolved).toBeFalsy();

    client.emit('disconnected');
    await flushPromises();

    expect(isResolved).toBeTruthy();
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

  it('should return false if not keepTryingOnFailure', async () => {
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 1 }, {}, 1)).toBeFalsy();
  });

  it('should return false if AxiosError with a 401 code', async () => {
    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get'
      },
      {},
      {
        status: 401
      } as any
    );
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 10 }, error, 1)).toBeFalsy();
  });
  
  it('should wait until retryAfter has elapsed (axiosError)', async () => {
    jest.useFakeTimers();

    const error = new AxiosError(
      'fake error',
      'FAKE_ERROR',
      {
        url: 'fakeUrl',
        method: 'get'
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
        method: 'get'
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
        method: 'get'
      },
      {} as any
    );
    expect(await client['backoffConnectRetryHandler']({ maxConnectionAttempts: 2 }, error, 1)).toBeTruthy();
  });

  it('should set hardReconnectRequired if SaslError', async () => {
    const error = new SaslError('not-authorized', 'channelId', 'instanceId');
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

  beforeEach(() => {
    client = new Client({
      host: defaultOptions.host
    });
    prepareSpy = client['prepareForConnect'] = jest.fn();
    getConnectionSpy = client['connectionManager'].getNewStanzaConnection = jest.fn();
  });

  it('should not attempt if offline', async () => {
    const spy = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(client['makeConnectionAttempt']()).rejects.toThrow(OfflineError);
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(getConnectionSpy).not.toHaveBeenCalled();

    spy.mockRestore();
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

  it('should clean up connection an extension fails configureNewStanzaInstance', async () => {
    const disconnectSpy = jest.fn();
    const fakeEmit = jest.fn();
    const fakeInstance = {
      disconnect: disconnectSpy,
      emit: null,
      originalEmitter: fakeEmit
    };
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
    expect(fakeInstance.emit).toBe(fakeEmit);
    expect(fakeInstance.disconnect).toHaveBeenCalled();
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
      const promise = new Promise(resolve => {
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
      pinger: { stop: jest.fn() }
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
      pinger: { stop: jest.fn() }
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

    client['handleNoLongerSubscribed'](fakeStanza);

    expect(client['autoReconnect']).toBeTruthy();
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
