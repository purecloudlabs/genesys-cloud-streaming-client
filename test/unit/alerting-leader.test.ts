import { AlertingLeaderExtension } from '../../src/alerting-leader';
import Client, { IClientOptions } from '../../src';
import { EventEmitter } from 'events';
import { NamedAgent } from '../../src/types/named-agent';
import { Transport } from 'stanza';

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return instance as NamedAgent;
}

describe('AlertingLeader', () => {
  describe('handleStanzaInstanceChange', () => {
    it('should update the connectionId', () => {
      const connectionId = 'connection123';
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);

      const newStanza = getFakeStanzaClient();
      newStanza.transport = {
        stream: {
          id: connectionId
        }
      } as Transport;

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['connectionId']).toBe(connectionId);
    });
  });

  it('should handle non-existent transport or stream', () => {
    const alertingLeader = new AlertingLeaderExtension({} as unknown as Client, {} as IClientOptions);
    const newStanza = getFakeStanzaClient();

    alertingLeader.handleStanzaInstanceChange(newStanza);

    expect(alertingLeader['connectionId']).toBeUndefined();
  });
});
