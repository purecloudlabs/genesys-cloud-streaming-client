import { StreamingClientExtension } from './types/interfaces';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';

export class AlertingLeaderExtension implements StreamingClientExtension {
  private connectionId?: string;

  constructor (private client: Client) { }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.connectionId = stanzaInstance.transport?.stream?.id;
  }

  get expose (): AlertingLeaderApi {
    return {
    };
  }
}

export interface AlertingLeaderApi {
}
