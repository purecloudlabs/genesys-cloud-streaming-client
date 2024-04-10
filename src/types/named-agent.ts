import { Agent } from 'stanza';
import { Ping } from '../ping';
import { ServerPing } from '../server-ping';

export interface NamedAgent extends Omit<Agent, 'disconnect'> {
  id: string;
  channelId?: string;
  originalEmitter?: Function;
  pinger?: Ping;
  serverPing?: ServerPing;
  disconnect: () => Promise<void>;
}
