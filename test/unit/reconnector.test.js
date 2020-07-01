'use strict';

import Reconnector from '../../src/reconnector';
import WildEmitter from 'wildemitter';

// controls whether clients can reconnect or not
let SIMULTATE_ONLINE = false;

class MockStanzaIo extends WildEmitter {
  constructor (connectTimeout, client) {
    super();
    this.connectTimeout = connectTimeout;
    this.client = client;
  }
  get disco () {
    return {
      addFeature () { }
    };
  }
  get stanzas () {
    return {
      define () { },
      utils: {
        textSub () { }
      },
      extendIQ () { }
    };
  }

  connect () {
    this.client.connectAttempts++;
    setTimeout(() => {
      if (SIMULTATE_ONLINE) {
        this.emit('connected');
        this.client.connected = true;
      } else {
        this.emit('disconnected');
        this.client.connected = false;
      }
    }, this.connectTimeout || 10);
  }
}

class Client {
  constructor (connectTimeout) {
    this.connectTimeout = connectTimeout;
    this.connected = false;
    this.connectAttempts = 0;

    this.logger = {
      warn () { },
      error () { },
      debug () { },
      info () { }
    };

    this._stanzaio = new MockStanzaIo(connectTimeout, this);
  }

  on () {
    this._stanzaio.on(...arguments);
  }

  connect () {
    this.connectAttempts = 0;
  }
  reconnect () { }
}

describe('Reconnector', () => {
  beforeEach(() => {
    SIMULTATE_ONLINE = false;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  // all tests in this module are serial because we're messing with time

  test('when started it reconnects on backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);

    SIMULTATE_ONLINE = true;
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(4);
    expect(client.connected).toBe(true);

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(4);
  });

  test('when started it reconnects on backoff (long reconnect)', () => {
    const client = new Client(400);
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(200);
    client._stanzaio.transport = { conn: { readyState: 0 } };
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);

    client._stanzaio.transport = { conn: { readyState: 1 } };
    jest.advanceTimersByTime(450);
    expect(client.connectAttempts).toBe(1);

    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(1);
    client._stanzaio.transport = { conn: { readyState: 3 } };

    jest.advanceTimersByTime(3000);
    expect(client.connectAttempts).toBe(2);

    SIMULTATE_ONLINE = true;
    jest.advanceTimersByTime(6000);
    expect(client.connectAttempts).toBe(3);
    expect(client.connected).toBe(true);

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(3);
  });

  test('when started a second time it will not immediately retry the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    // Will not throw an error
    reconnect.start();
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);
  });

  test('when stopped it will cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);

    reconnect.stop();
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(3);
    expect(client.connected).toBe(false);

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(3);
  });

  test('will attempt a full reconnection after 10 failures', () => {
    const client = new Client();
    jest.spyOn(client, 'connect').mockReturnValue(undefined);
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    expect(client.connect).not.toHaveBeenCalled();

    // Fail a lot more
    jest.advanceTimersByTime(50000);
    expect(client.connectAttempts).toBeGreaterThan(10);

    // make sure client connect was called
    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  test('when an auth failure occurs it will cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);

    client._stanzaio.emit('sasl:failure', { condition: 'not-authorized' });
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(3);
    expect(client.connected).toBe(false);

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(3);
  });

  test('when a temporary auth failure occurs it will not cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);

    client._stanzaio.emit('sasl:failure', { condition: 'temporary-auth-failure' });
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(4);
    expect(client.connected).toBe(false);

    jest.advanceTimersByTime(2500);
    expect(client.connectAttempts).toBe(5);

    client._stanzaio.emit('sasl:failure');
  });

  test('will reconnect if an authorization error occurs after a connection has connected previously', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(2);

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(3);

    reconnect._hasConnected = true;
    client._stanzaio.emit('sasl:failure', { condition: 'not-authorized' });
    jest.advanceTimersByTime(250);
    reconnect.start();
    jest.advanceTimersByTime(30);
    expect(client.connectAttempts).toBe(1);
    expect(client.connected).toBe(false);

    jest.advanceTimersByTime(10);
    client._stanzaio.emit('sasl:failure'); // now fail permanently to stop tests

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(1);
  });

  test('when a connection transfer request comes in, will emit a reconnect request to the consuming application', async () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    jest.spyOn(client, 'reconnect').mockImplementation(() => {
      client._stanzaio.emit('reconnected');
    });

    client.on('requestReconnect', (handler) => {
      setTimeout(() => handler({ done: true }), 1);
    });

    const reconnected = new Promise(resolve => {
      client.on('reconnected', resolve);
    });

    reconnect.client._stanzaio.emit('iq:set:cxfr', {
      cxfr: {
        domain: 'asdf.example.com',
        server: 'streaming.us-east-1.example.com'
      }
    });

    jest.advanceTimersByTime(10);

    await reconnected;
  });

  test('will wait to reconnect if called back with pending', async () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    jest.spyOn(client, 'reconnect').mockImplementation(() => {
      client._stanzaio.emit('reconnected');
    });

    client.on('requestReconnect', (handler) => {
      setTimeout(() => handler({ pending: true }), 1);
      setTimeout(() => handler({ done: true }), 200);
    });

    const reconnected = new Promise(resolve => {
      client.on('reconnected', resolve);
    });

    reconnect.client._stanzaio.emit('iq:set:cxfr', {
      cxfr: {
        domain: 'asdf.example.com',
        server: 'streaming.us-east-1.example.com'
      }
    });

    jest.advanceTimersByTime(10);
    expect(client.reconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(client.reconnect).toHaveBeenCalledTimes(1);

    await reconnected;
  });

  test('will wait no longer than 1 hour after pending callback to reconnect', async () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    jest.spyOn(client, 'reconnect').mockImplementation(() => {
      client._stanzaio.emit('reconnected');
    });

    client.on('requestReconnect', (handler) => {
      setTimeout(() => handler({ pending: true }), 1);
    });

    const reconnected = new Promise(resolve => {
      client.on('reconnected', resolve);
    });

    reconnect.client._stanzaio.emit('iq:set:cxfr', {
      cxfr: {
        domain: 'asdf.example.com',
        server: 'streaming.us-east-1.example.com'
      }
    });

    jest.advanceTimersByTime(10);
    expect(client.reconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(client.reconnect).toHaveBeenCalledTimes(1);

    await reconnected;
  });

  test('will reconnect after a second if no pending or done response is received', async () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    jest.spyOn(client, 'reconnect').mockImplementation(() => {
      client._stanzaio.emit('reconnected');
    });

    client.on('requestReconnect', (handler) => {
      setTimeout(() => handler({ pending: true }), 2000); // too late
    });

    const reconnected = new Promise(resolve => {
      client.on('reconnected', resolve);
    });

    reconnect.client._stanzaio.emit('iq:set:cxfr', {
      cxfr: {
        domain: 'asdf.example.com',
        server: 'streaming.us-east-1.example.com'
      }
    });

    jest.advanceTimersByTime(10);
    expect(client.reconnect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(client.reconnect).toHaveBeenCalledTimes(1);

    await reconnected;
  });
});
