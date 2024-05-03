import { Agent } from 'stanza';
import { Ping } from '../ping';
import { ServerMonitor } from '../server-monitor';

export interface NamedAgent extends Omit<Agent, 'disconnect'> {
  id: string;
  channelId?: string;
  originalEmitter?: Function;
  pinger?: Ping;
  serverMonitor?: ServerMonitor;
  disconnect: () => Promise<void>;
}
