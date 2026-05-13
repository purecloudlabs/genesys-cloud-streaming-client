"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatStatsEvent = formatStatsEvent;
exports.deepFlatten = deepFlatten;
function isGetStatsEvent(event) {
    return event.name === 'getStats';
}
function prepGetStatsEvent(event) {
    const details = {};
    Object.assign(details, deepFlatten(event.tracks, 'localTrack'));
    delete event.tracks;
    Object.assign(details, deepFlatten(event.remoteTracks, 'remoteTrack'));
    delete event.remoteTracks;
    return details;
}
function formatStatsEvent(event, extraDetails = {}) {
    const details = {
        _eventType: event.name,
        _eventTimestamp: new Date().getTime(),
        ...extraDetails
    };
    // anything that needs to be renamed or massaged
    if (isGetStatsEvent(event)) {
        Object.assign(details, prepGetStatsEvent(event));
    }
    // general case
    Object.assign(details, deepFlatten(event));
    delete details.name;
    const formattedEvent = {
        actionName: 'WebrtcStats',
        details
    };
    return formattedEvent;
}
function deepFlatten(obj, prefix = '') {
    const flatObj = {};
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            Object.assign(flatObj, deepFlatten(obj[i], `${prefix}_[${i}]`));
        }
    }
    else if (typeof obj !== 'object') {
        flatObj[prefix] = obj;
    }
    else {
        Object.keys(obj)
            /* Filter all IP addresses before sending to NR.
            https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidatePairStats */
            .filter(key => !['ip', 'address', 'relatedaddress'].includes(key.toLowerCase()))
            .forEach((key) => {
            const val = obj[key];
            const nextPrefix = prefix ? `${prefix}_${key}` : key;
            if (typeof val !== 'object' && !Array.isArray(val)) {
                flatObj[nextPrefix] = val;
            }
            else {
                Object.assign(flatObj, deepFlatten(val, nextPrefix));
            }
        });
    }
    return flatObj;
}
