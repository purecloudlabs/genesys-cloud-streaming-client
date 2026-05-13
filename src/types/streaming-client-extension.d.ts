import { TokenBucket } from 'limiter';
import { IQ, Message } from 'stanza/protocol';
import { NamedAgent } from './named-agent';
export interface StreamingClientExtension {
    handleIq?: (iq: IQ) => void;
    handleMessage?: (message: Message) => void;
    tokenBucket?: TokenBucket;
    on?: (eventName: string, ...args: any[]) => void;
    expose?: {
        [fnName: string]: any;
    };
    configureNewStanzaInstance?: (stanzaInstance: NamedAgent) => Promise<any>;
    handleStanzaInstanceChange: (stanzaInstance: NamedAgent) => void;
}
