import * as utils from '../../src/utils';

describe('jid utils', () => {
  it('isAcdJid', () => {
    expect(utils.isAcdJid('acd-sdkfjk@test.com')).toBeTruthy();
    expect(utils.isAcdJid('sdkfjk@test.com')).toBeFalsy();
  });

  it('isScreenRecordingJid', () => {
    expect(utils.isScreenRecordingJid('screenrecording-sdkfjk@test.com')).toBeTruthy();
    expect(utils.isScreenRecordingJid('sdkfjk@test.com')).toBeFalsy();
  });

  it('isSoftphoneJid', () => {
    expect(utils.isSoftphoneJid('sdkfjk@gjoll.test.com')).toBeTruthy();
    expect(utils.isSoftphoneJid('sdkfjk@test.com')).toBeFalsy();
    expect(utils.isSoftphoneJid('')).toBeFalsy();
  });

  it('isVideoJid', () => {
    expect(utils.isVideoJid('sdkfjk@conference.test.com')).toBeTruthy();
    expect(utils.isVideoJid('acd-sdkfjk@conference.test.com')).toBeFalsy();
    expect(utils.isVideoJid('sdkfjk@test.com')).toBeFalsy();
  });

  it('isPeerVideoJid', () => {
    expect(utils.isPeerVideoJid('acd-sdkfjk@conference.test.com')).toBeFalsy();
    expect(utils.isPeerVideoJid('sdkfjk@test.com')).toBeFalsy();
    expect(utils.isPeerVideoJid('sdkfjk@conference.test.com')).toBeFalsy();
    expect(utils.isPeerVideoJid('peer-sdkfjk@conference.test.com')).toBeTruthy();
  });
});
