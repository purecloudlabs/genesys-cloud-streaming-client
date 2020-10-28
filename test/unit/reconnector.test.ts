'use strict';

import { Reconnector, CXFRDefinition } from '../../src/reconnector';
import WildEmitter from 'wildemitter';
import { Agent, createClient } from 'stanza';
import { parse } from 'stanza/jxt';

// controls whether clients can reconnect or not
let SIMULTATE_ONLINE = false;

class MockStanzaIo extends WildEmitter {
  emit!: (event: string, ...data: any) => void;
  constructor (public connectTimeout, public client) {
    super();
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
  connectAttempts = 0;
  connected = false;
  connecting = false;
  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  _stanzaio: WildEmitter & Agent;

  constructor (public connectTimeout?) {
    this.connectTimeout = connectTimeout;

    this.logger = {
      warn () { },
      error () { },
      debug () { },
      info () { }
    };

    this._stanzaio = new MockStanzaIo(connectTimeout, this) as any;
  }

  on (event: string, cb: (...args: any) => void) {
    (this._stanzaio.on as any)(...arguments);
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

  it('when started it reconnects on backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);
    client.connecting = false;

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);
    client.connecting = false;

    SIMULTATE_ONLINE = true;
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(3);
    expect(client.connected).toBe(true);
    client.connecting = false;

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(3);
  });

  it('when started it reconnects on backoff (long reconnect)', () => {
    const client = new Client(400);
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    delete client._stanzaio.transport;
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);
    expect(client.connecting).toBeTruthy();

    jest.advanceTimersByTime(450);
    expect(client.connectAttempts).toBe(1);

    jest.advanceTimersByTime(1100);
    SIMULTATE_ONLINE = true;
    jest.advanceTimersByTime(6000);
    expect(client.connectAttempts).toBe(1);
  });

  it('should not connect if has transport stream', () => {
    const client = new Client(400);
    const reconnect = new Reconnector(client);

    // move forward in time to where two connections should have been attempted.
    client._stanzaio.transport = {
      hasStream: true
    } as any;

    const spy = jest.spyOn(reconnect.backoff, 'backoff');
    client.connected = false;
    reconnect.start();

    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(0);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('when stopped it will cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);

    client.connecting = false;
    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);
    client.connecting = false;

    reconnect.stop();
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(2);
    expect(client.connected).toBe(false);
    client.connecting = false;

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(2);
  });

  it('will attempt a full reconnection after 10 failures', () => {
    const client = new Client();
    jest.spyOn(client, 'connect').mockReturnValue(undefined);
    const reconnect = new Reconnector(client);
    reconnect.start();

    expect(client.connect).not.toHaveBeenCalled();

    // simulate 10 straight failures in backoff
    reconnect.backoff.backoffNumber_ = 10;
    client.connecting = false;
    jest.advanceTimersByTime(2000);

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('when an auth failure occurs it will cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);
    client.connecting = false;

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);
    client.connecting = false;

    client._stanzaio.emit('sasl', { type: 'failure', condition: 'not-authorized' });
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(2);
    expect(client.connected).toBe(false);
    client.connecting = false;

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(2);
  });

  it('when a temporary auth failure occurs it will not cease the backoff', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);
    client.connecting = false;

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);
    client.connecting = false;

    client._stanzaio.emit('sasl', { type: 'failure', condition: 'temporary-auth-failure' });
    jest.advanceTimersByTime(1100);
    expect(client.connectAttempts).toBe(3);
    expect(client.connected).toBe(false);
    client.connecting = false;

    jest.advanceTimersByTime(2500);
    expect(client.connectAttempts).toBe(4);

    client._stanzaio.emit('sasl', { type: 'failure' });
  });

  it('will reconnect if an authorization error occurs after a connection has connected previously', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);
    client.connecting = false;

    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);
    client.connecting = false;

    reconnect._hasConnected = true;
    client._stanzaio.emit('sasl', { type: 'failure', condition: 'not-authorized' });
    client.connecting = false;
    jest.advanceTimersByTime(250);
    reconnect.start();
    client.connecting = false;
    jest.advanceTimersByTime(300);
    expect(client.connectAttempts).toBe(1);
    expect(client.connected).toBe(false);

    jest.advanceTimersByTime(10);
    client._stanzaio.emit('sasl', { type: 'failure' }); // now fail permanently to stop tests
    client.connecting = false;

    // make sure it didn't keep trying
    jest.advanceTimersByTime(10000);
    expect(client.connectAttempts).toBe(1);
  });

  it('when a connection transfer request comes in, will emit a reconnect request to the consuming application', async () => {
    // use a "real" stanza client to check the cxfr event
    const stanzaio = createClient({});
    const client = new Client();
    client._stanzaio = stanzaio as any;
    const reconnect = new Reconnector(client);
    jest.spyOn(client, 'reconnect').mockImplementation(() => {
      client._stanzaio.emit('reconnected');
    });

    client._stanzaio = stanzaio as any;
    stanzaio.stanzas.define(CXFRDefinition);

    client.on('requestReconnect', (handler) => {
      // handler({ done: true });
      setTimeout(() => handler({ done: true }), 1);
      jest.advanceTimersByTime(10);
    });

    const reconnected = new Promise(resolve => {
      client.on('reconnected', resolve);
    });

    const xml = parse(`
      <iq type='set' xmlns='jabber:client' from='jabber.org' to='user@jabber.org'><query xmlns='urn:xmpp:cxfr'><domain>jabber.org</domain><server>123.123.123.122</server></query></iq>
    `);
    const json = stanzaio.stanzas.import(xml);

    stanzaio.emit('stream:data', json, 'iq');

    // reconnect.client._stanzaio.emit('iq:set:cxfr', {
    //   cxfr: {
    //     domain: 'asdf.example.com',
    //     server: 'streaming.us-east-1.example.com'
    //   }
    // });

    jest.advanceTimersByTime(10);
    await Promise.resolve();

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

    reconnect.client._stanzaio.emit('iq:set:cxfr' as any, {
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

    reconnect.client._stanzaio.emit('iq:set:cxfr' as any, {
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

    reconnect.client._stanzaio.emit('iq:set:cxfr' as any, {
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

  it('should not backoff if already active', () => {
    const client = new Client();
    const reconnect = new Reconnector(client);

    const spy = jest.spyOn(reconnect.backoff, 'backoff');
    reconnect._backoffActive = true;

    reconnect.start();
    expect(spy).not.toHaveBeenCalled();
  });
});
