'use strict';

import WildEmitter from 'wildemitter';
import { TokenBucket } from 'limiter';
import atob from 'atob';
import btoa from 'btoa';
import nock from 'nock';

import Client from '../../src/client';

const defaultOptions = {
  jid: 'anon@example.mypurecloud.com',
  authToken: 'AuthToken',
  host: 'wss://streaming.example.com',
  logger: {
    warn () { },
    error () { },
    debug () { },
    info () { }
  }
};
Object.freeze(defaultOptions);

global.window.btoa = btoa;
global.window.atob = atob;

const crypto = require('crypto');
global.crypto = {
  getRandomValues: function (rawBytes) {
    return {
      buffer: crypto.randomBytes(rawBytes.length)
    };
  }
};

function getDefaultOptions () {
  return Object.assign({}, defaultOptions);
}

class TestExtension extends WildEmitter { }

Client.extend('testExtension', TestExtension);

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
  test('client creation', () => {
    const client = new Client(getDefaultOptions());
    expect(typeof client.on).toBe('function');
    expect(typeof client.connect).toBe('function');
    expect(client.notifications).toBeTruthy();
  });

  test('connect will reject if the session:started event is never emitted', () => {
    expect.assertions(1);
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:error', {}));
    mockApi();
    return client.connect()
      .catch(() => {
        expect(true).toBeTruthy();
      });
  }, 12 * 1000);

  test('connect will not fetch the jid if it was provided in client options', () => {
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {}));
    const apis = mockApi();
    return client.connect()
      .then(() => {
        expect(apis.me.isDone()).toBe(false);
      });
  });

  test('connect will fetch the jid if not provided', () => {
    const client = new Client({
      host: defaultOptions.host,
      authToken: defaultOptions.authToken
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {}));
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

  test('connect will fetch the jid if not provided with a custom api host', () => {
    const client = new Client({
      host: 'wss://localhost:3000',
      apiHost: 'https://api.example.com',
      authToken: defaultOptions.authToken
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(() => client._stanzaio.emit('session:started', {}));
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

  test('Will use anonymous authentication to connect if using a JWT instead of an authToken', () => {
    const client = new Client({
      host: defaultOptions.host,
      jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'acd-asdfasdfkj@conference.example.orgspan.com' } }))
    });
    jest.spyOn(client._stanzaio, 'connect').mockImplementation(opts => {
      expect(opts.sasl.length).toBe(1);
      expect(opts.sasl[0]).toBe('anonymous');
      expect(opts.server).toBe('example.orgspan.com');
      client._stanzaio.emit('session:started', {});
    });
    return client.connect();
  });

  test('will throw if jid domain cannot be parsed from jid in jwt', () => {
    const client = new Client({
      host: defaultOptions.host,
      jwt: 'test.' + window.btoa(JSON.stringify({ data: { jid: 'example.orgspan.com' } }))
    });
    return client.connect()
      .then(() => fail()) // throws in promise chain, so promise should not succeed
      .catch(() => expect(true).toBeTruthy()); // it threw, success
  });

  test('extend add an extension for creating clients', () => {
    class TestExtension {
      on () { }
      off () { }
      get expose () {
        return { foo () { } };
      }
    }
    Client.extend('test1234', TestExtension);
    const client = new Client(getDefaultOptions());
    expect(typeof client._test1234.on).toBe('function');
    expect(typeof client.test1234.foo).toBe('function');
  });

  test('should call handleIq or handleMessage on those events, if an extension registered for them', () => {
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

    Client.extend('testIqAndMessageHandlers', TestExtension);
    const client = new Client(getDefaultOptions());
    client._stanzaio.emit('iq', testIq);
    client._stanzaio.emit('message', testMessage);
  });

  test('Should see callbacks set when an iq callback is explicitly registered', () => {
    const client = new Client(getDefaultOptions());
    client._stanzaio.on('iq:set:myTestTopic', () => { });

    expect(client._stanzaio.callbacks['iq:set:myTestTopic'].length).toBe(1);
  });

  test('Should begin to reconnect when it becomes disconnected', () => {
    const client = new Client(getDefaultOptions());

    return new Promise(resolve => {
      client._stanzaio.connect = jest.fn().mockImplementation(() => {
        client._stanzaio.emit('connected');
        resolve();
      });
      client._stanzaio.emit('disconnected', { conn: { url: 'wss://streaming.inindca.com/stream/channels/streaming-cgr4iprj4e8038aluvgmdn74fr' } });
    });
  });

  test('Should begin to reconnect when it becomes disconnected', () => {
    const client = new Client(getDefaultOptions());

    return new Promise(resolve => {
      client._stanzaio.connect = jest.fn().mockImplementation(() => {
        client._stanzaio.emit('connected');
        resolve();
      });
      client._stanzaio.emit('disconnected', { conn: { url: 'wss://streaming.inindca.com/stream/channels/streaming-cgr4iprj4e8038aluvgmdn74fr' } });
    });
  });

  test('Should not begin to reconnect when it becomes disconnected if autoReconnect is off', async () => {
    const client = new Client(getDefaultOptions());
    client.autoReconnect = false;
    client._stanzaio.emit('disconnected', {});
    jest.spyOn(client._stanzaio, 'emit').mockReturnValue(null);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._stanzaio.emit).not.toHaveBeenCalled();
  });

  test('Should not reconnect if disconnect is triggered with no event and log a message if autoReconnect', async () => {
    const client = new Client(getDefaultOptions());
    client.autoReconnect = true;
    jest.spyOn(client._reconnector, 'start').mockReturnValue();
    jest.spyOn(client.logger, 'warn').mockReturnValue();
    client._stanzaio.emit('disconnected');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._reconnector.start).not.toHaveBeenCalled();
    expect(client.logger.warn).toHaveBeenCalledWith('Streaming client disconnected without an event notification. Not able to reconnect.');
  });

  test('Should not reconnect if disconnect is triggered with no event', async () => {
    const client = new Client(getDefaultOptions());
    client.autoReconnect = false;
    jest.spyOn(client._reconnector, 'start').mockReturnValue();
    client._stanzaio.emit('disconnected');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(client._reconnector.start).not.toHaveBeenCalled();
  });

  test('Disconnecting explicitly will set autoReconnect to false', () => {
    const client = new Client(getDefaultOptions());
    expect(client.autoReconnect).toBe(true);
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } }));
    client.disconnect();
    expect(client.autoReconnect).toBe(false);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });
  test('reconnect should disconnect but allow autoReconnect', () => {
    const client = new Client(getDefaultOptions());
    client._autoReconnect = false;
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } }));
    client._stanzaio.connect = jest.fn().mockImplementation(() => client._stanzaio.emit('session:started', {}));
    client.reconnect();
    expect(client.autoReconnect).toBe(true);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });

  test('sasl:failure should disable autoReconnect and disconnect', () => {
    const client = new Client(getDefaultOptions());
    expect(client.autoReconnect).toBe(true);
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } }));
    client._stanzaio.emit('sasl:failure');
    expect(client.autoReconnect).toBe(false);
    expect(client._stanzaio.disconnect).toHaveBeenCalledTimes(1);
  });

  test('temporary auth failure should not disable autoReconnect and disconnect', () => {
    const client = new Client(getDefaultOptions());
    expect(client.autoReconnect).toBe(true);
    client._stanzaio.disconnect = jest.fn().mockImplementation(() => client._stanzaio.emit('disconnected', { conn: { url: 'someurl' } }));
    client._stanzaio.emit('sasl:failure', { condition: 'temporary-auth-failure' });
    expect(client.autoReconnect).toBe(true);
    expect(client._stanzaio.disconnect).not.toHaveBeenCalled();
  });

  test('session:started event sets the client streamId', () => {
    const client = new Client(getDefaultOptions());
    client._stanzaio.emit('session:started', { resource: 'foobar' });
    expect(client.streamId).toBe('foobar');
    client._stanzaio.emit('session:end');
    expect(true).toBeTruthy(); // session end stops ping, no observable behavior on the client
  });

  test('extension.on(send) will send a stanza', async () => {
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'sendIq').mockReturnValue(null);
    client._testExtension.emit('send', { some: 'stanza' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client._stanzaio.sendIq).toHaveBeenCalledTimes(1);
  });

  test('extension.on(send) will send a message stanza', async () => {
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'sendIq').mockReturnValue(null);
    jest.spyOn(client._stanzaio, 'sendMessage').mockReturnValue(null);
    client._testExtension.emit('send', { some: 'stanza' }, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(client._stanzaio.sendMessage).toHaveBeenCalledTimes(1);
    expect(client._stanzaio.sendIq).not.toHaveBeenCalled();
  });

  test('it will rate limit extensions sending stanzas', async () => {
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'sendIq').mockReturnValue(null);
    for (let i = 0; i < 100; i++) {
      client._testExtension.emit('send', { some: 'data' });
    }
    await new Promise(resolve => setTimeout(resolve, 1001));

    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value) <= deviation).toBe(true);
    }
    within(client._stanzaio.sendIq.mock.calls.length, 45, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 70, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 95, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 100, 3);
  });

  test('it will rate limit extensions with their own tokenBucket', async () => {
    Client.extend('tokenBucket', class CustomExtension extends WildEmitter {
      constructor () {
        super();
        this.tokenBucket = new TokenBucket(40, 50, 1000);
        this.tokenBucket.content = 40;
      }
    });
    const client = new Client(getDefaultOptions());
    jest.spyOn(client._stanzaio, 'sendIq').mockReturnValue(null);
    for (let i = 0; i < 200; i++) {
      client._tokenBucket.emit('send', { some: 'data' });
    }

    // because timers in JS are not exact, add a 'within' expectation
    // saying that the value is +/- deviation of target
    function within (value, target, deviation) {
      expect(Math.abs(target - value) <= deviation).toBe(true);
    }
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 90, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 140, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 190, 3);
    await new Promise(resolve => setTimeout(resolve, 1001));
    within(client._stanzaio.sendIq.mock.calls.length, 200, 3);
  });

  test('extend throws if an extension is already registered to a namespace', () => {
    expect(() => {
      Client.extend('testExtension', () => { });
    }).toThrow();
  });

  test('it will remap some events for our client to the underlying stanza client', async () => {
    const client = new Client(getDefaultOptions());
    const connected = jest.fn();
    const _connected = jest.fn();
    const event = jest.fn();
    // event chaining works, too!
    client
      .on('session:started', connected)
      .on('connected', connected)
      .on('_connected', _connected)
      .once('other:event', event);
    client._stanzaio.emit('session:started', {});
    expect(connected).toHaveBeenCalledTimes(2);
    expect(_connected).not.toHaveBeenCalled();
    client._stanzaio.emit('connected', {});
    expect(_connected).toHaveBeenCalledTimes(1);

    // once should only emit once
    client._stanzaio.emit('other:event', {});
    client._stanzaio.emit('other:event', {});
    expect(event).toHaveBeenCalledTimes(1);

    connected.mockReset();
    _connected.mockReset();
    client.off('session:started', connected);
    client.off('connected', connected);
    client.off('_connected', _connected);
    client._stanzaio.emit('session:started', {});
    expect(connected).not.toHaveBeenCalled();
    expect(_connected).not.toHaveBeenCalled();
    client._stanzaio.emit('connected', {});
    expect(_connected).not.toHaveBeenCalled();
  });

  test('it will return the app version', () => {
    expect(Client.version).toBe('[AIV]{version}[/AIV]');
  });

  test('it will stop pinging and try to reconnect when it is no longer subscribed', () => {
    const client = new Client(getDefaultOptions());
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    const pingSpy = jest.spyOn(client._ping, 'stop').mockReturnValue(null);
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    client._stanzaio.emit('notify:v2.system.no_longer_subscribed.streaming-123812831', { eventBody: { channelId } });
    expect(pingSpy).toHaveBeenCalled();
    expect(reconnectSpy).toHaveBeenCalled();
  });

  test('it will not try to reconnect on no_longer_subscribed if reconnectOnNoLongerSubscribed is false', () => {
    const options = getDefaultOptions();
    options.reconnectOnNoLongerSubscribed = false;
    const client = new Client(options);
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    const pingSpy = jest.spyOn(client._ping, 'stop').mockReturnValue(null);
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    client._stanzaio.emit('notify:v2.system.no_longer_subscribed.streaming-123852831', { eventBody: { channelId } });
    expect(pingSpy).toHaveBeenCalled();
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  test('it will try and hard reconnect if reconnect attempts limit hasn\'t been reached', () => {
    const client = new Client(getDefaultOptions());
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    const eventPrefix = `notify:v2.system.no_longer_subscribed.`;

    client._stanzaio.emit(eventPrefix + channelId, { eventBody: { channelId } });

    expect(reconnectSpy).toHaveBeenCalled();

    reconnectSpy.mockReset();

    channelId = 'streaming-11284129848';
    client.config.channelId = channelId;
    client._stanzaio.emit(eventPrefix + channelId, { eventBody: { channelId } });
    expect(reconnectSpy).toHaveBeenCalled();

    reconnectSpy.mockReset();

    channelId = 'streaming-99694232382';
    client.config.channelId = channelId;
    client._stanzaio.emit(eventPrefix + channelId, { eventBody: { channelId } });
    expect(reconnectSpy).not.toHaveBeenCalled();
  });

  test('should start a timer when no_longer_subscribed is received; timer should decrement reconnect attempts', async () => {
    const client = new Client(getDefaultOptions());
    client.reconnectLeakTime = 10;
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = channelId;
    const eventPrefix = `notify:v2.system.no_longer_subscribed.`;
    jest.spyOn(client, 'cleanupLeakTimer');

    client._stanzaio.emit(eventPrefix + channelId, { eventBody: { channelId } });

    expect(client.hardReconnectCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 15));

    expect(client.hardReconnectCount).toBe(0);

    await new Promise(resolve => setTimeout(resolve, 15));

    expect(client.cleanupLeakTimer).toHaveBeenCalled();
  });

  test('should not reconnect if channelId is different than current channelId', () => {
    const client = new Client(getDefaultOptions());
    const reconnectSpy = jest.fn();
    client._reconnector.hardReconnect = reconnectSpy;
    let channelId = 'streaming-484824828';
    client.config.channelId = 'sdfkjsdkfjssldkfj';
    const eventPrefix = `notify:v2.system.no_longer_subscribed.`;

    client._stanzaio.emit(eventPrefix + channelId, { eventBody: { channelId } });

    expect(reconnectSpy).not.toHaveBeenCalled();
  });
});
