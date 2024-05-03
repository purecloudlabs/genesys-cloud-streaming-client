'use strict';

import { ServerMonitor } from '../../src/server-monitor';
import EventEmitter from 'events';

let fakeClient;
let fakeStanzaInstance;

describe('ServerMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();

    fakeClient = {
      on: jest.fn(),
      off: jest.fn(),
      logger: { warn () { }, error () { } },
      config: {}
    };

    fakeStanzaInstance = {
      on: jest.fn(),
      off: jest.fn()
    };
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('constructor()', () => {
    it('accepts null options', () => {
      const serverMonitor = new ServerMonitor(fakeClient as any, fakeStanzaInstance);
      expect(serverMonitor).toBeTruthy();
    });

    it('listens to connected event and all incoming stanzas', () => {
      const serverMonitor = new ServerMonitor(fakeClient as any, fakeStanzaInstance);
      expect(fakeClient.on).toHaveBeenCalledWith('connected', expect.any(Function));
      expect(fakeStanzaInstance.on).toHaveBeenCalledWith('raw:incoming', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('clears timeout and stops listening to stanzas', () => {
      jest.spyOn(global, 'clearTimeout');
      const serverMonitor = new ServerMonitor(fakeClient as any, fakeStanzaInstance);

      serverMonitor.stop();

      expect(clearTimeout).toHaveBeenCalled();
      expect(fakeClient.off).toHaveBeenCalledWith('connected', expect.any(Function));
      expect(fakeStanzaInstance.off).toHaveBeenCalledWith('raw:incoming', expect.any(Function));
    })
  });

  describe('setupStanzaTimeout() via event handling', () => {
    it('clears previous timeout and sets up a new timeout when a new stanza arrives', () => {
      jest.spyOn(global, 'clearTimeout');
      jest.spyOn(global, 'setTimeout');
      const fakeStanzaEmitter = new EventEmitter();
      const serverMonitor = new ServerMonitor(fakeClient as any, fakeStanzaEmitter as any);

      // setupStanzaTimeout() should be called on every incoming stanza
      fakeStanzaEmitter.emit('raw:incoming');

      expect(clearTimeout).toHaveBeenCalled();
      expect(setTimeout).toHaveBeenCalled();

      serverMonitor.stop();
    });

    it('closes the connection after connecting when no new stanzas have arrived before the timeout', () => {
      const fakeClientEmitter = new EventEmitter();
      fakeClientEmitter['logger'] = { warn () { }, error () { } };
      fakeClientEmitter['config'] = { channelId: 'testingChannel' };
      const sendStreamErrorSpy = fakeStanzaInstance['sendStreamError'] = jest.fn();
      const serverMonitor = new ServerMonitor(fakeClientEmitter as any, fakeStanzaInstance as any);
      const stopSpy = jest.spyOn(serverMonitor, 'stop');

      // setupStanzaTimeout() should be called on the 'connected' event
      fakeClientEmitter.emit('connected');
      jest.runAllTimers();

      expect(sendStreamErrorSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
    });

    it('closes the connection when no stanzas have arrived before the timeout', () => {
      const fakeStanzaEmitter = new EventEmitter();
      const sendStreamErrorSpy = fakeStanzaEmitter['sendStreamError'] = jest.fn();
      const serverMonitor = new ServerMonitor(fakeClient as any, fakeStanzaEmitter as any);
      const stopSpy = jest.spyOn(serverMonitor, 'stop');

      // setupStanzaTimeout() should be called on every incoming stanza
      fakeStanzaEmitter.emit('raw:incoming');
      jest.runAllTimers();

      expect(sendStreamErrorSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('integration', () => {
    it('should not handle events after disconnect and reconnect', () => {
      const fakeClientEmitter = new EventEmitter();
      const fakeStanzaEmitter = new EventEmitter();
      const serverMonitor = new ServerMonitor(fakeClientEmitter as any, fakeStanzaEmitter as any);

      const handlerSpy = serverMonitor['setupStanzaTimeout'] = jest.fn();

      serverMonitor.stop();

      fakeClientEmitter.emit('connected');
      fakeStanzaEmitter.emit('raw:incoming');

      expect(handlerSpy).not.toHaveBeenCalled();
    });
  });
});
