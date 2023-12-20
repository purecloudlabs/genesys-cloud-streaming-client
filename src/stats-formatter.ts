import { GetStatsEvent, StatsConnectEvent, StatsEvent } from 'webrtc-stats-gatherer';
import { FlatObject, InsightAction, InsightActionDetails } from './types/interfaces';

function isGetStatsEvent (event: StatsEvent): event is GetStatsEvent {
  return event.name === 'getStats';
}

function prepGetStatsEvent (event: GetStatsEvent): FlatObject {
  let details: FlatObject = {};
  Object.assign(details, deepFlatten(event.tracks, 'localTrack'));
  delete (event as any).tracks;

  Object.assign(details, deepFlatten(event.remoteTracks, `remoteTrack`));
  delete (event as any).remoteTracks;

  return details;
}

export function formatStatsEvent (event: StatsEvent, extraDetails: FlatObject = {}): InsightAction<{_eventType: string} & FlatObject> {
  const details: InsightActionDetails<{_eventType: string } & FlatObject> = {
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

  const formattedEvent: InsightAction<typeof details> = {
    actionName: 'WebrtcStats',
    details,
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
    Object.keys(obj)
      /* don't send IP addresses to NR */
      .filter(key => key.toLowerCase() !== 'ip')
      .forEach((key) => {
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
