'use strict';

import { ReceivedMessage } from 'stanza/protocol';
import { Client } from './client';
import { NamedAgent } from './types/named-agent';
import { GenesysMediaMessage, StreamingClientExtension } from './types/interfaces';

import { Emitter } from 'strict-event-emitter';
import { toBare } from 'stanza/JID';
import { v4 } from 'uuid';

type MessageWithMediaMessage = {
  from?: string;
  id?: string;
  to?: string;
  mediaMessage: GenesysMediaMessage;
};

export type MediaMessageEvent = MessageWithMediaMessage & {
  fromMyUser: boolean;
  fromMyClient: boolean;
};

export type MessengerEvents = {
  mediaMessage: [MediaMessageEvent]
};

export class MessengerExtension extends Emitter<MessengerEvents> implements StreamingClientExtension {
  constructor (private client: Client, private stanzaInstance: NamedAgent) {
    super();
  }

  get bareJid (): string {
    return toBare(this.stanzaInstance.jid);
  }

  handleStanzaInstanceChange (stanzaInstance: NamedAgent) {
    this.stanzaInstance = stanzaInstance;
  }

  isMediaMessage (msg: any): msg is MessageWithMediaMessage {
    return !!msg.mediaMessage;
  }

  handleMessage (msg: ReceivedMessage): void {
    if (!this.isMediaMessage(msg)) {
      return;
    }

    const fromMyClient = msg.from === this.stanzaInstance.jid;
    const fromMyUser = toBare(msg.from) === this.bareJid;

    this.emit('mediaMessage', { ...msg, fromMyClient, fromMyUser });
  }

  /**
   * @param msg
   * @returns Promise<messageId>
   */
  async broadcastMessage (msg: MessageWithMediaMessage): Promise<string> {
    const id = v4();
    msg.id = id;
    msg.from = this.stanzaInstance.jid;

    if (!msg.to) {
      msg.to = this.bareJid;
    }

    await this.stanzaInstance.send('message', msg);
    return id;
  }

  get expose (): MessengerExtensionApi {
    return {
      broadcastMessage: this.broadcastMessage.bind(this),
      on: this.on.bind(this),
      once: this.once.bind(this),
      off: this.off.bind(this),
      removeListener: this.removeListener.bind(this),
      addListener: this.addListener.bind(this),
    };
  }
}

export interface MessengerExtensionApi extends Pick<Emitter<MessengerEvents>, 'on' | 'off' | 'once' | 'addListener' | 'removeListener'> {
  broadcastMessage (msg: MessageWithMediaMessage): Promise<string>;
}
