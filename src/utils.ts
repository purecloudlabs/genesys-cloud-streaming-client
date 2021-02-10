import { v4 } from 'uuid';

export function timeoutPromise (fn: Function, timeoutMs: number, msg: string, details?: any) {
  return new Promise<void>(function (resolve, reject) {
    const timeout = setTimeout(function () {
      const err = new Error(`Timeout: ${msg}`);
      (err as any).details = details;
      reject(err);
    }, timeoutMs);
    const done = function () {
      clearTimeout(timeout);
      resolve();
    };
    fn(done, reject);
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
  return jid.startsWith('acd-');
};

export const isScreenRecordingJid = function (jid: string): boolean {
  return jid.startsWith('screenrecording-');
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

export type RetryPromise<T> = {
  promise: Promise<T>;
  cancel: (reason?: string | Error) => void;
  complete: (value?: T) => void;
  _id: string;
};

export function retryPromise<T> (
  promiseFn: () => Promise<T>,
  retryFn: (error?: Error | any) => boolean,
  retryInterval: number = 15000
): RetryPromise<T> {
  let timeout: any;
  let cancel: any;
  let complete: any;
  let tryPromiseFn: any;

  const promise = new Promise<T>((resolve, reject) => {
    tryPromiseFn = async () => {
      try {
        const val = await promiseFn();
        complete(val);
      } catch (error) {
        if (retryFn(error)) {
          console.debug('Retrying promise', error);
          timeout = setTimeout(tryPromiseFn, retryInterval);
        } else {
          cancel(error);
        }
      }
    };

    complete = (value: T) => {
      clearTimeout(timeout);
      resolve(value);
    };

    cancel = (reason?: any) => {
      clearTimeout(timeout);
      reject(reason);
    };

    tryPromiseFn();
  });

  return { promise, cancel, complete, _id: v4() };
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
