import { GenesysCloudMediaSession } from '../../src/types/media-session';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import { EventEmitter } from 'events';
import { ICESession } from 'stanza/jingle';

class FakePeerConnection extends EventTarget {
  iceConnectionState = 'new';
  addTrack = jest.fn();
  getSenders = jest.fn();
  getTransceivers = jest.fn();
}

class FakeParent extends EventEmitter {
  createPeerConnection () {
    return new FakePeerConnection();
  }
}

describe('GenesysCloudMediaSession', () => {
  describe('onIceStateChange', () => {
    it('should send session-info active stanza on connected', () => {
      const parent = new FakeParent();

      const session = new GenesysCloudMediaSession({ parent }, 'softphone', false);
      (session.pc as any).iceConnectionState = 'connected';
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.onIceStateChange();

      expect(spy).toHaveBeenCalledWith(JingleAction.SessionInfo, { info: { infoType: JINGLE_INFO_ACTIVE } });
    });

    it('should not send session-info active if not connected', () => {
      const parent = new FakeParent();

      const session = new GenesysCloudMediaSession({ parent }, 'softphone', false);
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.onIceStateChange();

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('onIceCandidate', () => {
    const ipv6Candidate = 'a=candidate:4089960842 1 udp 2122197247 2603:900a:160a:aa00:540:b412:2a2d:1f5b 53622 typ host generation 0';
    const ipv4Candidate = 'a=candidate:2999745851 1 udp 2122129151 192.168.56.1 53623 typ host generation 0';

    it('should not call super with ipv6 candidate if !allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({ parent, allowIPv6: false }, 'softphone', false);

      const event = {
        candidate: { candidate: ipv6Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should call super with ipv4 candidate if !allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({ parent, allowIPv6: false }, 'softphone', false);

      const event = {
        candidate: { candidate: ipv4Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it('should call super with ipv4 candidate if allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({ parent, allowIPv6: true }, 'softphone', true);

      const event = {
        candidate: { candidate: ipv4Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it('should call super with ipv6 candidate if allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({ parent }, 'softphone', true);

      const event = {
        candidate: { candidate: ipv4Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it('should call super if no canidate', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({ parent }, 'softphone', true);

      const event = {
        candidate: null
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });
  });

  describe('addTrack', () => {
    let session: GenesysCloudMediaSession;

    beforeEach(() => {
      const parent = new FakeParent();
      session = new GenesysCloudMediaSession({ parent }, 'softphone', true);
    });

    it('should use exiting sender', async () => {
      const spy = jest.fn();
      (session.pc.getSenders as jest.Mock).mockReturnValue([
        {
          track: {
            kind: 'video'
          },
          replaceTrack: spy
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'video'
      };

      await session.addTrack(track as any);

      expect(spy).toHaveBeenCalledWith(track);
      expect(session.pc.addTrack).not.toHaveBeenCalled();
    });

    it('should use exiting sender', async () => {
      const spy = jest.fn();
      (session.pc.getSenders as jest.Mock).mockReturnValue([
        {
          track: {
            kind: 'audio'
          },
          replaceTrack: spy
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'audio'
      };

      await session.addTrack(track as any);

      expect(spy).toHaveBeenCalledWith(track);
      expect(session.pc.addTrack).not.toHaveBeenCalled();
    });

    it('should use available sender', async () => {
      const spy = jest.fn();
      const sender = {
        track: null,
        replaceTrack: spy
      };

      (session.pc.getSenders as jest.Mock).mockReturnValue([sender]);

      (session.pc.getTransceivers as jest.Mock).mockReturnValue([
        {
          sender,
          receiver: {
            track: {
              kind: 'video'
            }
          }
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'video'
      };

      await session.addTrack(track as any);

      expect(spy).toHaveBeenCalledWith(track);
      expect(session.pc.getTransceivers).toHaveBeenCalled();
      expect(session.pc.addTrack).not.toHaveBeenCalled();
    });

    it('should call addTrack on the peerConnection', async () => {
      const spy = jest.fn();
      const sender = {
        track: null,
        replaceTrack: spy
      };

      (session.pc.getSenders as jest.Mock).mockReturnValue([sender]);

      (session.pc.getTransceivers as jest.Mock).mockReturnValue([
        {
          sender,
          receiver: {
            track: {
              kind: 'audio'
            }
          }
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'video'
      };

      await session.addTrack(track as any);

      expect(spy).not.toHaveBeenCalled();
      expect(session.pc.getTransceivers).toHaveBeenCalled();
      expect(session.pc.addTrack).toHaveBeenCalled();
    });

    it('should call addTrack on the peerConnection no track on sender', async () => {
      const spy = jest.fn();
      const sender = {
        track: null,
        replaceTrack: spy
      };

      (session.pc.getSenders as jest.Mock).mockReturnValue([sender]);

      (session.pc.getTransceivers as jest.Mock).mockReturnValue([
        {
          sender,
          receiver: {
            track: null
          }
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'video'
      };

      await session.addTrack(track as any);

      expect(spy).not.toHaveBeenCalled();
      expect(session.pc.getTransceivers).toHaveBeenCalled();
      expect(session.pc.addTrack).toHaveBeenCalled();
    });
  });
});
