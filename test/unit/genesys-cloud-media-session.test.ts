import EventEmitter from "events";
import Logger, { ILogger } from "genesys-cloud-client-logger";
import { GenesysCloudMediaSession } from "../../src/types/genesys-cloud-media-session";
import { IGenesysCloudMediaSessionParams } from "../../src/types/media-session";
import { WebrtcExtension } from "../../src/webrtc";
import { flushPromises } from '../helpers/testing-utils';

jest.mock('../../src/webrtc');

class FakePeerConnection extends EventTarget {
  createDataChannel: any;
  close = jest.fn();

  createAnswer = jest.fn().mockResolvedValue({ sdp: 'blah', type: 'answer' });
  setLocalDescription = jest.fn().mockResolvedValue(null);

  constructor () {
    super();
    const fakeData = new EventTarget();
    jest.spyOn(fakeData, 'addEventListener');
    this.createDataChannel = jest.fn().mockReturnValue(fakeData);
  }
}

let mockWebrtcExtension: WebrtcExtension;
let logger: Logger;
let config: IGenesysCloudMediaSessionParams;

beforeAll(() => {
  global.RTCPeerConnection = FakePeerConnection as any;
});

beforeEach(() => {
  mockWebrtcExtension = new WebrtcExtension(null as any, null as any);
  logger = console as any;

  config = {
    optOutOfWebrtcStatsTelemetry: true,
    fromJid: 'fromJid@conference.com',
    iceServers: [],
    iceTransportPolicy: 'all',
    id: 'sessionId',
    logger,
    peerID: 'fromJid@conference.com',
    sessionType: 'softphone',
    reinvite: false
  };
});

describe('constructor', () => {
  it('should create a session', () => {
    expect(new GenesysCloudMediaSession(mockWebrtcExtension, {} as any)).toBeTruthy();
  });

  it('should not set up statsGatherer if optOutOfWebrtcStatsTelemetry', () => {
    const spy = jest.spyOn(GenesysCloudMediaSession.prototype, 'setupStatsGatherer');
    new GenesysCloudMediaSession(mockWebrtcExtension, config);

    expect(spy).not.toHaveBeenCalled();

    config.optOutOfWebrtcStatsTelemetry = false;
    new GenesysCloudMediaSession(mockWebrtcExtension, config);
    expect(spy).toHaveBeenCalled();
  });
});

describe('peerConnection event listeners', () => {
  describe('onIceCandidate()', () => {
    let sendSpy: jest.Mock;
    let emitSpy: jest.Mock;
    let logSpy: jest.Mock;
    let session: GenesysCloudMediaSession;

    function createSession () {
      session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      sendSpy = session['sendGenesysWebrtc'] = jest.fn();
      emitSpy = session['emit'] = jest.fn();
      logSpy = session['log'] = jest.fn();
    }
    
    it('should trigger from peerConnection event', async () => {
      const spy = jest.spyOn((GenesysCloudMediaSession.prototype as any), 'onIceCandidate').mockReturnValue(Promise.resolve());
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session.peerConnection.dispatchEvent(new Event('icecandidate'));

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should filter out TCP candidates', async () => {
      const event = {
        candidate: {
          candidate: 'my tcp candidate',
          sdpMid: '0',
          protocol: 'tcp'
        }
      };

      config.allowTCP = false;
      createSession();

      session['onIceCandidate'](event as RTCPeerConnectionIceEvent);
      expect(session['iceCandidatesDiscovered']).toBe(0);
      expect(emitSpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('should filter out ipv6 candidates', async () => {
      const event = {
        candidate: {
          candidate: 'something udp somethingelse 2001:db8:3333:4444:5555:6666:7777:8888 typ host',
          sdpMid: '0',
          protocol: 'udp'
        }
      };

      config.allowIPv6 = false;
      createSession();

      session['onIceCandidate'](event as RTCPeerConnectionIceEvent);
      expect(session['iceCandidatesDiscovered']).toBe(0);
      expect(emitSpy).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('debug', 'Filtering out IPv6 candidate', expect.anything());
    });

    it('should increment candidatesDiscovered and send the candidate', async () => {
      const event = {
        candidate: {
          candidate: 'something udp somethingelse 192.168.1.5 typ host',
          sdpMid: '0',
          protocol: 'udp'
        }
      };

      config.allowIPv6 = false;
      createSession();

      session['onIceCandidate'](event as RTCPeerConnectionIceEvent);
      expect(session['iceCandidatesDiscovered']).toBe(1);
      expect(emitSpy).not.toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: 'iceCandidate',
        params: {
          sessionId: 'sessionId',
          sdp: `m=${event.candidate.sdpMid} 9 RTP/AVP 0\r\na=${event.candidate.candidate}\r\n`
        }
      });
    });

    it('should emit endOfCandidates and send message', async () => {
      const event = {
        candidate: null
      };

      config.allowIPv6 = false;
      createSession();

      session['onIceCandidate'](event as RTCPeerConnectionIceEvent);
      expect(session['iceCandidatesDiscovered']).toBe(0);
      expect(emitSpy).toHaveBeenCalledWith('endOfCandidates');
      expect(sendSpy).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: 'iceCandidate',
        params: {
          sessionId: 'sessionId',
          sdp: 'a=end-of-candidates\r\n'
        }
      });
    });
  });

  describe('onIceStateChange()', () => {
    it('should trigger from peerConnection event', async () => {
      const spy = jest.spyOn((GenesysCloudMediaSession.prototype as any), 'onIceStateChange').mockReturnValue(Promise.resolve());
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session.peerConnection.dispatchEvent(new Event('iceconnectionstatechange'));

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('disconnected - should set interruption start if was connected', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      (session.peerConnection as any).iceConnectionState = 'disconnected';
      (session.peerConnection as any).signalingState = 'stable';

      session['onIceStateChange']();
      expect(session['interruptionStart']).toBeTruthy();
    });

    it('connected - should send session action', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      (session.peerConnection as any).iceConnectionState = 'connected';
      (session.peerConnection as any).signalingState = 'stable';

      const spy = session['sendGenesysWebrtc'] = jest.fn();
      session['onIceStateChange']();
      expect(spy).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'info', params: { sessionId: 'sessionId', status: 'active' }});
    });

    it('failed - should log message', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      (session.peerConnection as any).iceConnectionState = 'failed';

      const spy = session['log'] = jest.fn();
      session['onIceStateChange']();
      expect(spy).toHaveBeenCalledWith('info', 'ICE connection failed', {
        candidatesDiscovered: expect.any(Number),
        candidatesReceivedFromPeer: expect.any(Number)
      });
    });
  });

  describe('onConnectionStateChange()', () => {
    it('should trigger from peerConnection event', async () => {
      const spy = jest.spyOn((GenesysCloudMediaSession.prototype as any), 'onConnectionStateChange').mockReturnValue(Promise.resolve());
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session.peerConnection.dispatchEvent(new Event('connectionstatechange'));

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should do nothing if no interruptionStart', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      (session.peerConnection as any).connectionState = 'connected';
      const spy = session['log'] = jest.fn();

      session['onConnectionStateChange']();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should say connection recovered', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session['interruptionStart'] = new Date();
      (session.peerConnection as any).connectionState = 'connected';
      const spy = session['log'] = jest.fn();

      session['onConnectionStateChange']();
      expect(spy).toHaveBeenCalledWith('info', expect.stringContaining('Connection was interrupted but was successfully recovered'), expect.anything());
      expect(session['interruptionStart']).toBeFalsy();
    });

    it('should say connection failed', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session['interruptionStart'] = new Date();
      (session.peerConnection as any).connectionState = 'failed';
      const spy = session['log'] = jest.fn();

      session['onConnectionStateChange']();
      expect(spy).toHaveBeenCalledWith('info', expect.stringContaining('Connection was interrupted and failed'), expect.anything());
    });
  });

  describe('onIceCandidateError()', () => {
    it('should trigger from peerConnection event', async () => {
      const spy = jest.spyOn((GenesysCloudMediaSession.prototype as any), 'onIceCandidateError').mockReturnValue(Promise.resolve());
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      session.peerConnection.dispatchEvent(new Event('icecandidateerror'));

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should do nothing if no interruptionStart', async () => {
      const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
      const spy = session['log'] = jest.fn();

      session['onIceCandidateError']({} as any);
      expect(spy).toHaveBeenCalledWith('error', 'IceCandidateError', expect.anything());
    });
  });


});

describe('toString', () => {
  it('should spit out a json version', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    session['connectionState'] = 'connected';
    
    expect(session.toString()).toEqual({
      connectionState: 'connected',
      state: 'pending',
      sessionType: 'softphone',
      fromJid: config.fromJid,
      conversationId: config.conversationId,
      id: config.id,
      peerConnection: expect.anything()
    });
  });
});

describe('_setupDataChannel', () => {
  it('should not create a new dataChannel if one already exists', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    
    session.dataChannel = {} as any;
    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };
    
    session['_setupDataChannel']();
    expect(session.peerConnection.createDataChannel).not.toHaveBeenCalled();
  });

  it('should not create datachannel if not mentioned in the offer', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    
    (session.peerConnection as any).remoteDescription = {
      sdp: 'nothing mentioned here'
    };
    
    session['_setupDataChannel']();
    expect(session.peerConnection.createDataChannel).not.toHaveBeenCalled();
  });

  it('should create data channel and add event listeners', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    
    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };
    
    session['_setupDataChannel']();
    expect(session.peerConnection.createDataChannel).toHaveBeenCalledWith('videoConferenceControl');

    expect(session['dataChannel']!.addEventListener).toHaveBeenCalledTimes(4);
  });

  it('should call the message handler', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    
    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };

    const spy = session['_handleDataChannelMessage'] = jest.fn();
    
    session['_setupDataChannel']();

    session.dataChannel!.dispatchEvent(new Event('message', {}));

    expect(spy).toHaveBeenCalled();
  });
  
  it('should log open', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const logSpy = jest.spyOn(session as any, 'log');

    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };

    session['_setupDataChannel']();

    session.dataChannel!.dispatchEvent(new Event('open', {}));

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('opened'));
  });
  
  it('should log closed', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const logSpy = jest.spyOn(session as any, 'log');

    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };

    session['_setupDataChannel']();

    session.dataChannel!.dispatchEvent(new Event('close', {}));

    expect(logSpy).toHaveBeenCalledWith('info', expect.stringContaining('closing'));
  });
  
  it('should log error', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const logSpy = jest.spyOn(session as any, 'log');

    (session.peerConnection as any).remoteDescription = {
      sdp: 'webrtc-datachannel'
    };

    session['_setupDataChannel']();

    session.dataChannel!.dispatchEvent(new Event('error', {}));

    expect(logSpy).toHaveBeenCalledWith('error', expect.anything(), expect.anything());
  });
});

describe('_handleDataChannelMessage', () => {
  let session: GenesysCloudMediaSession;

  beforeEach(() => {
    session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
  });

  it('should emit data channel message as JSON', () => {
    const jsonObj = {
      test: true,
      string: 'mystring'
    };

    session.on('dataChannelMessage', (message) => {
      expect(message).toEqual(jsonObj);
    });

    session._handleDataChannelMessage({ data: JSON.stringify(jsonObj) } as any);
    expect.assertions(1);
  });

  it('should log parsing error', () => {
    const badStr = '{slkdnn:';

    const spy = jest.spyOn(session as any, 'log');

    session._handleDataChannelMessage({ data: badStr } as any);
    expect(spy).toHaveBeenCalledWith('error', expect.stringContaining('Failed to parse'), expect.anything());
  });
});

describe('accept()', () => {
  it('should set localDescription, state, and send the answer', async () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const sendSpy = jest.spyOn(session as any, 'sendGenesysWebrtc').mockResolvedValue(null);

    await session.accept();

    expect(session.peerConnection.setLocalDescription).toHaveBeenCalledWith({ sdp: 'blah', type: 'answer' });
    expect(sendSpy).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'answer', params: { sdp: 'blah', sessionId: 'sessionId' }});
  });
});

describe('mute()', () => {
  it('should sent message', async () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const sendSpy = jest.spyOn(session as any, 'sendGenesysWebrtc').mockResolvedValue(null);

    await session.mute('userId', 'audio');

    expect(sendSpy).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'mute', params: { type: 'audio', sessionId: 'sessionId' }});
  });
});

describe('unmute()', () => {
  it('should sent message', async () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const sendSpy = jest.spyOn(session as any, 'sendGenesysWebrtc').mockResolvedValue(null);

    await session.unmute('userId', 'audio');

    expect(sendSpy).toHaveBeenCalledWith({ jsonrpc: '2.0', method: 'unmute', params: { type: 'audio', sessionId: 'sessionId' }});
  });
});

describe('onSessionTerminate()', () => {
  it('should set the state to `ended`', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);

    session.onSessionTerminate();
    expect(session.state).toEqual('ended');
  });

  it('should emit a terminated event with default condition', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);

    session.on('terminated', ( reason ) => {
      expect(reason.condition).toEqual('success');
    });

    session.onSessionTerminate();
  });
  
  it('should emit a terminated event with default condition even if there is no peerConnection', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const spy = jest.fn();

    session.peerConnection = {
      close: spy
    } as any;

    session.on('terminated', ( reason ) => {
      expect(reason.condition).toEqual('success');
    });

    session.onSessionTerminate();
  });
  
  it('should emit a terminated event with provided condition', () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);

    session.on('terminated', ( reason ) => {
      expect(reason.condition).toEqual('alternative-session');
    });

    session.onSessionTerminate('alternative-session');
  });
});

describe('addTrack()', () => {
  let session: GenesysCloudMediaSession;

  beforeEach(() => {
    session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
  });

  it('should replaceTrack on available transceiver', async () => {
    const replaceSpy = jest.fn();
    const addSpy = session.peerConnection.addTrack = jest.fn();

    session.peerConnection.getTransceivers = jest.fn().mockReturnValue([
      {
        sender: {
          track: null,
          replaceTrack: replaceSpy
        },
        receiver: {
          track: {
            kind: 'audio'
          }
        }
      }
    ]);

    const track = { kind: 'audio' };
    await session.addTrack(track as any);

    expect(replaceSpy).toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });
  
  it('should addTrack when there is no available transceiver', async () => {
    const replaceSpy = jest.fn();
    const addSpy = session.peerConnection.addTrack = jest.fn();

    session.peerConnection.getTransceivers = jest.fn().mockReturnValue([
      {
        sender: {
          track: null,
          replaceTrack: replaceSpy
        },
        receiver: {
          track: null
        }
      }
    ]);

    const track = { kind: 'audio' };
    await session.addTrack(track as any);

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalled();
  });

  it('should call addTrack on the peerConnection', async () => {
    const replaceSpy = jest.fn();
    const addSpy = session.peerConnection.addTrack = jest.fn();

    session.peerConnection.getTransceivers = jest.fn().mockReturnValue([]);

    const track = { kind: 'audio' };
    await session.addTrack(track as any);

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalled();
  });
});

describe('addRemoteIceCandidate()', () => {
  it('should add ice candidate', async () => {
    const sdpFragment = 'm=audio 9 UDP/TLS/RTP/SAVPF 96 101\r\na=candidate:O8hEe/8IsHnvIzM6 1 UDP 1694498815 18.207.148.20 17258 typ srflx raddr 10.27.64.246 rport 17258';

    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    session.peerConnection.addIceCandidate = jest.fn().mockResolvedValue({});
    const iceSpy = session['createIceCandidate'] = jest.fn().mockResolvedValue({});
    await session.addRemoteIceCandidate(sdpFragment);

    expect(iceSpy).toHaveBeenCalledWith('audio', 'candidate:O8hEe/8IsHnvIzM6 1 UDP 1694498815 18.207.148.20 17258 typ srflx raddr 10.27.64.246 rport 17258');
  });
});

describe('sendGenesysWebrtc()', () => {
  it('should call sendIQ on webrtc extension', async () => {
    const info = {
      test: true
    };

    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const from = (mockWebrtcExtension as any).jid = 'myJid@conference.com';

    await session['sendGenesysWebrtc'](info as any);

    expect(mockWebrtcExtension.sendIq).toHaveBeenCalledWith(expect.objectContaining({
      type: 'set',
      genesysWebrtc: info,
      from,
      to: config.peerID
    }));
  });
});

describe('end()', () => {
  let session: GenesysCloudMediaSession;

  beforeEach(() => {
    session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
  });

  it('should set state to `ended`', () => {
    session.end();

    expect(session.state).toEqual('ended');
  });

  it('should not send message if silent', () => {
    const spy = session['sendGenesysWebrtc'] = jest.fn();

    session.end('alternative-session', true);

    expect(spy).not.toHaveBeenCalled();
  });
  
  it('should handle default params', () => {
    const spy = session['sendGenesysWebrtc'] = jest.fn();

    session.end();

    expect(spy).toHaveBeenCalled();
  });

  it('should automatically close the peerConnection if still connected after 2 seconds', async () => {
    jest.useFakeTimers();
    const spy = session['sendGenesysWebrtc'] = jest.fn().mockResolvedValue(null);

    (mockWebrtcExtension.sendIq as jest.Mock).mockResolvedValue({});

    const closeSpy = session.peerConnection.close = jest.fn();
    (session.peerConnection as any).connectionState = 'connecting';
    const promise = session.end('alternative-session', false);

    expect(spy).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2100);
    await flushPromises();
    expect(closeSpy).toHaveBeenCalled();
  });
  
  it('should handle jingle reason condition', () => {
    jest.useFakeTimers();
    const spy = session['sendGenesysWebrtc'] = jest.fn().mockResolvedValue(null);

    const closeSpy = session.peerConnection.close = jest.fn();
    (session.peerConnection as any).connectionState = 'connecting';
    session.end({ condition: 'alternative-session' }, false);

    expect(spy).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe('setRemoteDescription()', () => {
  it('should proxy to peerConnection', async () => {
    const session = new GenesysCloudMediaSession(mockWebrtcExtension, config);
    const spy = session.peerConnection.setRemoteDescription = jest.fn();

    await session.setRemoteDescription('here');

    expect(spy).toHaveBeenCalledWith({ sdp: 'here', type: 'offer' });
  });
});

describe('keepStateInSyncWithPeerConnection', () => {
  let session;

  beforeEach(() => {
    // Create an session of the class containing keepStateInSyncWithPeerConnection
    session = new GenesysCloudMediaSession(mockWebrtcExtension, config);

    // Mock state, peerConnection, log, and onSessionTerminate
    session.state = 'active';
    session.peerConnection = {
      connectionState: 'connected',
    };
    session.log = jest.fn();
    session.onSessionTerminate = jest.fn();

    // Mock time-related functions
    jest.useFakeTimers();
    jest.spyOn(global.Date, 'now').mockReturnValue(10000);

    // Ensure the timeout is cleared between tests
    session.stateSyncTimeout = undefined;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('should clear the existing timeout if stateSyncTimeout is defined', () => {
    const initialTimer = session.stateSyncTimeout = setTimeout(() => {}, 1000); // Set a dummy timeout
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    session.keepStateInSyncWithPeerConnection();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(initialTimer);
    expect(session.stateSyncTimeout).toBeDefined();
  });

  it('should set a new timeout when no mismatch or sleep is detected', () => {
    const spy = jest.spyOn(session, 'keepStateInSyncWithPeerConnection');

    session.keepStateInSyncWithPeerConnection();

    expect(session.stateSyncTimeout).toBeDefined();
    jest.advanceTimersByTime(2000); // Simulate the timeout interval

    expect(session.log).not.toHaveBeenCalled();
    expect(session.onSessionTerminate).not.toHaveBeenCalled();
    expect(spy).toBeCalledTimes(2); // Recursively called
  });

  it('should detect a time anomaly and log a warning', () => {
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(10000)  // Initial time
      .mockReturnValueOnce(15000); // After a simulated delay

    session.keepStateInSyncWithPeerConnection();
    jest.advanceTimersByTime(2000); // Move time forward by 2000ms

    expect(session.log).toHaveBeenCalledWith('warn', expect.stringContaining('MediaSession detected timer anomally'));
  });

  it('should detect a state mismatch and manually terminate the session', () => {
    // Set peerConnection connectionState to a mismatching state
    session.peerConnection.connectionState = 'failed';

    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(10000)  // Initial time
      .mockReturnValueOnce(15000); // After a simulated delay

    session.keepStateInSyncWithPeerConnection();
    jest.advanceTimersByTime(2000); // Move time forward by 2000ms

    expect(session.log).toHaveBeenCalledWith('warn', expect.stringContaining('state mismatch'), expect.anything());
    expect(session.onSessionTerminate).toHaveBeenCalled();
  });

  it('should not terminate session if the state is ended', () => {
    session.state = 'ended';

    session.keepStateInSyncWithPeerConnection();
    jest.advanceTimersByTime(2000);

    expect(session.onSessionTerminate).not.toHaveBeenCalled();
  });
});