import Logger from 'genesys-cloud-client-logger';
import { IClientConfig } from '../../src';
import { ConnectionManager } from '../../src/connection-manager';
import * as stanza from 'stanza';
import { EventEmitter } from 'stream';
import { flushPromises } from '../helpers/testing-utils';
import SaslError from '../../src/types/sasl-error';
import { SASLFailure } from 'stanza/protocol';
import * as utils from '../../src/utils';
import { TimeoutError } from '../../src/types/timeout-error';

jest.mock('genesys-cloud-client-logger');

let connectionManager: ConnectionManager;
let fakeLogger: jest.Mocked<Logger>;

beforeEach(() => {
  fakeLogger = new Logger({} as any) as any;
  connectionManager = new ConnectionManager(fakeLogger, {} as any);
});

describe('setConfig', () => {
  it('should set the config', () => {
    const newConfig: IClientConfig = {
      apiHost: 'test',
      channelId: 'channel',
      host: 'test2',
    };

    connectionManager.setConfig(newConfig);

    expect(connectionManager['config']).toBe(newConfig);
  });
});

describe('getNewStanzaConnection', () => {
  let createClientSpy: jest.SpyInstance;
  let fakeStanza: stanza.Agent;

  beforeAll(() => {
    fakeStanza = new EventEmitter() as any;
    fakeStanza.updateConfig = jest.fn();
    fakeStanza.connect = jest.fn();
    fakeStanza.disconnect = jest.fn();
    (fakeStanza as any).sasl = {
      mechanisms: [{ name: 'ANONYMOUS', priority: 2 }, { name: 'PLAIN', priority: 3 }]
    };

    createClientSpy = jest.spyOn(stanza, 'createClient').mockReturnValue(fakeStanza as any);
  });

  beforeEach(() => {
    connectionManager['getStanzaOptions'] = jest.fn();
  });

  afterAll(() => {
    createClientSpy.mockRestore();
  });

  it('should resolve when connected', async () => {
    let resolved = false;

    connectionManager['handleSessionStarted'] = jest.fn().mockImplementation((stanza, resolve) => {
      resolve(stanza);
    });

    const promise = connectionManager.getNewStanzaConnection()
      .then((instance) => {
        resolved = true;
        return instance;
      });
    await flushPromises();

    expect(resolved).toBeFalsy();
    fakeStanza.emit('session:started');
    await flushPromises();

    const instance = await promise;
    expect(instance).toBe(fakeStanza);
    expect(fakeStanza.disconnect).not.toHaveBeenCalled();
  });

  it('should listen on raw:incoming stanzas', async () => {
    const spy = connectionManager['checkForErrorStanza'] = jest.fn();

    (fakeStanza.connect as jest.Mock).mockImplementation(() => {
      fakeStanza.emit('raw:incoming', 'mystr1');
      fakeStanza.emit('raw:incoming', 'mystr2');
      fakeStanza.emit('raw:incoming', 'mystr3');
      fakeStanza.emit('session:started');
    });

    await connectionManager.getNewStanzaConnection();

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('should reject on sasl', async () => {
    connectionManager['handleSessionSasl'] = jest.fn().mockImplementation((stanza, reject, sasl) => {
      reject(new SaslError('not-authorized', '123', '345'));
    });

    (fakeStanza.connect as jest.Mock).mockImplementation(() => {
      const sasl: SASLFailure = {
        condition: 'not-authorized',
        type: 'failure'
      };
      fakeStanza.emit('sasl', sasl);
    });

    await expect(connectionManager.getNewStanzaConnection()).rejects.toThrow(SaslError);
  });

  it('should reject if disconnected', async () => {
    connectionManager['handleSessionDisconnected'] = jest.fn().mockImplementation((stanza, reject) => {
      reject();
    });

    (fakeStanza.connect as jest.Mock).mockImplementation(() => {
      fakeStanza.emit('disconnected', undefined);
    });

    await expect(connectionManager.getNewStanzaConnection()).rejects.toBeUndefined();
  });

  it('should call disconnect if connection times out', async () => {
    jest.useFakeTimers();

    (fakeStanza.connect as jest.Mock).mockReturnValue(null);

    connectionManager.getNewStanzaConnection().catch(e => {
      expect(e).toBeInstanceOf(TimeoutError);
    });

    await flushPromises();
    jest.advanceTimersByTime(12000);
    await flushPromises();

    expect(fakeStanza.disconnect).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('should remove temporary listeners', async () => {
    const connectSpy = connectionManager['handleSessionStarted'] = jest.fn().mockImplementation((stanza, resolve) => resolve(stanza));
    const saslSpy = connectionManager['handleSessionSasl'] = jest.fn();
    const disconnectedSpy = connectionManager['handleSessionDisconnected'] = jest.fn();
    const errorCheckSpy = connectionManager['checkForErrorStanza'] = jest.fn();

    (fakeStanza.connect as jest.Mock).mockImplementation(() => {
      fakeStanza.emit('session:started');
    });

    const instance = await connectionManager.getNewStanzaConnection();

    expect(connectSpy).toHaveBeenCalled();
    expect(saslSpy).not.toHaveBeenCalled();
    expect(disconnectedSpy).not.toHaveBeenCalled();
    expect(errorCheckSpy).not.toHaveBeenCalled();

    connectSpy.mockReset();

    instance.emit('session:started');
    instance.emit('raw:incoming', 'mystr');
    instance.emit('sasl', {} as any);
    instance.emit('disconnected', undefined);

    expect(connectSpy).not.toHaveBeenCalled();
    expect(saslSpy).not.toHaveBeenCalled();
    expect(disconnectedSpy).not.toHaveBeenCalled();
    expect(errorCheckSpy).not.toHaveBeenCalled();
  });
});

describe('handleSessionStarted', () => {
  it('should log and resolve', () => {
    const spy = jest.fn();

    const fakeStanza = {};

    connectionManager['handleSessionStarted'](fakeStanza as any, spy);

    expect(spy).toHaveBeenCalledWith(fakeStanza);
    expect(fakeLogger.info).toBeCalledWith('new stanza instance connected', expect.anything());
  });
});

describe('handleSessionSasl', () => {
  it('should reject if sasl failure', () => {
    const spy = jest.fn();

    const fakeStanza = {};

    connectionManager['handleSessionSasl'](fakeStanza as any, spy, { type: 'failure' } as any);

    expect(spy).toHaveBeenCalled();
  });

  it('should not reject if sasl success', () => {
    const spy = jest.fn();

    const fakeStanza = {};

    connectionManager['handleSessionSasl'](fakeStanza as any, spy, { type: 'success' } as any);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('handleSessionDisconnected', () => {
  it('should log and reject', () => {
    const rejectSpy = jest.fn();

    const fakeStanza = {};

    connectionManager['handleSessionDisconnected'](fakeStanza as any, rejectSpy);

    expect(rejectSpy).toHaveBeenCalled();
    expect(fakeLogger.error).toBeCalledWith('stanza disconnected', expect.anything());
  });
});

describe('checkForErrorStanza', () => {
  it('should log if text contains "error"', () => {
    const fakeStanza = {};

    connectionManager['checkForErrorStanza'](fakeStanza as any, 'this is my raw error');

    expect(fakeLogger.error).toBeCalled();
  });

  it('should not log if text does not contain "error"', () => {
    const fakeStanza = {};

    connectionManager['checkForErrorStanza'](fakeStanza as any, 'this is my raw message');

    expect(fakeLogger.error).not.toBeCalled();
  });
});

describe('getStanzaOptions', () => {
  it('should getJwtOptions if config includes a jwt', () => {
    const jwtSpy = connectionManager['getJwtOptions'] = jest.fn();
    const standardSpy = connectionManager['getStandardOptions'] = jest.fn();

    connectionManager['config'] = { jwt: '123asdf' } as any;

    connectionManager['getStanzaOptions']();

    expect(jwtSpy).toHaveBeenCalled();
    expect(standardSpy).not.toHaveBeenCalled();
  });

  it('should getStandardOptions if config does not include a jwt', () => {
    const jwtSpy = connectionManager['getJwtOptions'] = jest.fn();
    const standardSpy = connectionManager['getStandardOptions'] = jest.fn();

    connectionManager['getStanzaOptions']();

    expect(standardSpy).toHaveBeenCalled();
    expect(jwtSpy).not.toHaveBeenCalled();
  });
});

describe('getJwtOptions', () => {
  beforeEach(() => {
    connectionManager['config'] = {
      jidResource: 'testResource',
      host: 'example.com'
    } as any;
  });

  it('should use jid from jwt data when present', () => {
    connectionManager['config'].jwt = 'test.' + window.btoa(JSON.stringify({
      data: {
        jid: 'acd-asdfasdfkj@conference.example.orgspan.com'
      }
    }));

    expect(connectionManager['getJwtOptions']()).toEqual({
      resource: 'testResource',
      transports: {
        websocket: `example.com/stream/jwt/${connectionManager['config'].jwt}`
      },
      server: 'example.orgspan.com'
    });
  });

  it('should throw if jid is not properly formatted', () => {
    connectionManager['config'].jwt = 'test.' + window.btoa(JSON.stringify({
      data: {
        jid: 'acd-asdfasdfkjexample.orgspan.com'
      }
    }));

    expect(() => connectionManager['getJwtOptions']()).toThrowError('failed to parse');
  });
});

describe('getStandardOptions', () => {
  it('should return options', () => {
    connectionManager['config'] = {
      jidResource: 'testResource',
      jid: 'myJid',
      authToken: 'myAuth',
      host: 'example.com',
      channelId: 'mychannel',
      apiHost: 'api.example.com'
    };

    expect(connectionManager['getStandardOptions']()).toEqual({
      jid: 'myJid',
      resource: 'testResource',
      credentials: {
        username: 'myJid',
        password: 'authKey:myAuth'
      },
      transports: {
        websocket: 'example.com/stream/channels/mychannel'
      }
    });
  });
});
