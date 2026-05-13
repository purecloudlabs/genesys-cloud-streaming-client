"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJwt = exports.isVideoJid = exports.isSoftphoneJid = exports.isLiveScreenMonitoringJid = exports.isScreenRecordingJid = exports.isAcdJid = exports.StreamingSubscriptionError = exports.StreamingClientError = void 0;
exports.timeoutPromise = timeoutPromise;
exports.delay = delay;
exports.splitIntoIndividualTopics = splitIntoIndividualTopics;
exports.retryPromise = retryPromise;
exports.calculatePayloadSize = calculatePayloadSize;
exports.getUfragFromSdp = getUfragFromSdp;
exports.getIcePwdFromSdp = getIcePwdFromSdp;
exports.iceIsDifferent = iceIsDifferent;
const uuid_1 = require("uuid");
const timeout_error_1 = require("./types/timeout-error");
const interfaces_1 = require("./types/interfaces");
class StreamingClientError extends Error {
    constructor(type, messageOrError, details) {
        let message;
        if (messageOrError instanceof Error) {
            message = messageOrError.message;
        }
        else {
            message = messageOrError;
        }
        super(message);
        if (messageOrError instanceof Error) {
            this.name = messageOrError.name;
        }
        this.type = type !== null && type !== void 0 ? type : interfaces_1.StreamingClientErrorTypes.generic;
        this.details = details;
    }
}
exports.StreamingClientError = StreamingClientError;
class StreamingSubscriptionError extends Error {
    constructor(message, topic, operation, details) {
        super(message);
        this.topic = topic;
        this.operation = operation;
        this.name = 'StreamingSubscriptionError';
        this.missingPermissions = details === null || details === void 0 ? void 0 : details.missingPermissions;
    }
}
exports.StreamingSubscriptionError = StreamingSubscriptionError;
/* istanbul ignore next */
function timeoutPromise(fn, timeoutMs, msg, details) {
    return new Promise(function (resolve, reject) {
        const timeout = setTimeout(function () {
            const err = new timeout_error_1.TimeoutError(`Timeout: ${msg}`);
            err.details = details;
            reject(err);
        }, timeoutMs);
        const done = function (resolvedValue) {
            clearTimeout(timeout);
            resolve(resolvedValue);
        };
        fn(done, reject);
    });
}
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function splitIntoIndividualTopics(topicString) {
    const topics = [];
    if (topicString.includes('?')) {
        const split = topicString.split('?');
        const prefix = split[0];
        const postfixes = split[1] && split[1].split('&');
        if (postfixes && postfixes.length) {
            postfixes.forEach(postfix => {
                topics.push(`${prefix}.${postfix}`);
            });
        }
    }
    else {
        topics.push(topicString);
    }
    return topics;
}
const isAcdJid = function (jid) {
    return jid.startsWith('acd-') && !(0, exports.isSoftphoneJid)(jid);
};
exports.isAcdJid = isAcdJid;
const isScreenRecordingJid = function (jid) {
    return jid.startsWith('screenrecording-') && !(0, exports.isSoftphoneJid)(jid);
};
exports.isScreenRecordingJid = isScreenRecordingJid;
const isLiveScreenMonitoringJid = function (jid) {
    return jid.startsWith('livemonitor-') && !(0, exports.isSoftphoneJid)(jid);
};
exports.isLiveScreenMonitoringJid = isLiveScreenMonitoringJid;
const isSoftphoneJid = function (jid) {
    if (!jid) {
        return false;
    }
    return !!jid.match(/.*@.*gjoll.*/i);
};
exports.isSoftphoneJid = isSoftphoneJid;
const isVideoJid = function (jid) {
    return !!(jid && jid.match(/@conference/) && !(0, exports.isAcdJid)(jid));
};
exports.isVideoJid = isVideoJid;
function retryPromise(promiseFn, 
// if a number is returned, that's how long we will wait before retrying (in milliseconds)
retryFn, retryInterval = 15000, logger = console) {
    let timeout;
    let cancel;
    let complete;
    let tryPromiseFn;
    let _hasCompleted = false;
    const promise = new Promise((resolve, reject) => {
        tryPromiseFn = async () => {
            try {
                const val = await promiseFn();
                complete(val);
            }
            catch (error) {
                let timeToWait = retryInterval;
                const retryValue = retryFn(error);
                if (Number.isInteger(retryValue)) {
                    timeToWait = retryValue;
                }
                if (retryValue !== false) {
                    logger.debug('Retrying promise', error);
                    timeout = setTimeout(tryPromiseFn, timeToWait);
                }
                else {
                    cancel(error);
                }
            }
        };
        complete = (value) => {
            clearTimeout(timeout);
            _hasCompleted = true;
            resolve(value);
        };
        cancel = (reason) => {
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
        _id: (0, uuid_1.v4)(),
        hasCompleted: () => _hasCompleted
    };
}
// from https://stackoverflow.com/questions/38552003/how-to-decode-jwt-token-in-javascript
const parseJwt = (token) => {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
};
exports.parseJwt = parseJwt;
function calculatePayloadSize(trace) {
    const str = JSON.stringify(trace);
    // http://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
    // Matches only the 10.. bytes that are non-initial characters in a multi-byte sequence.
    const m = encodeURIComponent(str).match(/%[89ABab]/g);
    return str.length + (m ? m.length : 0);
}
function getUfragFromSdp(sdp) {
    if (!sdp) {
        return null;
    }
    const regex = /a=ice-ufrag:(\S+)/;
    const match = sdp.match(regex);
    return match ? match[1] : null;
}
function getIcePwdFromSdp(sdp) {
    if (!sdp) {
        return null;
    }
    const regex = /a=ice-pwd:(\S+)/;
    const match = sdp.match(regex);
    return match ? match[1] : null;
}
function iceIsDifferent(sdp1, sdp2) {
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
