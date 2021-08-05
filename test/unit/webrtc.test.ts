/* tslint:disable:no-string-literal */

import WildEmitter from 'wildemitter';
import { Agent, createClient } from 'stanza';
import { JingleAction } from 'stanza/Constants';
import { v4 } from 'uuid';
import { EventEmitter } from 'events';
import browserama from 'browserama';

import { WebrtcExtension } from '../../src/webrtc';
import { GenesysCloudMediaSession } from '../../src/types/media-session';
import * as utils from '../../src/utils';
import * as statsFormatter from '../../src/stats-formatter';
import { HttpClient } from '../../src/http-client';

jest.mock('../../src/types/media-session');
class Client extends WildEmitter {
  connected = false;
  emit!: (event: string, ...data: any) => void;
  logger = {
    debug () { },
    info () { },
    warn () { },
    error () { }
  };

  _stanzaio: Agent;
  http: HttpClient;

  constructor (public config: any) {
    super();
    this._stanzaio = createClient({});
    this.http = new HttpClient();
  }
}

class FakePeerConnection extends EventTarget {
  oniceconnectionstatechange = jest.fn();
}

function shimCreatePeerConnection (client) {
  client._stanzaio.jingle.createPeerConnection = () => {
    return new FakePeerConnection();
  };
}

describe('constructor', () => {
  it('should override prepareSession', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    shimCreatePeerConnection(client);
    webrtc.proxyStatsForSession = jest.fn();

    expect(client._stanzaio.jingle.prepareSession({ parent: client._stanzaio.jingle, peerID: 'something', config: {} }) instanceof GenesysCloudMediaSession).toBeTruthy();
  });
});

describe('prepareSession', () => {
  it('should create media session with ignoreHostCandidates', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue('softphone');
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({});
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: true }));
  });

  it('should create mediaSession without ignoreHostCandidates if not ff', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue('softphone');
    Object.defineProperty(browserama, 'isFirefox', { get: () => false });

    const session = webrtc.prepareSession({});
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });

  it('should create mediaSession without ignoreHostCandidates if not relay and is firefox', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('all');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue('softphone');
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({});
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });
});

describe('addEventListeners', () => {
  it('should listen for jingle log messages', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = jest.spyOn(webrtc.logger, 'info');

    const fakeData = { fake: true };

    client._stanzaio.jingle.emit('log', 'info', 'test message', fakeData);

    expect(spy).toHaveBeenCalledWith('test message', fakeData);
  });

  it('should call handlePropose', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    // @ts-ignore
    const spy = jest.spyOn(webrtc, 'handlePropose').mockImplementation();

    client._stanzaio.emit('message', { id: 'lskdjf', to: 'sndlgkns@lskdn.com', propose: {} } as any);
    expect(spy).toHaveBeenCalled();
  });

  it('should call handleRetract', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    //@ts-ignore
    const spy = jest.spyOn(webrtc, 'handleRetract').mockImplementation();

    client._stanzaio.emit('message', { id: 'session123', to: 'sndlgkns@lskdn.com', retract: {} } as any)
    expect(spy).toHaveBeenCalled();
  });

  it('should call handledIncomingRtcSession', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    //@ts-ignore
    const spy = jest.spyOn(webrtc, 'handledIncomingRtcSession').mockImplementation();

    client._stanzaio.emit('message', { id: 'session123', to: 'sndlgkns@lskdn.com', accept: {} } as any)
    expect(spy).toHaveBeenCalled();
  });

  it('should not call handle propose', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    // @ts-ignore
    const spy = jest.spyOn(webrtc, 'handlePropose').mockImplementation();

    client._stanzaio.emit('message', { id: 'lskdjf', to: 'sndlgkns@lskdn.com', proceed: {} } as any);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('proxyEvents', () => {
  it('should emit outgoingRtcSession', () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const fakeSession = {};

    webrtc.on('outgoingRtcSession', (session) => {
      expect(session).toBe(fakeSession);
    });

    client._stanzaio.emit('jingle:outgoing', fakeSession as any);
  });

  it('should emit incomingRtcSession - pendingSession', () => {
    expect.assertions(3);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const sessionId = 'session123';

    const pending = webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com', propose: { conversationId: '123', originalRoomJid: '123', sessionId: 'sessionId' }, id: 'session123' } as any;
    const fakeSession = {
      sid: sessionId
    }

    webrtc.on('incomingRtcSession', (session) => {
      expect(session.conversationId).toEqual(pending.propose.conversationId);
      expect(session.fromUserId).toEqual(pending.from);
      expect(session.originalRoomJid).toEqual(pending.propose.originalRoomJid);
    });

    client._stanzaio.emit('jingle:incoming', fakeSession as any);
  });

  it('should emit incomingRtcSession', () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const fakeSession = {};

    webrtc.on('incomingRtcSession', (session) => {
      expect(session).toEqual(fakeSession);
    });

    client._stanzaio.emit('jingle:incoming', fakeSession as any);
  });

  it('should emit sessionEvents', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const fakeSession = {
      emit: jest.fn()
    };

    const events = [
      'iceConnectionType',
      'peerTrackAdded',
      'peerTrackRemoved',
      'mute',
      'unmute',
      'sessionState',
      'connectionState',
      'terminated',
      'stats',
      'endOfCandidates'
    ];

    for (const e of events) {
      const fakeData = { str: v4() };
      client._stanzaio.jingle.emit(e, fakeSession, fakeData);
      expect(fakeSession.emit).toHaveBeenCalledWith(e, fakeData);
      fakeSession.emit.mockReset();
    }

    expect.assertions(events.length);
  });
});

describe('handlePropose', () => {
  it('should do nothing if from self', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    client._stanzaio.jid = 'myJid';

    const spy = jest.spyOn(webrtc, 'emit');

    webrtc['handlePropose']({
      from: 'myJid',
      propose: {
        autoAnswer: false,
        conversationId: v4(),
        sessionId: v4()
      },
      to: 'myJid'
    });

    expect(webrtc.emit).not.toHaveBeenCalled();
  });

  it('should emit propose event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    client._stanzaio.jid = 'myJid';

    const spy = jest.spyOn(webrtc, 'emit');

    const propose = {
      autoAnswer: false,
      conversationId: v4(),
      sessionId: v4()
    };

    webrtc['handlePropose']({
      from: 'someotherjid',
      propose,
      to: 'myJid'
    });

    expect(webrtc.emit).toHaveBeenCalledWith(
      'requestIncomingRtcSession',
      {
        ...propose,
        roomJid: 'someotherjid',
        fromJid: 'someotherjid'
      }
    );
  });
});

describe('handleRetract', () => {
  it('should emit propose event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    client._stanzaio.jid = 'myJid';

    jest.spyOn(webrtc, 'emit');

    const sessionId = '123sessionid'

    webrtc['handleRetract'](sessionId);

    expect(webrtc.emit).toHaveBeenCalledWith('cancelIncomingRtcSession', sessionId);
  });
});

describe('handledIncomingRtcSession', () => {
  it('should emit propose event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    client._stanzaio.jid = 'myJid';

    jest.spyOn(webrtc, 'emit');

    const sessionId = '123sessionid'

    webrtc['handledIncomingRtcSession'](sessionId);

    expect(webrtc.emit).toHaveBeenCalledWith('handledIncomingRtcSession', sessionId);
  });
});

describe('initiateRtcSession', () => {
  it('should add medias based on provided stream', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };

    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      stream: fakestream as any,
      jid: toJid
    });

    const expected = {
      to: toJid,
      propose: {
        id: expect.anything(),
        descriptions: [
          { media: 'video' },
          { media: 'audio' }
        ]
      }
    };

    expect(sendSpy).toHaveBeenCalledWith('message', expected);
    expect(sendSpy).not.toHaveBeenCalledWith('presence', expect.any);
  });

  it('should add medias based on params', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      provideAudio: true,
      provideVideo: true,
      jid: toJid
    });

    const expected = {
      to: toJid,
      propose: {
        id: expect.anything(),
        descriptions: [
          { media: 'video' },
          { media: 'audio' }
        ]
      }
    };

    expect(sendSpy).toHaveBeenCalledWith('message', expected);
    expect(sendSpy).not.toHaveBeenCalledWith('presence', expect.any);
  });

  it('should add media based on mediaPurpose', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      provideAudio: true,
      provideVideo: true,
      mediaPurpose: 'screenshare',
      jid: toJid
    });

    const expected = {
      to: toJid,
      propose: {
        id: expect.anything(),
        descriptions: [
          { media: 'video' },
          { media: 'audio' },
          { media: 'screenshare' }
        ]
      }
    };

    expect(sendSpy).toHaveBeenCalledWith('message', expected);
    expect(sendSpy).not.toHaveBeenCalledWith('presence', expect.any);
  });

  it('should handle when stream and params are provided', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };
    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      provideAudio: true,
      provideVideo: true,
      stream: fakestream as any,
      jid: toJid
    });

    const expected = {
      to: toJid,
      propose: {
        id: expect.anything(),
        descriptions: [
          { media: 'video' },
          { media: 'audio' }
        ]
      }
    };

    expect(sendSpy).toHaveBeenCalledWith('message', expected);
    expect(sendSpy).not.toHaveBeenCalledWith('presence', expect.any);
  });

  it('should add listener media', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@conference.test.com';
    const fromJid = 'myjid@test.com';

    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      jid: toJid
    });

    const expected = {
      type: 'upgradeMedia',
      to: toJid,
      id: expect.anything(),
      from: fromJid,
      media: {
        conversationId: undefined,
        sourceCommunicationId: undefined,
        listener: true
      }
    };

    expect(sendSpy).not.toHaveBeenCalledWith('message', expect.any);
    expect(sendSpy).toHaveBeenCalledWith('presence', expected);
  });

  it('should send as presence', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = '21l1kn12l1k2n@conference.test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };

    client._stanzaio.jid = fromJid;
    const sendSpy = jest.spyOn(client._stanzaio, 'send').mockResolvedValue(undefined);

    const id = await webrtc.initiateRtcSession({
      stream: fakestream as any,
      jid: toJid
    });

    const expected = {
      type: 'upgradeMedia',
      to: toJid,
      id: expect.anything(),
      from: fromJid,
      media: {
        conversationId: undefined,
        sourceCommunicationId: undefined,
        video: true,
        audio: true
      }
    };

    expect(sendSpy).not.toHaveBeenCalledWith('message', expect.any);
    expect(sendSpy).toHaveBeenCalledWith('presence', expected);
  });
});

describe('acceptRtcSession', () => {
  it('should emit error if no pending session', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.acceptRtcSession('sldkf');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send proceed', async () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'session123';

    webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com', propose: { conversationId: 'test' } } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.acceptRtcSession(sessionId);
    expect(sendSpy).toHaveBeenCalled();
  });
});

describe('rejectRtcSession', () => {
  it('should emit error if no pending session', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const sessionId = 'session123555';

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot reject session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.rejectRtcSession(sessionId);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should not send reject and should add session to ignored', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'session12355524';
    webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com' } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.rejectRtcSession(sessionId, true);
    expect(webrtc.ignoredSessions.has(sessionId)).toBeTruthy();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send reject', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const bareJid = 'user@test.com';
    client._stanzaio.jid = `${bareJid}/442k2k2k-dkk`;

    const fromJid = 'lskn@test.com';

    const sessionId = 'session12355524';
    webrtc.pendingSessions[sessionId] = { from: fromJid, propose: { conversationId: 'test123' } } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    const reject1 = {
      to: bareJid,
      reject: {
        id: sessionId
      }
    };

    const reject2 = {
      to: fromJid,
      reject: {
        id: sessionId
      }
    };

    await webrtc.rejectRtcSession(sessionId);
    expect(sendSpy).toHaveBeenCalledWith('message', reject1);
    expect(sendSpy).toHaveBeenCalledWith('message', reject2);
  });
});

describe('rtcSessionAccepted', () => {
  it('should send event', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'session8581';

    const bareJid = 'user@test.com';
    client._stanzaio.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.rtcSessionAccepted(sessionId);

    expect(sendSpy).toHaveBeenCalledWith('message', {
      to: bareJid,
      accept: {
        sessionId
      }
    });
  });
});

describe('notifyScreenShareStart', () => {
  it('should send event', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = 'room@conference.com';
    const sessionId = 'session66231';

    const session: GenesysCloudMediaSession = {
      peerID: toJid,
      sid: sessionId
    } as any;

    const bareJid = 'user@test.com';
    client._stanzaio.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.notifyScreenShareStart(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from: client._stanzaio.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: sessionId,
        screenstart: expect.anything()
      }
    });
  });
});

describe('notifyScreenShareStop', () => {
  it('should send event', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const toJid = 'room@conference.com';
    const sessionId = 'session66231';

    const session: GenesysCloudMediaSession = {
      peerID: toJid,
      sid: sessionId
    } as any;

    const bareJid = 'user@test.com';
    client._stanzaio.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.notifyScreenShareStop(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from: client._stanzaio.jid,
      type: 'set',
      jingle: {
        action: JingleAction.SessionInfo,
        sid: sessionId,
        screenstop: expect.anything()
      }
    });
  });
});

describe('cancelRtcSession', () => {
  it('should emit error if no pending session', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot cancel session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.cancelRtcSession('sldkf');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send proceed', async () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'session12243';
    const toJid = 'room@conference.com';

    webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com', to: toJid, propose: { conversationId: 'test' } } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot cancel session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(client._stanzaio, 'send');

    await webrtc.cancelRtcSession(sessionId);
    expect(sendSpy).toHaveBeenCalledWith('message', {
      to: toJid,
      retract: {
        sessionId
      }
    });
  });
});

describe('refreshIceServers', () => {
  it('should set jingle iceServers', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = jest.spyOn(webrtc, 'setIceTransportPolicy');
    jest.spyOn(client._stanzaio, 'getServices')
      .mockReturnValueOnce({
        services: [
          { type: 'turn', host: 'turn.server.com' },
          { port: 123, type: 'turn', host: 'turn.server.com', username: 'user1', password: 'pass1' },
          { port: 456, type: 'turn', host: 'turn.server.com', username: 'user2', password: 'pass2', transport: 'tcp' }
        ]
      } as any)
      .mockReturnValueOnce({
        services: [
          { port: 234, type: 'stun', host: 'turn.server.com' }
        ]
      } as any);

    await webrtc.refreshIceServers();
    expect(spy).toHaveBeenCalledWith('all');

    expect(client._stanzaio.jingle.iceServers).toEqual([
      { type: 'turn', urls: 'turn:turn.server.com' },
      { type: 'turn', urls: 'turn:turn.server.com:123', username: 'user1', credential: 'pass1' },
      { type: 'turn', urls: 'turn:turn.server.com:456?transport=tcp', username: 'user2', credential: 'pass2' },
      { type: 'stun', urls: 'stun:turn.server.com:234' }
    ]);
  });

  it('should set iceTransportPolicy to relay', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const spy = jest.spyOn(webrtc, 'setIceTransportPolicy');

    jest.spyOn(client._stanzaio, 'getServices')
      .mockReturnValueOnce({
        services: [
          { type: 'turn', host: 'turn.server.com' },
          { port: 123, type: 'turn', host: 'turn.server.com', username: 'user1', password: 'pass1' },
          { port: 456, type: 'turn', host: 'turn.server.com', username: 'user2', password: 'pass2', transport: 'tcp' }
        ]
      } as any)
      .mockReturnValueOnce({
        services: []
      } as any);

    await webrtc.refreshIceServers();

    expect(spy).toHaveBeenCalledWith('relay');
    expect(client._stanzaio.jingle.iceServers).toEqual([
      { type: 'turn', urls: 'turn:turn.server.com' },
      { type: 'turn', urls: 'turn:turn.server.com:123', username: 'user1', credential: 'pass1' },
      { type: 'turn', urls: 'turn:turn.server.com:456?transport=tcp', username: 'user2', credential: 'pass2' },
    ]);
  });

  it('should retry if getting the servers fails', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = jest.spyOn(webrtc, 'setIceServers');
    jest.spyOn(client._stanzaio, 'getServices')
      /* signifies the first call */
      .mockRejectedValueOnce(new Error('Failed to fetch servers'))
      .mockRejectedValueOnce(new Error('Failed to fetch servers'))
      /* signifies the second call */
      .mockReturnValueOnce({
        services: [
          { type: 'turn', host: 'turn.server.com' },
          { port: 123, type: 'turn', host: 'turn.server.com', username: 'user1', password: 'pass1' },
          { port: 456, type: 'turn', host: 'turn.server.com', username: 'user2', password: 'pass2', transport: 'tcp' }
        ]
      } as any)
      .mockReturnValueOnce({
        services: [
          { port: 234, type: 'stun', host: 'turn.server.com' }
        ]
      } as any);

    await webrtc.refreshIceServers();

    expect(spy).toHaveBeenCalledWith([
      { type: 'turn', urls: 'turn:turn.server.com' },
      { type: 'turn', urls: 'turn:turn.server.com:123', username: 'user1', credential: 'pass1' },
      { type: 'turn', urls: 'turn:turn.server.com:456?transport=tcp', username: 'user2', credential: 'pass2' },
      { type: 'stun', urls: 'stun:turn.server.com:234' }
    ]);
  });

  it('should try 3 times and then fail', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = jest.spyOn(client._stanzaio, 'getServices')
      /* signifies all calls fail */
      .mockRejectedValue(new Error('Failed to fetch servers'));

    try {
      await webrtc.refreshIceServers();
      fail('should have not been able to fetch ice servers');
    } catch (error) {
      expect(spy).toHaveBeenCalledTimes(3 * 2); // 3 times total but each call calls `getServices` twice
      /* resets state */
      expect(webrtc['discoRetries']).toBe(0);
      expect(webrtc['refreshIceServersRetryPromise']).toBe(undefined);
    }
  });
});

describe('getSessionTypeByJid', () => {
  it('should return screenshare', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    jest.spyOn(utils, 'isAcdJid').mockReturnValue(true);

    expect(webrtc.getSessionTypeByJid('sldkjf')).toEqual('screenShare');
  });

  it('should return screenRecording', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    jest.spyOn(utils, 'isAcdJid').mockReturnValue(false);
    jest.spyOn(utils, 'isScreenRecordingJid').mockReturnValue(true);

    expect(webrtc.getSessionTypeByJid('sldkjf')).toEqual('screenRecording');
  });

  it('should return softphone', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    jest.spyOn(utils, 'isAcdJid').mockReturnValue(false);
    jest.spyOn(utils, 'isScreenRecordingJid').mockReturnValue(false);
    jest.spyOn(utils, 'isSoftphoneJid').mockReturnValue(true);

    expect(webrtc.getSessionTypeByJid('sldkjf')).toEqual('softphone');
  });

  it('should return collaborateVideo', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    jest.spyOn(utils, 'isAcdJid').mockReturnValue(false);
    jest.spyOn(utils, 'isScreenRecordingJid').mockReturnValue(false);
    jest.spyOn(utils, 'isSoftphoneJid').mockReturnValue(false);
    jest.spyOn(utils, 'isVideoJid').mockReturnValue(true);

    expect(webrtc.getSessionTypeByJid('sldkjf')).toEqual('collaborateVideo');
  });

  it('should return unknown', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    jest.spyOn(utils, 'isAcdJid').mockReturnValue(false);
    jest.spyOn(utils, 'isScreenRecordingJid').mockReturnValue(false);
    jest.spyOn(utils, 'isSoftphoneJid').mockReturnValue(false);
    jest.spyOn(utils, 'isVideoJid').mockReturnValue(false);

    expect(webrtc.getSessionTypeByJid('sldkjf')).toEqual('unknown');
  });
});

describe('proxyStatsForSession', () => {
  it('should call throttledSendStats', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const session: any = new EventEmitter();
    session.sid = 'mysid';
    session.sessionType = 'softphone';
    session.conversationId = 'myconvoid';

    webrtc['throttledSendStats'] = jest.fn();

    const formattedStats = {
      actionName: 'test',
      actionDate: expect.anything(),
      details: {
        conference: 'myconvoid',
        session: 'mysid',
        sessionType: 'softphone',
      },
    };

    jest.spyOn(statsFormatter, 'formatStatsEvent').mockReturnValue(formattedStats);

    webrtc.proxyStatsForSession(session);
    session.emit('stats', {
      actionName: 'test'
    });

    expect(webrtc['statsArr']).toEqual([formattedStats]);
    expect(webrtc['throttledSendStats']).toHaveBeenCalled();
  });

  it('should flush throttledSendStats', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const session: any = new EventEmitter();
    session.sid = 'mysid';
    session.sessionType = 'softphone';
    session.conversationId = 'myconvoid';

    webrtc['currentMaxStatSize'] = 1;
    webrtc['throttledSendStats'].flush = jest.fn();


    const formattedStats = {
      actionName: 'test',
      actionDate: expect.anything(),
      details: {
        conference: 'myconvoid',
        session: 'mysid',
        sessionType: 'softphone',
      },
    };

    jest.spyOn(statsFormatter, 'formatStatsEvent').mockReturnValue(formattedStats);

    webrtc.proxyStatsForSession(session);
    session.emit('stats', {
      actionName: 'test'
    });

    expect(webrtc['statsArr']).toEqual([formattedStats]);
    expect(webrtc['throttledSendStats'].flush).toHaveBeenCalled();
  });


});

describe('sendStats', () => {
  beforeEach(() => {
    jest.useFakeTimers('modern');
  });
  afterEach(() => {
    jest.clearAllTimers();
  });

  // fake timers apparently doesn't work with lodash.throttle/debounce
  it('should send stats from throttle fn', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    webrtc['throttledSendStats']();
    expect(sendSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(25050);
    expect(sendSpy).toHaveBeenCalled();
  });

  it('should not send stats from throttle fn if stats always exceed size.', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['currentMaxStatSize'] = 1;
    webrtc['statsArr'].push({} as any);
    webrtc['throttledSendStats']();
    jest.advanceTimersByTime(25050);
    expect(sendSpy).not.toHaveBeenCalled();
  });



  it('should send stats', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    sendSpy.mockReset();

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(0);
  });

  it('should not send stats if theres no auth token', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    sendSpy.mockReset();

    await webrtc.sendStats();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(0);
  });

  it('should not send stats if theres nothing to send', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    sendSpy.mockReset();

    await webrtc.sendStats();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(0);
  });

  it('should log failure but done nothing', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi');
    const logSpy = jest.spyOn(webrtc.logger, 'error');

    webrtc['statsArr'].push({} as any);

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(0);
    expect(logSpy).toHaveBeenCalled();
  });

  it('should log 413 failure and retry send stats.', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockImplementation(() => {
      const err: any = new Error('error');
      err.status = 413;
      throw err;
    });
    const logSpy = jest.spyOn(webrtc.logger, 'info');

    webrtc['statsArr'].push({} as any);

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  describe('calculatePayloadSize', () => {
    it('should calculate payload size.', () => {
      jest.spyOn(utils, 'calculatePayloadSize')
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1);

      let testPayload = [];

      expect(utils.calculatePayloadSize(testPayload as any)).toEqual(0);
      expect(utils.calculatePayloadSize([{}] as any)).toEqual(1);
    });
  });

  describe('multibyte characters', () => {
    it('should calculate multibyte characters', () => {
      expect(utils.calculatePayloadSize('a')).toBe(3);
      expect(utils.calculatePayloadSize('¢')).toBe(4);
    });
  });
});
