import request from 'superagent';
import reqlogger from './request-logger';

function buildUri (host, path, version = 'v2') {
  path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
  if (host.indexOf('http') === 0) {
    return `${host}/api/${version}/${path}`;
  }
  return `https://api.${host}/api/${version}/${path}`;
}

export function requestApi (this: any, path, opts: { method?, data?, host?, version?, contentType?, authToken?, logger? }) {
  let response = request[opts.method](buildUri(opts.host, path, opts.version))
    .use(reqlogger.bind(this, opts.logger, opts.data))
    .set('Authorization', `Bearer ${opts.authToken}`)
    .type(opts.contentType || 'json');

  return response.send(opts.data); // trigger request
}

export function timeoutPromise (fn, timeoutMs, msg, details?) {
  return new Promise(function (resolve, reject) {
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

export function splitIntoIndividualTopics (topicString) {
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

export function applyMixins (derivedCtor: any, constructors: any[]) {
  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) as any
      );
    });
  });
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

