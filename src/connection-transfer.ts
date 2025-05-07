import { IQ } from 'stanza/protocol';

import { Client } from './client';
import { connectionTransfer } from './stanza-definitions/xep0051';
import { NamedAgent } from './types/named-agent';

export class ConnectionTransfer {
  constructor (private client: Client, private stanzaInstance: NamedAgent) {
    stanzaInstance.stanzas.define(connectionTransfer);

    // Hawk maps `v2.system.socket_closing` to XEP-0051 Connection Transfer
    // The docs says we have up to one minute to disconnect and connect a new WebSocket, so we should be proactive in reconnecting.
    stanzaInstance.on('iq:set:connectionTransfer', (iq: IQ) => {
      this.client.logger.warn('connection transfer (socket_closing) event received', { stanzaInstanceId: stanzaInstance.id, channelId: stanzaInstance.channelId });
      void this.client.disconnect();
      void this.client.connect({ keepTryingOnFailure: true });
    });
  }
}
