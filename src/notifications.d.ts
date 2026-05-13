import { PubsubEvent, PubsubSubscription, PubsubSubscriptionWithOptions } from 'stanza/protocol';
import { Client } from './client';
import { IClientOptions, StreamingClientExtension } from './types/interfaces';
import { NamedAgent } from './types/named-agent';
import { AxiosResponse } from 'axios';
export declare class Notifications implements StreamingClientExtension {
    client: Client;
    stanzaInstance?: NamedAgent;
    subscriptions: any;
    bulkSubscriptions: any;
    topicPriorities: any;
    debouncedResubscribe: () => Promise<BulkSubscribeResult>;
    enablePartialBulkResubscribe: boolean;
    private internalSubscriptions;
    constructor(client: any, options?: IClientOptions);
    get pubsubHost(): string;
    handleStanzaInstanceChange(stanza: NamedAgent): void;
    topicHandlers(topic: string): Array<(obj?: any) => void>;
    pubsubEvent({ pubsub }: {
        pubsub: PubsubEvent;
    }): void;
    xmppSubscribe(topic: string): Promise<PubsubSubscriptionWithOptions | void>;
    xmppUnsubscribe(topic: string): Promise<PubsubSubscription | void>;
    mapCombineTopics(topics: string[]): Array<{
        id: string;
    }>;
    prioritizeTopicList(topics: Array<{
        id: string;
    }>): Array<{
        id: string;
    }>;
    getTopicPriority(topic: string, returnDefault?: boolean): number;
    truncateTopicList(topics: Array<{
        id: string;
    }>): Array<{
        id: string;
    }>;
    makeBulkSubscribeRequest(topics: string[], options: any): Promise<AxiosResponse<ChannelTopicsEntityListing>>;
    createSubscription(topic: string, handler: (obj?: any) => void): void;
    removeSubscription(topic: string, handler: (obj?: any) => void): void;
    removeTopicPriority(topic: string): void;
    getActiveIndividualTopics(): string[];
    resubscribe(): Promise<BulkSubscribeResult>;
    subscriptionsKeepAlive(): void;
    getTopicParts(topic: string): {
        prefix: string;
        postfixes: string[];
    };
    setTopicPriorities(priorities?: {}): void;
    subscribe(topic: string, handler?: (..._: any[]) => void, immediate?: boolean, priority?: number): Promise<TopicSubscribeResult>;
    /**
     * Use `_subscribeInternal` when subscribing to a topic from within streaming-client itself.
     * Internal subscriptions won't be overwritten by subscriptions from consumers and will be prioritized
     * over subscriptions from consumers.
     */
    _subscribeInternal(topic: string): Promise<PubsubSubscriptionWithOptions | void>;
    unsubscribe(topic: string, handler?: (..._: any[]) => void, immediate?: boolean): Promise<any>;
    bulkSubscribe(topics: string[], options?: BulkSubscribeOpts, priorities?: {
        [topicName: string]: number;
    }): Promise<BulkSubscribeResult>;
    get expose(): NotificationsAPI;
}
export interface NotificationsAPI {
    subscribe(topic: string, handler?: (..._: any[]) => void, immediate?: boolean, priority?: number): Promise<any>;
    unsubscribe(topic: string, handler?: (..._: any[]) => void, immediate?: boolean): Promise<any>;
    bulkSubscribe(topics: string[], options?: BulkSubscribeOpts, priorities?: {
        [topicName: string]: number;
    }): Promise<any>;
}
export interface BulkSubscribeOpts {
    replace?: boolean;
    force?: boolean;
}
export interface BulkSubscribeResult {
    [topic: string]: TopicSubscribeResult;
}
export interface TopicSubscribeResult {
    topic: string;
    state: 'Permitted' | 'Rejected' | 'Unknown';
    rejectionReason?: string;
    missingPermissions?: string[];
}
export interface ChannelTopicResponseEntity {
    id: string;
    state: 'Permitted' | 'Rejected';
    rejectionReason?: string;
    missingPermissions?: string[];
    selfUri?: string;
}
export interface ChannelTopicsEntityListing {
    entities: ChannelTopicResponseEntity[];
}
