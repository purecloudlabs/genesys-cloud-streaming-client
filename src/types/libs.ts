declare module 'wildemitter' {
  export default class WildEmitter {
    constructor ();
    on (event: string, groupNameOrCallback: any, callback?: any): void;
    once (event: string, groupNameOrCallback: any, callback?: any): void;
    off (event: string, groupNameOrCallback: any, callback?: any): void;
    emit (event: string, ...args: any[]): void;

    /* emit */
    emit (event: string, ...args: any[]): void;

    /* utils */
    releaseGroup (groupName?: string): void;
    getWildcardCallbacks (): (...args: any[]) => void;
    static mixin (arg: any): void;
  }
}
