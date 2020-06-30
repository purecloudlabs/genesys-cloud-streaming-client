import request from 'superagent';
import reqlogger from './request-logger';

function buildUri (host, path, version = 'v2') {
  path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
  if (host.indexOf('http') === 0) {
    return `${host}/api/${version}/${path}`;
  }
  return `https://api.${host}/api/${version}/${path}`;
}

export function requestApi (path, { method, data, host, version, contentType, authToken, logger }) {
  let response = request[method](buildUri(host, path, version))
    .use(reqlogger(logger, data))
    .set('Authorization', `Bearer ${authToken}`)
    .type(contentType || 'json');

  return response.send(data); // trigger request
}

export function timeoutPromise (fn, timeoutMs, msg, details) {
  return new Promise(function (resolve, reject) {
    const timeout = setTimeout(function () {
      const err = new Error(`Timeout: ${msg}`);
      err.details = details;
      reject(err);
    }, timeoutMs);
    const done = function () {
      clearTimeout(timeout);
      resolve();
    };
    fn(done, reject);
  });
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
