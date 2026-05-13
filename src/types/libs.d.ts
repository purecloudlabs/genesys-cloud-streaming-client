declare module 'wildemitter' {
    export default class WildEmitter {
        constructor();
        on(event: string, groupNameOrCallback: any, callback?: any): void;
        once(event: string, groupNameOrCallback: any, callback?: any): void;
        off(event: string, groupNameOrCallback?: any, callback?: any): void;
        emit(event: string, ...args: any[]): void;
        emit(event: string, ...args: any[]): void;
        releaseGroup(groupName?: string): void;
        getWildcardCallbacks(): (...args: any[]) => void;
        static mixin(arg: any): void;
    }
}
declare module 'backoff-web' {
    export interface Backoff {
        failAfter(attempts: number): void;
        on(evt: 'backoff' | 'ready', callback: (count: number, delay: number) => void): void;
        on(evt: 'fail', callback: (...args: any[]) => void): void;
        backoff(): void;
        reset(): void;
        backoffNumber_: number;
    }
    const backoffInitializer: {
        exponential(options: {
            randomisationFactor: number;
            initialDelay: number;
            maxDelay: number;
            factor: number;
        }): Backoff;
    };
    export default backoffInitializer;
}
