import { StreamingClientExtension } from './types/interfaces';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';

export class AlertingLeaderExtension implements StreamingClientExtension {
  private stanzaInstance?: NamedAgent;

  constructor (private client: Client) { }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.stanzaInstance = stanzaInstance;
  }

  get expose (): AlertingLeaderApi {
    return {
    };
  }
}

export interface AlertingLeaderApi {
}
