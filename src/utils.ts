export { retryPromise, RetryPromise } from './types/retry-utils';

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
