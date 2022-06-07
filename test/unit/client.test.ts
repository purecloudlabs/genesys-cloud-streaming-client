import WildEmitter from 'wildemitter';
import { TokenBucket } from 'limiter';
import nock from 'nock';

import { Client } from '../../src/client';

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

function wait (ms: number = 2000) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// const crypto = require('crypto');
// global.crypto = {
//   getRandomValues: function (rawBytes) {
//     return {
//       buffer: crypto.randomBytes(rawBytes.length)
//     };
//   }
// } as any;

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

describe('Client', () => {
  it('client creation', () => {
    const client = new Client(getDefaultOptions() as any);
    expect(typeof client.on).toBe('function');
    expect(typeof client.connect).toBe('function');
    expect(client.notifications).toBeTruthy();
  });

  it('connect will reject if the session:started event is never emitted', () => {
    expect.assertions(1);
    const client = new Client(getDefaultOptions() as any);
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => undefined);
    mockApi();
    return client.connect()
      .catch(() => {
        expect(true).toBeTruthy();
      });
  }, 12 * 1000);

  it('connect will not fetch the jid if it was provided in client options', () => {
    const client = new Client(getDefaultOptions() as any);
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {} as any));
    const apis = mockApi();
    return client.connect()
      .then(() => {
        expect(apis.me.isDone()).toBe(false);
      });
  });

  it('connect will fetch the jid if not provided', () => {
    const client = new Client({
      host: defaultOptions.host,
      authToken: defaultOptions.authToken
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {} as any));
    const apis = mockApi();
    return client.connect()
      .then(() => {
        return client.notifications.bulkSubscribe(['test']);
      })
      .then(() => {
        apis.api.done();
        expect(apis.me.isDone()).toBe(true);
        expect(apis.channel.isDone()).toBe(true);
      });
  });

  it('connect will fetch the jid if not provided with a custom api host', () => {
    const client = new Client({
      host: 'wss://localhost:3000',
      apiHost: 'https://api.example.com',
      authToken: defaultOptions.authToken
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {} as any));
    const apis = mockApi();
    return client.connect()
      .then(() => {
        return client.notifications.bulkSubscribe(['test']);
      })
      .then(() => {
        apis.api.done();
        expect(apis.me.isDone()).toBe(true);
        expect(apis.channel.isDone()).toBe(true);
      });
  });

  it('Will use anonymous authentication to connect if using a JWT instead of an authToken', async () => {
    const client = new Client({
      host: defaultOptions.host,
      jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'acd-asdfasdfkj@conference.example.orgspan.com' } }))
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => {
      client._stanzaio.emit('session:started', {} as any);
    });
    await client.connect();
    expect(client._stanzaio.config.credentials).toBeFalsy();
    expect(client._stanzaio.config.server).toBe('example.orgspan.com');
  });

  it('will throw if jid domain cannot be parsed from jid in jwt', () => {
    const client = new Client({
      host: defaultOptions.host,
      jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'example.orgspan.com' } }))
    });
    return client.connect()
      .then(() => fail()) // throws in promise chain, so promise should not succeed
      .catch(() => expect(true).toBeTruthy()); // it threw, success
  });

  it('extend add an extension for creating clients', () => {
    class TestExtension {
      on () { }
      off () { }
      get expose () {
        return { foo () { } };
      }
    }
    Client.extend('test1234', TestExtension as any);
    const client = new Client(getDefaultOptions() as any);
    expect(typeof (client as any)._test1234.on).toBe('function');
    expect(typeof (client as any).test1234.foo).toBe('function');
  });

  it('should call handleIq or handleMessage on those events, if an extension registered for them', () => {
    expect.assertions(2);
    const testIq = { to: 'you', from: 'someone' };
    const testMessage = { to: 'you', from: 'someoneElse' };
    class TestExtension {
      on () { }
      off () { }
      handleIq (stanza) {
        expect(stanza).toBe(testIq);
      }
      handleMessage (stanza) {
        expect(stanza).toBe(testMessage);
      }
    }

    Client.extend('testIqAndMessageHandlers', TestExtension as any);
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.emit('iq', testIq as any);
    client._stanzaio.emit('message', testMessage);
  });

  it('Should begin to reconnect when it becomes disconnected', () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true;

    return new Promise<void>(resolve => {
      client._stanzaio.connect = jest.fn().mockImplementation(() => {
        client._stanzaio.emit('connected');
        resolve();
      });
      client._stanzaio.emit('disconnected', { conn: { url: 'wss://streaming.inindca.com/stream/channels/streaming-cgr4iprj4e8038aluvgmdn74fr' } } as any);
    });
  });

  it('Should not begin to reconnect when it becomes disconnected if autoReconnect is off', async () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.emit('disconnected', {} as any);
    jest.spyOn(client._stanzaio, 'emit').mockReturnValue(undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._stanzaio.emit).not.toHaveBeenCalled();
  });

  it('Should not reconnect if already reconnecting', async () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    client.connecting = true;
    jest.spyOn(client._reconnector, 'start').mockReturnValue(undefined);
    jest.spyOn(client.logger, 'warn').mockReturnValue(void 0);
    client._stanzaio.emit('disconnected', undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._reconnector.start).not.toHaveBeenCalled();
  });

  it('Should not reconnect if stanza has an active transport', async () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    client._stanzaio.transport = {} as any;
    jest.spyOn(client._reconnector, 'start').mockReturnValue(undefined);
    jest.spyOn(client.logger, 'warn').mockReturnValue(void 0);
    client._stanzaio.emit('disconnected', undefined);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._reconnector.start).not.toHaveBeenCalled();
  });

  it('Should not reconnect if disconnect is triggered with no event', async () => {
    const client = new Client(getDefaultOptions() as any);
    expect(client.autoReconnect).toBe(false);
    jest.spyOn(client._reconnector, 'start').mockReturnValue(undefined);
    client._stanzaio.emit('disconnected', {} as any);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._reconnector.start).not.toHaveBeenCalled();
  });

  it('Disconnecting explicitly will set autoReconnect to false', async () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } } as any));
    await client.disconnect();
    expect(client.autoReconnect).toBe(false);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });

  it('connecting to stanza with a timeout, should call through to stanza to stop any pending connection', async () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.connect = jest.fn();
    client._stanzaio.disconnect = jest.fn();

    const promise = client._connectStanza();
    /* simulate stanza attempting to connect */
    client._stanzaio.transport = {} as any; /* fake WS */
    /* wait for the timeout to trip */
    await wait(1100);
    expect(client._stanzaio.connect).toHaveBeenCalled();

    try {
      await promise;
      fail('should have thrown');
    } catch (error) {
      expect(error.message.startsWith('Timeout: ')).toBeTruthy();
      expect(client._stanzaio.disconnect).toHaveBeenCalled();
    }
  }, 15000);

  it('when connecting to stanza and stanza throws an error (in the form of a disconnect), we should reject with that error', async () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.connect = jest.fn();

    const promise = client._connectStanza();
    /* simulate stanza attempting to connect */
    client._stanzaio.transport = {} as any; /* fake WS */
    client._stanzaio.emit('--transport-disconnected'); /* fake WS error */

    try {
      await promise;
      fail('should have thrown');
    } catch (error) {
      expect(error.message.startsWith('unexpected disconnect')).toBeTruthy();
    }
  });

  it('when connecting to stanza when there is already an active WS should disconnect it and not throw an error on the discconect event', async () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.connect = jest.fn();

    /* simulate stanza already connected to a WS */
    client._stanzaio.transport = {} as any;
    const promise = client._connectStanza();

    /* simulate stanza disconnecting existing WS */
    client._stanzaio.emit('--transport-disconnected');
    /* then the new one connecting */
    client._stanzaio.emit('session:started', {} as any);

    await promise;

    expect('It did not reject on first --transport-disconnected event').toBeTruthy();
  });

  it('reconnect should disconnect but allow autoReconnect', async () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } } as any));
    client._stanzaio.connect = jest.fn().mockImplementation(() => client._stanzaio.emit('session:started', {} as any));
    await client.reconnect();
    expect(client.autoReconnect).toBe(true);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });

  it('sasl should ignore non-failures', () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } } as any));
    client._stanzaio.emit('sasl' as any, { type: 'success' } as any);
    expect(client._stanzaio.disconnect).not.toHaveBeenCalled();
  });

  it('sasl should disable autoReconnect and disconnect', () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } } as any));
    client._stanzaio.emit('sasl' as any, { type: 'failure' } as any);
    expect(client.autoReconnect).toBe(false);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });

  it('sasl temporary auth failure should not disable autoReconnect and disconnect', () => {
    const client = new Client(getDefaultOptions() as any);
    client.autoReconnect = true; /* defaults to false */
    expect(client.autoReconnect).toBe(true);
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } } as any));
    client._stanzaio.emit('sasl' as any, { type: 'failure', condition: 'temporary-auth-failure' });
    expect(client.autoReconnect).toBe(true);
    expect(client._stanzaio.disconnect).not.toHaveBeenCalled();
  });

  it('session:started event sets the client streamId', () => {
    const client = new Client(getDefaultOptions() as any);
    client._stanzaio.emit('session:started', { resource: 'foobar' } as any);
    expect(client.streamId).toBe('foobar');
    client._stanzaio.emit('session:end');
    expect(true).toBeTruthy(); // session end stops ping, no observable behavior on the client
  });

  it('extension.on(send) will send a stanza', async () => {
    const client = new Client(getDefaultOptions() as any);
    jest.spyOn(client._stanzaio, 'sendIQ').mockResolvedValue({} as any);
    (client as any)._testExtension.emit('send', { some: 'stanza' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client._stanzaio.sendIQ).toHaveBeenCalledTimes(1);
  });

  it('extension.on(send) will send a message stanza', async () => {
    const client = new Client(getDefaultOptions() as any);
    jest.spyOn(client._stanzaio, 'sendIQ').mockResolvedValue({} as any);
    jest.spyOn(client._stanzaio, 'sendMessage').mockReturnValue('');
    (client as any)._testExtension.emit('send', { some: 'stanza' }, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client._stanzaio.sendMessage).toHaveBeenCalledTimes(1);
    expect(client._stanzaio.sendIQ).not.toHaveBeenCalled();
  });

  it('it will rate limit extensions sending stanzas', async () => {
    const client = new Client(getDefaultOptions() as any);
    jest.spyOn(client._stanzaio, 'sendIQ').mockResolvedValue({} as any);
    for (let i = 0; i < 100; i++) {
      (client as any)._testExtension.emit('send', { some: 'data' });
    }
    await new Promise(resolve => setTimeout(resolve, 1001));

    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value) <= deviation).toBe(true);
    }
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 45, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 70, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 95, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 100, 3);
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
    jest.spyOn(client._stanzaio, 'sendIQ').mockResolvedValue({} as any);
    for (let i = 0; i < 200; i++) {
      (client as any)._tokenBucket.emit('send', { some: 'data' });
    }

    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value) <= deviation).toBe(true);
    }
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 90, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 140, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 190, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within((client._stanzaio.sendIQ as jest.Mock).mock.calls.length, 200, 3);
  });

  it('extend throws if an extension is already registered to a namespace', () => {
    expect(() => {
      Client.extend('testExtension', () => { });
    }).toThrow();
  });

  it('it will remap some events for our client to the underlying stanza client', async () => {
    const client = new Client(getDefaultOptions() as any);
    const connected = jest.fn();
    const _connected = jest.fn();
    const event = jest.fn();
    // event chaining works, too!
    client
      .on('session:started', connected)
      .on('connected', connected)
      .on('_connected', _connected)
      .once('other:event', event);
    client._stanzaio.emit('session:started', {} as any);
    expect(connected).toHaveBeenCalledTimes(2);
    expect(_connected).not.toHaveBeenCalled();
    client._stanzaio.emit('connected' as any, {} as any);
    expect(_connected).toHaveBeenCalledTimes(1);

    // once should only emit once
    client._stanzaio.emit('other:event' as any, {});
    client._stanzaio.emit('other:event' as any, {});
    expect(event).toHaveBeenCalledTimes(1);

    connected.mockReset();
    _connected.mockReset();
    client.off('session:started', connected);
    client.off('connected', connected);
    client.off('_connected', _connected);
    client._stanzaio.emit('session:started', {} as any);
    expect(connected).not.toHaveBeenCalled();
    expect(_connected).not.toHaveBeenCalled();
    client._stanzaio.emit('connected' as any, {});
    expect(_connected).not.toHaveBeenCalled();
  });

  it('it will return the static app version', () => {
    expect(Client.version).toBe('__STREAMING_CLIENT_VERSION__');
  });

  it('it will return the app version', () => {
    const client = new Client(getDefaultOptions() as any);
    expect(client.version).toBe('__STREAMING_CLIENT_VERSION__');
  });

  it('it will stop pinging and try to reconnect when it is no longer subscribed', () => {
    const client = new Client(getDefaultOptions() as any);
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    const pingSpy = jest.spyOn(client._ping, 'stop').mockReturnValue(undefined);
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    client._stanzaio.emit('notify:no_longer_subscribed' as any, { eventBody: { channelId } });
    expect(pingSpy).toHaveBeenCalled();
    expect(reconnectSpy).toHaveBeenCalled();
  });

  it('it will not try to reconnect on no_longer_subscribed if reconnectOnNoLongerSubscribed is false', () => {
    const options: any = getDefaultOptions();
    options.reconnectOnNoLongerSubscribed = false;
    const client = new Client(options);
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    const pingSpy = jest.spyOn(client._ping, 'stop').mockReturnValue(undefined);
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    client._stanzaio.emit('notify:no_longer_subscribed' as any, { eventBody: { channelId } });
    expect(pingSpy).toHaveBeenCalled();
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('it will try and hard reconnect if reconnect attempts limit hasn\'t been reached', () => {
    const client = new Client(getDefaultOptions() as any);
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    const eventPrefix = `notify:no_longer_subscribed`;

    client._stanzaio.emit(eventPrefix as any, { eventBody: { channelId } });

    expect(reconnectSpy).toHaveBeenCalled();

    reconnectSpy.mockReset();

    channelId = 'streaming-11284129848';
    client.config.channelId = channelId;
    client._stanzaio.emit(eventPrefix as any, { eventBody: { channelId } });
    expect(reconnectSpy).toHaveBeenCalled();

    reconnectSpy.mockReset();

    channelId = 'streaming-99694232382';
    client.config.channelId = channelId;
    client._stanzaio.emit(eventPrefix as any, { eventBody: { channelId } });
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  it('should start a timer when no_longer_subscribed is received; timer should decrement reconnect attempts', async () => {
    const client = new Client(getDefaultOptions() as any);
    client.reconnectLeakTime = 10;
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    const eventPrefix = `notify:no_longer_subscribed`;
    jest.spyOn(client, 'cleanupLeakTimer');

    client._stanzaio.emit(eventPrefix as any, { eventBody: { channelId } });

    expect(client.hardReconnectCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 15));

    expect(client.hardReconnectCount).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 15));

    expect(client.cleanupLeakTimer).toHaveBeenCalled();
  });

  it('should not reconnect if channelId is different than current channelId', () => {
    const client = new Client(getDefaultOptions() as any);
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = 'sdfkjsdkfjssldkfj';
    const eventPrefix = `notify:no_longer_subscribed`;

    client._stanzaio.emit(eventPrefix as any, { eventBody: { channelId } });

    expect(reconnectSpy).not.toHaveBeenCalled();
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
});
