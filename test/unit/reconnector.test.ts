import WildEmitter from 'wildemitter';
import { Agent, createClient } from 'stanza';
import { parse } from 'stanza/jxt';

import { Reconnector, CXFRDefinition } from '../../src/reconnector';
import { HttpClient } from '../../src/http-client';
import { flushPromises } from '../helpers/testing-utils';
import { ILogger } from '../../src/types/interfaces';

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
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  _stanzaio: WildEmitter & Agent;

  constructor (public connectTimeout?: number) {
    this.connectTimeout = connectTimeout;
    this._stanzaio = new MockStanzaIo(connectTimeout, this) as any;
  }

  on (event: string, cb: (...args: any) => void) {
    (this._stanzaio.on as any)(...arguments);
  }

  async connect () { }
  reconnect () { }
}

describe('Reconnector', () => {
  let logger: ILogger;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    SIMULTATE_ONLINE = false;
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.clearAllTimers();
    // flush any remaining promises
    // SANITY: promises get complicated when using
    //  fakeTimers. See this for reference:
    //  https://stackoverflow.com/questions/52177631/jest-timer-and-promise-dont-work-well-settimeout-and-async-function
    await new Promise(setImmediate);
  });

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

  xit('when started it reconnects on backoff (long reconnect)', () => {
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
    jest.spyOn(client, 'connect').mockResolvedValue();
    const reconnect = new Reconnector(client);
    reconnect.start();

    expect(client.connect).not.toHaveBeenCalled();

    // simulate 10 straight failures in backoff
    reconnect.backoff.backoffNumber_ = 10;
    client.connecting = false;
    jest.advanceTimersByTime(2000);

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  describe('hardReconnect()', () => {
    const step = async (ms = 15001) => {
      jest.advanceTimersByTime(ms);
      await flushPromises();
    }

    it('should successfully reconnect without waiting for retry interval', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect').mockResolvedValue(undefined);

      await reconnect.hardReconnect();
      // SANITY: jest.advanceTimers... is not needed because this
      //  function will instantly try to reconnect and _then_ add
      //  the setInterval to keep retrying

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should retry for network issues', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);

      /* timeout error from superagent */
      const superagentOfflineError = new Error('Request has been terminated\ncould be for some reason');

      // simulate 3 errors
      const connectSpy = jest.spyOn(client, 'connect')
        .mockRejectedValueOnce(superagentOfflineError)
        .mockRejectedValueOnce(superagentOfflineError)
        .mockRejectedValueOnce(superagentOfflineError)
        .mockResolvedValue(undefined);

      // have to run timers before awaiting this promise
      reconnect.hardReconnect();

      await step(0);
      await step();
      await step();
      await step();

      expect(connectSpy).toHaveBeenCalledTimes(4);
      expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should only retry if network is online', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect').mockResolvedValue(undefined);

      // simulate offline
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

      // have to run timers before awaiting this promise
      reconnect.hardReconnect();

      // first cycle
      await step();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(_stopHardReconnectSpy).not.toHaveBeenCalled();

      // second cycle (duplicate)
      await step();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(_stopHardReconnectSpy).not.toHaveBeenCalled();

      // third cycle (online)
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      await step();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should retry streaming-client throws a timeoutPromise', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect')
        .mockRejectedValueOnce(new Error('Timeout: connecting to streaming service'))
        .mockResolvedValueOnce(undefined); // then connects

      // have to run timers before awaiting this promise
      reconnect.hardReconnect();

      await step();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(_stopHardReconnectSpy).not.toHaveBeenCalled();

      await step();

      expect(connectSpy).toHaveBeenCalledTimes(2);
      expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should retry for retriable HTTP status codes', async () => {
      const test = async (statusCode: number) => {
        const client = new Client();
        const reconnect = new Reconnector(client);

        const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
        const error = new Error('Bad request or something');
        (error as any).status = statusCode;

        const connectSpy = jest.spyOn(client, 'connect')
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce(undefined); // then completes

        // have to run timers before awaiting this promise
        reconnect.hardReconnect();

        await step();

        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(_stopHardReconnectSpy).not.toHaveBeenCalled();

        await step();

        expect(connectSpy).toHaveBeenCalledTimes(2);
        expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
      };

      for (let it = HttpClient.retryStatusCodes.values(), val = null; val = it.next().value;) {
        await test(val);
      }
    });

    it('should re-use the current hard reconnect attempt if called a second time', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect')
        .mockResolvedValueOnce(undefined);

      // multiple calls before it completes
      reconnect.hardReconnect();
      reconnect.hardReconnect();
      reconnect.hardReconnect();

      await step();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('should throw if hard reconnect fails for non retriable error', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);
      const error = new Error('something broke');

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect').mockRejectedValue(error);

      try {
        await reconnect.hardReconnect();
        fail('should have thrown');
      } catch (e) {
        expect(e).toBe(error);
        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(1);
        expect(_stopHardReconnectSpy).toHaveBeenCalledWith(error);
      }
    });

    it('should convert error strings into error objects', async () => {
      const client = new Client();
      const reconnect = new Reconnector(client);
      const errorStr = 'something broke';
      const expectedError = new Error(errorStr);

      const _stopHardReconnectSpy = jest.spyOn(reconnect, '_stopHardReconnect' as any);
      const connectSpy = jest.spyOn(client, 'connect').mockResolvedValue(undefined);

      try {
        const hardReconnectPromise = reconnect.hardReconnect();
        reconnect.stop(errorStr);
        await hardReconnectPromise;
        fail('should have thrown');
      } catch (e) {
        expect(e).toEqual(expectedError);
        expect(connectSpy).toHaveBeenCalledTimes(1);
        expect(_stopHardReconnectSpy).toHaveBeenCalledTimes(2);
        expect(_stopHardReconnectSpy).toHaveBeenNthCalledWith(1, errorStr);
        expect(_stopHardReconnectSpy).toHaveBeenNthCalledWith(2, expectedError);
      }
    });
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

  it('will reconnect if an authorization error occurs after a connection has connected previously', async () => {
    const client = new Client();
    const reconnect = new Reconnector(client);
    reconnect.start();

    // move forward in time to where two connections should have been attempted.
    jest.advanceTimersByTime(350);
    expect(client.connectAttempts).toBe(1);

    /* let the second attempt be successful in connecting */
    SIMULTATE_ONLINE = true;
    jest.advanceTimersByTime(600);
    expect(client.connectAttempts).toBe(2);

    /* then reset our state (since we connected) */
    client.connectAttempts = 0;
    expect(reconnect._hasConnected).toBe(true);

    /* simulate an auth failure */
    client.connected = false;
    client._stanzaio.emit('sasl', { type: 'failure', condition: 'not-authorized' });
    jest.advanceTimersByTime(250);

    reconnect.start();
    jest.advanceTimersByTime(300);
    expect(client.connectAttempts).toBe(1);
    expect(client.connected).toBe(true); // should have successfully reconnected

    jest.advanceTimersByTime(10);

    /* clean up the test and make sure it didn't keep trying */
    await Promise.resolve();
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

  it('will wait to reconnect if called back with pending', async () => {
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

  it('will wait no longer than 1 hour after pending callback to reconnect', async () => {
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

  it('will reconnect after a second if no pending or done response is received', async () => {
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
