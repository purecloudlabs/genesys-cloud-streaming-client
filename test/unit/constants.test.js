'use strict';

const test = require('ava');

test('events object should render proper labels', t => {
  t.plan(14);
  let events = require('../../src/constants').exposeWebrtcEvents.events;
  events = Object.keys(events).map((event, index) => {
    return {
      event: events[event]
    };
  });

  const eventLabels = [
    'requestWebrtcDump',
    'requestIncomingRtcSession',
    'cancelIncomingRtcSession',
    'handledIncomingRtcSession',
    'outgoingRtcSessionProceed',
    'outgoingRtcSessionRejected',
    'rtcIceServers',
    'incomingRtcSession',
    'outgoingRtcSession',
    'rtcSessionError',
    'traceRtcSession',
    'upgradeMediaError',
    'updateMediaPresence',
    'lastNChange'
  ];

  events.forEach((value, index, array) => {
    t.is(value.event, eventLabels[index]);
  });
});
