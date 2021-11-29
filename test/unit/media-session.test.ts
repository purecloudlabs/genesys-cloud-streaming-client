import { GenesysCloudMediaSession } from '../../src/types/media-session';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import { EventEmitter } from 'events';
import { ICESession } from 'stanza/jingle';

class FakePeerConnection extends EventTarget {
  iceConnectionState = 'new';
  addTrack = jest.fn();
  getSenders = jest.fn();
  getTransceivers = jest.fn();
  close = jest.fn();
}

class FakeParent extends EventEmitter {
  createPeerConnection () {
    return new FakePeerConnection();
  };
  signal = jest.fn();
  forgetSession = jest.fn();
}

describe('GenesysCloudMediaSession', () => {
  describe('constructor', () => {
    it('should not setupStatsGatherer', () => {
      const parent = new FakeParent();

      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        optOutOfWebrtcStatsTelemetry: true,
        sessionType: 'softphone',
        allowIPv6: false
      });

      expect(session['statsGatherer']).toBeFalsy();
    });
  });

 describe('end', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should end the session and call pc.close() because connection state is connecting', () => {
      jest.useFakeTimers();
      const parent = new FakeParent();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'collaborateVideo',
        allowIPv6: false
      });
      const reason = {
        "reason": {
          "condition": "success"
        }
      };
      (session.pc.connectionState as any)  = 'connecting';
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.end('success');
      jest.runAllTimers();

      expect(spy).toHaveBeenCalledWith('session-terminate', reason);
      expect(setTimeout).toHaveBeenCalledTimes(1);
      expect(session.pc.close).toHaveBeenCalled();
    });

    it('should end the session - not call pc.close() because connection state is connected', () => {
      jest.useFakeTimers();
      const parent = new FakeParent();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'collaborateVideo',
        allowIPv6: false
      });
      const reason = {
        "reason": {
          "condition": "success"
        }
      };
      (session.pc.connectionState as any)  = 'connected';
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.end('success');
      jest.runAllTimers();

      expect(spy).toHaveBeenCalledWith('session-terminate', reason);
      expect(setTimeout).toHaveBeenCalledTimes(1);
      expect(session.pc.close).toHaveBeenCalled();
    });

    it('should end the session - not call pc.close() because connection state is closed', () => {
      jest.useFakeTimers();
      const parent = new FakeParent();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'collaborateVideo',
        allowIPv6: false
      });
      const reason = {
        "reason": {
          "condition": "success"
        }
      };
      (session.pc.connectionState as any)  = 'closed';
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.end('success');
      jest.runAllTimers();

      expect(spy).toHaveBeenCalledWith('session-terminate', reason);
      expect(setTimeout).toHaveBeenCalledTimes(1);
      expect(session.pc.close).not.toHaveBeenCalled();
    });
  });

  describe('onIceStateChange', () => {
    it('should send session-info active stanza on connected', () => {
      const parent = new FakeParent();

      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: false
      });
      (session.pc as any).iceConnectionState = 'connected';
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.onIceStateChange();

      expect(spy).toHaveBeenCalledWith(JingleAction.SessionInfo, { info: { infoType: JINGLE_INFO_ACTIVE } });
    });

    it('should not send session-info active if not connected', () => {
      const parent = new FakeParent();

      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: false
      });
      const spy = jest.spyOn(session, 'send').mockImplementation();
      session.onIceStateChange();

      expect(spy).not.toHaveBeenCalled();
    });

    it('should log ICE connection failed along with the number of candidates exchanged', () => {
      const parent = new FakeParent();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: false
      });

      session['iceCandidatesDiscovered'] = 3;
      session['iceCandidatesReceivedFromPeer'] = 5;
      const spy = session['_log'] = jest.fn();
      session['pc'] = { iceConnectionState: 'failed' } as any;

      session.onIceStateChange();

      expect(spy).toHaveBeenCalledWith('info', 'ICE connection failed', expect.objectContaining({
        candidatesDiscovered: 3,
        candidatesReceivedFromPeer: 5
      }));
    });
  });

  describe('onIceCandidate', () => {
    const ipv6Candidate = 'a=candidate:4089960842 1 udp 2122197247 2603:900a:160a:aa00:540:b412:2a2d:1f5b 53622 typ host generation 0';
    const ipv4Candidate = 'a=candidate:2999745851 1 udp 2122129151 192.168.56.1 53623 typ host generation 0';
    const tcpCandidate = 'a=candidate:993906868 1 tcp 1518280447 172.24.144.1 9 typ host tcptype active generation 0 ufrag gDcL network-id 1';

    it('should not call super with ipv6 candidate if !allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent, allowIPv6: false } as any,
        sessionType: 'softphone',
        allowIPv6: false
      });

      const event = {
        candidate: { candidate: ipv6Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should not call super with tcp candidate if !allowTCP', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowTCP: false
      });

      const event = {
        candidate: { candidate: tcpCandidate, protocol: "tcp" }
      };
      const result = session.onIceCandidate(event as any);
      expect(result).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    });

    it('should call super with ipv4 candidate if !allowIPv6', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent, allowIPv6: false } as any,
        sessionType: 'softphone',
        allowIPv6: false
      });

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
      const session = new GenesysCloudMediaSession({
        options: { parent, allowIPv6: true } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });

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
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });

      const event = {
        candidate: { candidate: ipv4Candidate }
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it('should call super with TCP candidate if allowTCP', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowTCP: true
      });

      const event = {
        candidate: { candidate: tcpCandidate, protocol: "tcp" }
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });

    it('should call super with UDP candidate if allowTCP BUT protocol does not equal TCP', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowTCP: true
      });

      const event = {
        candidate: { candidate: ipv4Candidate, protocol: "udp"}
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    })

    it('should call super if no canidate', () => {
      const parent = new FakeParent();
      // @ts-ignore
      const spy = jest.spyOn(ICESession.prototype, 'onIceCandidate').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });

      const event = {
        candidate: null
      };
      session.onIceCandidate(event as any);
      expect(spy).toHaveBeenCalledWith(event);
    });
  });

  describe('onIceEndOfCandidates', () => {
    it('should emit event', () => {
      const parent = new FakeParent();
      jest.spyOn(ICESession.prototype as any, 'onIceEndOfCandidates').mockImplementation();
      const session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });

      const spy = jest.spyOn(session, 'emit');
      session.onIceEndOfCandidates();
      expect(spy).toHaveBeenCalledWith('endOfCandidates');
    });
  });

  describe('addTrack', () => {
    let session: GenesysCloudMediaSession;

    beforeEach(() => {
      const parent = new FakeParent();
      session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });
    });

    it('should call replace track if there is a transceiver with an empty sender', async () => {
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

      expect(spy).toHaveBeenCalled();
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
              kind: 'video'
            }
          }
        }
      ]);

      const track = {
        id: 'lsdkfj',
        kind: 'audio'
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

  describe('_log', () => {
    let session: GenesysCloudMediaSession;

    beforeEach(() => {
      const parent = new FakeParent();
      session = new GenesysCloudMediaSession({
        options: { parent } as any,
        sessionType: 'softphone',
        allowIPv6: true
      });
    });

    it('should not log if there is a log override', () => {
      const spy = jest.spyOn(session.parent, 'emit');

      session['_log']('info', 'should work');

      expect(spy).toHaveBeenCalled();
      spy.mockReset();

      session['_log']('info', 'Discovered new ICE candidate');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
