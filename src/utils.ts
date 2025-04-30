import { v4 } from 'uuid';
import { TimeoutError } from './types/timeout-error';
import { StreamingClientErrorTypes } from './types/interfaces';

export class StreamingClientError extends Error {
  type: StreamingClientErrorTypes;
  details?: unknown;

  constructor (type: StreamingClientErrorTypes | null, messageOrError: string | Error, details?: unknown) {
    let message;
    if (messageOrError instanceof Error) {
      message = messageOrError.message;
    } else {
      message = messageOrError;
    }

    super(message);

    if (messageOrError instanceof Error) {
      this.name = messageOrError.name;
    }

    this.type = type ?? StreamingClientErrorTypes.generic;
    this.details = details;
  }
}

/* istanbul ignore next */
export function timeoutPromise (fn: Function, timeoutMs: number, msg: string, details?: any) {
  return new Promise<any>(function (resolve, reject) {
    const timeout = setTimeout(function () {
      const err = new TimeoutError(`Timeout: ${msg}`);
      (err as any).details = details;
      reject(err);
    }, timeoutMs);
    const done = function (resolvedValue?: any) {
      clearTimeout(timeout);
      resolve(resolvedValue);
    };
    fn(done, reject);
  });
}

export function delay (ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function splitIntoIndividualTopics (topicString: string) {
  const topics: string[] = [];

  if (topicString.includes('?')) {
    const split = topicString.split('?');
    const prefix = split[0];
    const postfixes = split[1] && split[1].split('&');
    if (postfixes && postfixes.length) {
      postfixes.forEach(postfix => {
        topics.push(`${prefix}.${postfix}`);
      });
    }
  } else {
    topics.push(topicString);
  }
  return topics;
}

export const isAcdJid = function (jid: string): boolean {
  return jid.startsWith('acd-') && !isSoftphoneJid(jid);
};

export const isScreenRecordingJid = function (jid: string): boolean {
  return jid.startsWith('screenrecording-') && !isSoftphoneJid(jid);
};

export const isSoftphoneJid = function (jid: string): boolean {
  if (!jid) {
    return false;
  }
  return !!jid.match(/.*@.*gjoll.*/i);
};

export const isVideoJid = function (jid: string): boolean {
  return !!(jid && jid.match(/@conference/) && !isAcdJid(jid));
};

export const isAgentVideoJid = function (jid: string): boolean {
  return !!(jid && jid.match(/^agent-.*@conference/));
};

export type RetryPromise<T = any> = {
  promise: Promise<T>;
  cancel: (reason?: string | Error) => void;
  complete: (value?: T) => void;
  hasCompleted: () => boolean;
  _id: string;
};

export function retryPromise<T = any> (
  promiseFn: () => Promise<T>,
  // if a number is returned, that's how long we will wait before retrying (in milliseconds)
  retryFn: (error?: Error | any) => boolean | number,
  retryInterval: number = 15000,
  logger: any = console
): RetryPromise<T> {
  let timeout: any;
  let cancel: any;
  let complete: any;
  let tryPromiseFn: any;
  let _hasCompleted = false;

  const promise = new Promise<T>((resolve, reject) => {
    tryPromiseFn = async () => {
      try {
        const val = await promiseFn();
        complete(val);
      } catch (error) {
        let timeToWait = retryInterval;

        const retryValue = retryFn(error);
        if (Number.isInteger(retryValue)) {
          timeToWait = retryValue as number;
        }

        if (retryValue !== false) {
          logger.debug('Retrying promise', error);
          timeout = setTimeout(tryPromiseFn, timeToWait);
        } else {
          cancel(error);
        }
      }
    };

    complete = (value: T) => {
      clearTimeout(timeout);
      _hasCompleted = true;
      resolve(value);
    };

    cancel = (reason?: any) => {
      clearTimeout(timeout);
      _hasCompleted = true;
      reject(reason);
    };

    tryPromiseFn();
  });

  return {
    promise,
    cancel,
    complete,
    _id: v4(),
    hasCompleted: () => _hasCompleted
  };
}

// from https://stackoverflow.com/questions/38552003/how-to-decode-jwt-token-in-javascript
export const parseJwt = (token: string) => {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  return JSON.parse(jsonPayload);
};

export function calculatePayloadSize (trace: any): number {
  const str = JSON.stringify(trace);
  // http://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
  // Matches only the 10.. bytes that are non-initial characters in a multi-byte sequence.
  const m = encodeURIComponent(str).match(/%[89ABab]/g);
  return str.length + (m ? m.length : 0);
}

export function getUfragFromSdp (sdp: string | undefined) {
  if (!sdp) {
    return null;
  }

  const regex = /a=ice-ufrag:(\S+)/;
  const match = sdp.match(regex);
  return match ? match[1] : null;
}

export function getIcePwdFromSdp (sdp: string | undefined) {
  if (!sdp) {
    return null;
  }

  const regex = /a=ice-pwd:(\S+)/;
  const match = sdp.match(regex);
  return match ? match[1] : null;
}

export function iceIsDifferent (sdp1: string | undefined, sdp2: string | undefined): boolean {
  return getUfragFromSdp(sdp1) !== getUfragFromSdp(sdp2) || getIcePwdFromSdp(sdp1) !== getIcePwdFromSdp(sdp2);
}

// unsed, but handy. no test coverage until used
// function mergeOptions (destination, provided) {
//   for (var key in provided) {
//     let value = provided[key];
//     if (value instanceof Object) {
//       if (!destination[key]) {
//         destination[key] = {};
//       }
//       mergeOptions(destination[key], value);
//     } else {
//       destination[key] = provided[key];
//     }
//   }
//
//   return destination;
// }
