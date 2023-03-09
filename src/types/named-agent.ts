import { Agent } from 'stanza';
import { Ping } from '../ping';

export interface NamedAgent extends Omit<Agent, 'disconnect'> {
  id: string;
  channelId?: string;
  originalEmitter?: Function;
  pinger?: Ping;
  disconnect: () => Promise<void>;
}
