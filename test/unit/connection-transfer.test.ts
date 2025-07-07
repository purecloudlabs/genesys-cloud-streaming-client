import EventEmitter from "events";
import { Stanzas } from 'stanza';
import { v4 as uuidv4 } from "uuid";

import { ConnectionTransfer } from "../../src/connection-transfer";
import Client from "../../src";
import { NamedAgent } from "../../src/types/named-agent";

function getFakeClient (): Client {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      connect: jest.fn(),
      disconnect: jest.fn(),
      logger: {
        warn: jest.fn()
      }
    }
  ) as unknown as Client;
}

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      stanzas: {
        define: jest.fn()
      }
    }
  ) as unknown as NamedAgent;
}

describe('ConnectionTransfer', () => {
  describe('constructor()', () => {
    it('disconnects and reconnects on the iq:set:connectionTransfer event', () => {
      const fakeClient = getFakeClient();
      const fakeStanza = getFakeStanzaClient();
      const iq = {
        lang: '',
        payloadType: 'query',
        query: {},
        type: 'set'
      } as Stanzas.ReceivedIQ & { query: ConnectionTransfer };

      const connectionTransfer = new ConnectionTransfer(fakeClient as any, fakeStanza);

      fakeClient.on('disconnected', () => {
        expect(true).toBeTruthy();
      });

      fakeStanza.emit('iq:set:connectionTransfer', iq);

      expect(fakeClient.disconnect).toHaveBeenCalled();
      expect(fakeClient.connect).toHaveBeenCalled();

      expect.assertions(3);
    });
  });
});
