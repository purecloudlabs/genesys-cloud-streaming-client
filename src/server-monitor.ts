'use strict';

import { Client } from './client';
import { NamedAgent } from './types/named-agent';

const DEFAULT_STANZA_TIMEOUT = 70 * 1000;

export interface ServerMonitorOptions {
  stanzaTimeout?: number;
}

export class ServerMonitor {
  private stanzaTimeout: number;
  private timeoutId?: number;
  private boundSetupStanzaTimeout?: () => void;

  constructor (private client: Client, private stanzaInstance: NamedAgent, options: ServerMonitorOptions = {}) {
    this.stanzaTimeout = options.stanzaTimeout || DEFAULT_STANZA_TIMEOUT;
    this.timeoutId = undefined;

    this.start();
  }

  private start () {
    this.boundSetupStanzaTimeout = this.setupStanzaTimeout.bind(this);
    this.client.on('connected', this.boundSetupStanzaTimeout);
    this.stanzaInstance.on('raw:incoming', this.boundSetupStanzaTimeout);
  }

  stop () {
    clearTimeout(this.timeoutId);
    this.timeoutId = undefined;

    if (this.boundSetupStanzaTimeout) {
      this.client.off('connected', this.boundSetupStanzaTimeout);
      this.stanzaInstance.off('raw:incoming', this.boundSetupStanzaTimeout);
      this.boundSetupStanzaTimeout = undefined;
    }
  }

  private setupStanzaTimeout () {
    clearTimeout(this.timeoutId);

    this.timeoutId = setTimeout(() => {
      const info = {
        channelId: this.client.config.channelId,
        jid: this.stanzaInstance.jid,
        stanzaInstanceId: this.stanzaInstance.id,
        timeout: this.stanzaTimeout
      };
      this.client.logger.error('Time between XMPP stanzas exceeded timeout, disconnecting', info);

      this.stanzaInstance.sendStreamError({ text: 'time between stanzas exceeded timeout', condition: 'connection-timeout' });
      this.stop();
    }, this.stanzaTimeout) as unknown as number;
  }
}
