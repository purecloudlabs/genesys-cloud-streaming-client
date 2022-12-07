import { Agent } from 'stanza';
import { Ping } from '../ping';

export interface NamedAgent extends Agent {
  id: string;
  channelId?: string;
  originalEmitter?: Function;
  pinger?: Ping;
}
