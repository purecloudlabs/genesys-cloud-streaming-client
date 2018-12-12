import request from 'superagent';

function buildUri (host, path, version = 'v2') {
  path = path.replace(/^\/+|\/+$/g, ''); // trim leading/trailing /
  return `https://api.${host}/api/${version}/${path}`;
}

function requestApi (path, { method, data, host, version, contentType, authToken }) {
  let response = request[method](buildUri(host, path, version))
    .set('Authorization', `Bearer ${authToken}`)
    .type(contentType || 'json');

  return response.send(data); // trigger request
}

function timeoutPromise (fn, timeoutMs, msg) {
  return new Promise(function (resolve, reject) {
    const timeout = setTimeout(function () {
      reject(new Error(`Timeout: ${msg}`));
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

module.exports = {
  requestApi,
  timeoutPromise
};
