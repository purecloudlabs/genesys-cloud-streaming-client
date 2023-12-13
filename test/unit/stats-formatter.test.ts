import connectStatsEvent from '../stats-examples/connect-stats-event.json';
import formattedConnectStatsEvent from '../stats-examples/connect-stats-event-formatted.json';
import getStatsEvent from '../stats-examples/get-stats-event.json';
import formattedGetStatsEvent from '../stats-examples/get-stats-event-formatted.json';
import failedStatsEvent from '../stats-examples/failed-stats-event.json';
import failedStatsEventFormatted from '../stats-examples/failed-stats-event-formatted.json';
import someStatsEvent from '../stats-examples/some-stats-event.json';
import someStatsEventFormatted from '../stats-examples/some-stats-event-formatted.json';

import { formatStatsEvent } from '../../src/stats-formatter';

describe('formatStatsEvent', () => {
  it('should format connect event', () => {
    const extraDetails = {
      session: '70285efa-90e5-4c50-933a-61ebeb070d9a',
      sessionType: 'softphone',
      conference: '2660d40f-44d6-4a3b-a899-329b426806ae'
    };
    const expected: any = { ...formattedConnectStatsEvent };
    expected.details._eventTimestamp = expect.anything();
    expect(formatStatsEvent(connectStatsEvent as any, extraDetails)).toEqual(Object.assign(expected));
  });

  it('should format getStats event', () => {
    const extraDetails = {
      session: '70285efa-90e5-4c50-933a-61ebeb070d9a',
      sessionType: 'softphone',
      conference: '2660d40f-44d6-4a3b-a899-329b426806ae'
    };
    const expected: any = { ...formattedGetStatsEvent };
    expected.details._eventTimestamp = expect.anything();
    expect(formatStatsEvent(getStatsEvent as any, extraDetails)).toEqual(Object.assign(expected));
  });

  it('should format failed event', () => {
    const extraDetails = {
      session: '70285efa-90e5-4c50-933a-61ebeb070d9a',
      sessionType: 'softphone',
      conference: '2660d40f-44d6-4a3b-a899-329b426806ae'
    };
    const expected: any = { ...failedStatsEventFormatted };
    expected.details._eventTimestamp = expect.anything();
    expect(formatStatsEvent(failedStatsEvent as any, extraDetails)).toEqual(Object.assign(expected));
  });

  it('should format unknown event', () => {
    const extraDetails = {
      session: '70285efa-90e5-4c50-933a-61ebeb070d9a',
      sessionType: 'softphone',
      conference: '2660d40f-44d6-4a3b-a899-329b426806ae'
    };
    const expected: any = { ...someStatsEventFormatted };
    expected.details._eventTimestamp = expect.anything();

    expect(formatStatsEvent(someStatsEvent as any, extraDetails)).toEqual(Object.assign(expected));
  });

  it('should handle no extraDetails', () => {
    const expected: any = { ...someStatsEventFormatted };
    delete expected.details.session;
    delete expected.details.sessionType;
    delete expected.details.conference;

    expected.details._eventTimestamp = expect.anything();

    const result = formatStatsEvent(someStatsEvent as any);

    expect(result).toEqual(expected);
  });
});
