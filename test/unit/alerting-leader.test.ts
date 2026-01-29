import { AlertingLeaderExtension } from "../../src/alerting-leader";
import Client from "../../src";
import { EventEmitter } from "events";
import { NamedAgent } from "../../src/types/named-agent";

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return instance as NamedAgent;
}

describe('AlertingLeader', () => {
  describe('handleStanzaInstanceChange', () => {
    it('should update the stanzaInstance', () => {
      const alertingLeader = new AlertingLeaderExtension({} as unknown as Client);
      const newStanza = getFakeStanzaClient();

      alertingLeader.handleStanzaInstanceChange(newStanza);

      expect(alertingLeader['stanzaInstance']).toBe(newStanza);
    });
  });
});
