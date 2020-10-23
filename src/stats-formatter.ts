import { GetStatsEvent, StatsConnectEvent, StatsEvent } from 'webrtc-stats-gatherer';

export function formatStatsEvent (event: StatsEvent, extraDetails: any = {}) {
  let details: any;
  const eventType = event.name;

  if (event.name === 'connect') {
    const e: StatsConnectEvent = event as any;
    details = e;

    Object.assign(details, deepFlatten(e.candidatePairDetails, 'candidatePairDetails'));
    delete details.candidatePairDetails;
  } else if (event.name === 'getStats') {
    const e: GetStatsEvent = event as any;
    details = e;

    e.tracks.forEach((track) => {
      Object.assign(details, deepFlatten(track, `track_${track.track}`));
    });
    delete details.tracks;

    e.remoteTracks.forEach((track) => {
      Object.assign(details, deepFlatten(track, `remoteTrack_${track.track}`));
    });
    delete details.remoteTracks;
  } else {
    details = {};
    if (event.name !== 'failure') {
      // TODO: log this out when we get genesys-cloud-client-logger in place (allows logging from anywhere)
    }

    Object.assign(details, deepFlatten(event));
  }
  delete details.name;

  Object.assign(details, extraDetails, { '_eventType': eventType });

  // new relic doesn't accept booleans so we convert them to strings
  Object.keys(details).forEach((key) => {
    const val = details[key];
    if (typeof val === 'boolean') {
      details[key] = `${val}`;
    }
  });

  const formattedEvent = {
    actionName: 'WebrtcStats',
    actionDate: Date.now(),
    details
  };

  return formattedEvent;
}

export function deepFlatten (obj: any, prefix = ''): any {
  const flatObj = {};

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      Object.assign(flatObj, deepFlatten(obj[i], `${prefix}_[${i}]`));
    }
  } else if (typeof obj !== 'object') {
    flatObj[prefix] = obj;
  } else {
    Object.keys(obj).forEach((key) => {
      const val = obj[key];

      const nextPrefix = prefix ? `${prefix}_${key}` : key;

      if (typeof val !== 'object' && !Array.isArray(val)) {
        flatObj[nextPrefix] = val;
      } else {
        Object.assign(flatObj, deepFlatten(val, nextPrefix));
      }
    });
  }

  return flatObj;
}
