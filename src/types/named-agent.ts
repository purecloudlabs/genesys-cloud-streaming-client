import { Agent } from 'stanza';
import { Ping } from '../ping';
import { ServerMonitor } from '../server-monitor';
import { ConnectionTransfer } from '../connection-transfer';

export interface NamedAgent extends Omit<Agent, 'disconnect'> {
  id: string;
  channelId?: string;
  originalEmitter?: Function;
  pinger?: Ping;
  serverMonitor?: ServerMonitor;
  connectionTransfer?: ConnectionTransfer;
  disconnect: () => Promise<void>;
}
