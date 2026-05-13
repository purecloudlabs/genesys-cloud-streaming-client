import { StreamingClientErrorTypes, StreamingSubscriptionErrorDetails } from './types/interfaces';
export declare class StreamingClientError extends Error {
    type: StreamingClientErrorTypes;
    details?: unknown;
    constructor(type: StreamingClientErrorTypes | null, messageOrError: string | Error, details?: unknown);
}
export declare class StreamingSubscriptionError extends Error {
    readonly topic?: string | undefined;
    readonly operation?: "subscribe" | "unsubscribe" | undefined;
    name: string;
    missingPermissions?: string[];
    constructor(message: string, topic?: string | undefined, operation?: "subscribe" | "unsubscribe" | undefined, details?: StreamingSubscriptionErrorDetails);
}
export declare function timeoutPromise(fn: Function, timeoutMs: number, msg: string, details?: any): Promise<any>;
export declare function delay(ms: number): Promise<void>;
export declare function splitIntoIndividualTopics(topicString: string): string[];
export declare const isAcdJid: (jid: string) => boolean;
export declare const isScreenRecordingJid: (jid: string) => boolean;
export declare const isLiveScreenMonitoringJid: (jid: string) => boolean;
export declare const isSoftphoneJid: (jid: string) => boolean;
export declare const isVideoJid: (jid: string) => boolean;
export type RetryPromise<T = any> = {
    promise: Promise<T>;
    cancel: (reason?: string | Error) => void;
    complete: (value?: T) => void;
    hasCompleted: () => boolean;
    _id: string;
};
export declare function retryPromise<T = any>(promiseFn: () => Promise<T>, retryFn: (error?: Error | any) => boolean | number, retryInterval?: number, logger?: any): RetryPromise<T>;
export declare const parseJwt: (token: string) => any;
export declare function calculatePayloadSize(trace: any): number;
export declare function getUfragFromSdp(sdp: string | undefined): string | null;
export declare function getIcePwdFromSdp(sdp: string | undefined): string | null;
export declare function iceIsDifferent(sdp1: string | undefined, sdp2: string | undefined): boolean;
