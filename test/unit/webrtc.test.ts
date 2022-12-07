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
import { ISessionInfo, SessionTypes } from '../../src/types/interfaces';
import { NamedAgent } from '../../src/types/named-agent';

jest.mock('../../src/types/media-session');
GenesysCloudMediaSession.prototype.on = jest.fn();

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      config: {},
      id: v4(),
      getServices: jest.fn(),
      stanzas: {
        define: jest.fn()
      },
      jingle: {
        config: {
          peerConnectionConfig: {}
        }
      },
      send: jest.fn().mockResolvedValue(null)
    }
  ) as unknown as NamedAgent;
}

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

function flush () {
  return new Promise(res => setImmediate(res));
}

describe('getIceTransportPolicy', () => {
  it('should not blow up if no stanzaInstance', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    expect(webrtc.getIceTransportPolicy()).toBeUndefined();
  });
  
  it('should return iceConfig', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    fakeStanza.jingle = {
      config: {
        peerConnectionConfig: {
          iceTransportPolicy: 'relay'
        }
      }
    } as any;

    expect(webrtc.getIceTransportPolicy()).toEqual('relay');
  });
});

describe('prepareSession', () => {
  it('should create media session with ignoreHostCandidates', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({} as any);
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: true }));
  });

  it('should delete pending session', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    GenesysCloudMediaSession.prototype.on = jest.fn();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.pendingSessions = { mysid: { sessionId: 'mysid' } as any };

    expect(Object.values(webrtc.pendingSessions).length).toBe(1);
    const session = webrtc.prepareSession({ sid: 'mysid' } as any);
    expect(Object.values(webrtc.pendingSessions).length).toBe(0);
  });

  it('should use sessionType from pendingSession', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    GenesysCloudMediaSession.prototype.on = jest.fn();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.pendingSessions = { mysid: { sessionId: 'mysid', sessionType: 'softphone' } as any };

    expect(Object.values(webrtc.pendingSessions).length).toBe(1);
    const session = webrtc.prepareSession({ sid: 'mysid' } as any);
    expect((GenesysCloudMediaSession as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ sessionType: 'softphone' }));
    expect(Object.values(webrtc.pendingSessions).length).toBe(0);
  });

  it('should create mediaSession without ignoreHostCandidates if not ff', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => false });

    const session = webrtc.prepareSession({} as any);
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });

  it('should create mediaSession without ignoreHostCandidates if not relay and is firefox', () => {
    (GenesysCloudMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('all');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({} as any);
    expect(GenesysCloudMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });
});

describe('handleMessage', () => {
  it('should call handlePropose', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    // @ts-ignore
    const spy = jest.spyOn(webrtc, 'handlePropose').mockImplementation();

    webrtc.handleMessage({ id: 'lskdjf', to: 'sndlgkns@lskdn.com', propose: {} } as any);
    expect(spy).toHaveBeenCalled();
  });

  it('should call handleRetract', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    //@ts-ignore
    const spy = jest.spyOn(webrtc, 'handleRetract').mockImplementation();

    webrtc.handleMessage({ id: 'session123', to: 'sndlgkns@lskdn.com', retract: {} } as any);
    expect(spy).toHaveBeenCalled();
  });

  it('should call handledIncomingRtcSession', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    //@ts-ignore
    const spy = jest.spyOn(webrtc, 'handledIncomingRtcSession').mockImplementation();

    webrtc.handleMessage({ id: 'session124', to: 'sndlgkns@lskdn.com', reject: {} } as any);
    expect(spy).toHaveBeenCalled();

    webrtc.handleMessage({ id: 'session123', to: 'sndlgkns@lskdn.com', accept: {} } as any);
    expect(spy).toHaveBeenCalled();
  });
});

describe('addEventListeners', () => {
  it('should refresh ice servers on "connected"', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const error = new Error('Bad timing');

    const spy = jest.spyOn(webrtc.logger, 'error');
    jest.spyOn(webrtc, 'refreshIceServers').mockRejectedValue(error);
    client.config.channelId = 'my-ws-channel';

    client.emit('connected');

    await flush();

    expect(spy).toHaveBeenCalledWith('Error fetching ice servers after streaming-client connected', {
      error,
      channelId: client.config.channelId
    });
  });

  it('should clear existing iceServers interval on connected', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const error = new Error('Bad timing');

    const spy = jest.spyOn(webrtc.logger, 'error');
    jest.spyOn(webrtc, 'refreshIceServers').mockRejectedValue(error);
    client.config.channelId = 'my-ws-channel';

    const clearSpy = jest.spyOn(window, 'clearInterval');
    webrtc['refreshIceServersTimer'] = 123;

    client.emit('connected');

    await flush();

    expect(clearSpy).toHaveBeenCalledWith(123);
    clearSpy.mockRestore();
    expect(spy).toHaveBeenCalledWith('Error fetching ice servers after streaming-client connected', {
      error,
      channelId: client.config.channelId
    });
  });
});

describe('proxyEvents', () => {
  it('should emit outgoingRtcSession', () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const fakeSession = {};

    webrtc.on('outgoingRtcSession', (session) => {
      expect(session).toBe(fakeSession);
    });

    client.emit('jingle:outgoing', fakeSession as any);
  });

  it('should emit incomingRtcSession - pendingSession', () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    const sessionId = 'session123';

    const fakeSession = {
      sid: sessionId
    }

    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.sid).toEqual(sessionId);
    });

    client.emit('jingle:incoming', fakeSession as any);
  });

  it('should emit incomingRtcSession', () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const fakeSession = {};

    webrtc.on('incomingRtcSession', (session) => {
      expect(session).toEqual(fakeSession);
    });

    client.emit('jingle:incoming', fakeSession as any);
  });

  
});

describe('configureStanzaJingle', () => {
  it('should emit sessionEvents', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    jest.spyOn(webrtc as any, 'configureStanzaIceServers').mockResolvedValue(null);

    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    (fakeStanza as any).jingle = new EventEmitter();
    (fakeStanza as any).jingle.config = {
      peerConnectionConfig: {}
    };
    await webrtc.configureStanzaJingle(fakeStanza);

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
      fakeStanza.jingle.emit(e, fakeSession, fakeData);
      expect(fakeSession.emit).toHaveBeenCalledWith(e, fakeData);
      fakeSession.emit.mockReset();
    }

    expect.assertions(events.length);
  });

  it('should log messages from jingle', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    jest.spyOn(webrtc as any, 'configureStanzaIceServers').mockResolvedValue(null);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    (fakeStanza as any).jingle = new EventEmitter();
    (fakeStanza as any).jingle.config = {
      peerConnectionConfig: {}
    };
    const spy = jest.spyOn((webrtc as any).logger, 'warn');

    await webrtc.configureStanzaJingle(fakeStanza);

    fakeStanza.jingle.emit('log', 'warn', 'test', { ping: true });
    expect(spy).toHaveBeenCalledWith('test', { ping: true });
  });
});

describe('handlePropose', () => {
  it('should do nothing if from self', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    client.config.jid = 'myJid';

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

  it('should emit requestIncomingRtcSession event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    client.config.jid = 'myJid';

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
        id: propose.sessionId,
        sessionType: 'unknown',
        toJid: 'myJid',
        roomJid: 'someotherjid',
        fromJid: 'someotherjid'
      }
    );
  });

  it('should call acceptRtcSession for accepted pending sessions on propose', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    client.config.jid = 'myJid';

    const spy = jest.spyOn(webrtc, 'acceptRtcSession');
    const sessionId = v4();

    webrtc.pendingSessions[sessionId] = { accepted: true } as any;

    const propose = {
      autoAnswer: false,
      conversationId: v4(),
      sessionId
    };

    await webrtc['handlePropose']({
      from: 'someotherjid',
      propose,
      to: 'myJid'
    });

    expect(spy).toHaveBeenCalled();
  });
});

describe('handleRetract', () => {
  it('should emit cancelIncomingRtcSession event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    fakeStanza.jid = 'myJid';

    jest.spyOn(webrtc, 'emit');

    const sessionId = '123sessionid'

    webrtc['handleRetract'](sessionId);

    expect(webrtc.emit).toHaveBeenCalledWith('cancelIncomingRtcSession', sessionId);
  });
});

describe('handledIncomingRtcSession', () => {
  it('should emit handledIncomingRtcSession event with pending session', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    fakeStanza.jid = 'myJid';

    jest.spyOn(webrtc, 'emit');

    const acceptSessionId = '123sessionid'
    const accept = { id: acceptSessionId, to: 'sndlgkns@lskdn.com', accept: {} };

    webrtc['handledIncomingRtcSession'](acceptSessionId, accept);
    expect(webrtc.emit).toHaveBeenCalledWith('handledIncomingRtcSession', acceptSessionId);

    const rejectSessionId = '124sessionid'
    const reject = { id: rejectSessionId, to: 'sndlgkns@lskdn.com', reject: {} };

    webrtc['handledIncomingRtcSession'](rejectSessionId, reject);
    expect(webrtc.emit).toHaveBeenCalledWith('handledIncomingRtcSession', rejectSessionId);
  });
});

describe('initiateRtcSession', () => {
  it('should add medias based on provided stream', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };

    fakeStanza.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    fakeStanza.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    fakeStanza.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };
    fakeStanza.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@conference.test.com';
    const fromJid = 'myjid@test.com';

    client.config.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = '21l1kn12l1k2n@conference.test.com';
    const fromJid = 'myjid@test.com';

    const fakestream = {
      getTracks () {
        return [{ kind: 'video' }, { kind: 'audio' }];
      }
    };

    client.config.jid = fromJid;
    const sendSpy = jest.spyOn(fakeStanza, 'send').mockResolvedValue(undefined);

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.acceptRtcSession('sldkf');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send proceed', async () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const sessionId = 'session123';

    webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com', propose: { conversationId: 'test' } } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot reject session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.rejectRtcSession(sessionId);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should not send reject and should add session to ignored', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const sessionId = 'session12355524';
    webrtc.pendingSessions[sessionId] = { from: 'abcjid@test.com' } as any;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.rejectRtcSession(sessionId, true);
    expect(webrtc.ignoredSessions.has(sessionId)).toBeTruthy();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send reject', async () => {
    expect.assertions(2);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const bareJid = 'user@test.com';
    client.config.jid = `${bareJid}/442k2k2k-dkk`;

    const fromJid = 'lskn@test.com';

    const sessionId = 'session12355524';
    webrtc.pendingSessions[sessionId] = { fromJid, conversationId: 'test123' } as ISessionInfo;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot accept session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

    const reject1 = {
      to: bareJid,
      reject: {
        sessionId
      }
    };

    const reject2 = {
      to: fromJid,
      reject: {
        sessionId
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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const sessionId = 'session8581';

    const bareJid = 'user@test.com';
    client.config.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(fakeStanza, 'send');

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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = 'room@conference.com';
    const sessionId = 'session66231';

    const session: GenesysCloudMediaSession = {
      peerID: toJid,
      sid: sessionId
    } as any;

    const bareJid = 'user@test.com';
    client.config.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.notifyScreenShareStart(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from: client.config.jid,
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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const toJid = 'room@conference.com';
    const sessionId = 'session66231';

    const session: GenesysCloudMediaSession = {
      peerID: toJid,
      sid: sessionId
    } as any;

    const bareJid = 'user@test.com';
    client.config.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.notifyScreenShareStop(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from: client.config.jid,
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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot cancel session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.cancelRtcSession('sldkf');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should send proceed', async () => {
    expect.assertions(1);
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const sessionId = 'session12243';
    const toJid = 'room@conference.com';

    webrtc.pendingSessions[sessionId] = { fromJid: 'abcjid@test.com', toJid, conversationId: 'test' } as ISessionInfo;

    webrtc.on('rtcSessionError', (msg) => {
      expect(msg).toEqual('Cannot cancel session because it is not pending or does not exist');
    });

    const sendSpy = jest.spyOn(fakeStanza, 'send');

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
    
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const spy = jest.spyOn(webrtc, 'setIceTransportPolicy');
    jest.spyOn(fakeStanza, 'getServices')
      .mockResolvedValueOnce({
        services: [
          { type: 'turn', host: 'turn.server.com' },
          { port: 123, type: 'turn', host: 'turn.server.com', username: 'user1', password: 'pass1' },
          { port: 456, type: 'turn', host: 'turn.server.com', username: 'user2', password: 'pass2', transport: 'tcp' }
        ]
      } as any)
      .mockResolvedValueOnce({
        services: [
          { port: 234, type: 'stun', host: 'turn.server.com' }
        ]
      } as any);

    await webrtc.refreshIceServers();
    expect(spy).toHaveBeenCalledWith('all');

    expect(fakeStanza.jingle.iceServers).toEqual([
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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    jest.spyOn(fakeStanza, 'getServices')
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
    expect(fakeStanza.jingle.iceServers).toEqual([
      { type: 'turn', urls: 'turn:turn.server.com' },
      { type: 'turn', urls: 'turn:turn.server.com:123', username: 'user1', credential: 'pass1' },
      { type: 'turn', urls: 'turn:turn.server.com:456?transport=tcp', username: 'user2', credential: 'pass2' },
    ]);
  });

  it('should retry if getting the servers fails', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const spy = jest.spyOn(webrtc, 'setIceServers');
    jest.spyOn(fakeStanza, 'getServices')
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
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const spy = jest.spyOn(fakeStanza, 'getServices')
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

  it('should timeout after 15 seconds', async () => {
    jest.useFakeTimers();

    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const spy = jest.spyOn(fakeStanza, 'getServices')
      /* have the call to fetch services "hang" */
      .mockImplementation(() => new Promise(res => setTimeout(res, 100 * 1000)));

    const promise = webrtc.refreshIceServers();

    expect(spy).toHaveBeenCalledTimes(1 * 2);

    /* I don't know why these timers & flushes have to work this way... but it is the only combo that works */
    jest.advanceTimersByTime(15000);
    await flush();

    jest.advanceTimersByTime(15000);
    await flush();

    expect(spy).toHaveBeenCalledTimes(2 * 2);

    jest.advanceTimersByTime(15000);
    expect(spy).toHaveBeenCalledTimes(3 * 2);

    try {
      await promise;
      fail('ice servers should have timedout');
    } catch (error) {
      expect(error.message).toBe('Timeout waiting for refresh ice servers to finish');
    }

    jest.clearAllTimers();
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
  afterEach(() => {
    jest.resetAllMocks();
  });

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

  it('should not proxy stats if the logger has stopped', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const session: any = new EventEmitter();

    const spy = jest.spyOn(statsFormatter, 'formatStatsEvent');

    webrtc.proxyStatsForSession(session);
    client.logger['stopReason'] = '401';

    session.emit('stats', {
      actionName: 'test'
    });

    expect(spy).not.toHaveBeenCalled();
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

  it('should append parent app name and version', async () => {
    const appName = 'sdk';
    const appVersion = '1.2.3';
    const client = new Client({ authToken: '123', appName, appVersion });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    sendSpy.mockReset();

    await webrtc.sendStats();

    expect(sendSpy.mock.calls[0][1].data).toEqual({
      appName: 'streamingclient',
      appVersion: '__STREAMING_CLIENT_VERSION__',
      originAppName: 'sdk',
      originAppVersion: '1.2.3',
      actions: [{}]
    })
  });

  it('should not send stats if isGuest', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    sendSpy.mockReset();

    (client as any).isGuest = true;
    await webrtc.sendStats();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(0);
  });

  it('should send stats if backgroundAssistant', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockResolvedValue(null);
    webrtc['statsArr'].push({} as any);
    sendSpy.mockReset();

    (client as any).isGuest = false;
    client.config.jwt = 'alsknfs';
    (client as any).backgroundAssistantMode = true;
    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
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

describe('getSessionManager', () => {
  it('should return the jingle instance', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    expect(webrtc.getSessionManager()).toBe(stanza.jingle);
  });

  it('should not blow up if no stanza instance', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    expect(webrtc.getSessionManager()).toBeUndefined();
  });
});

describe('configureStanzaIceServers', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let stanza: NamedAgent;
  let refreshSpy: jest.Mock;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
    stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    refreshSpy = webrtc.refreshIceServers = jest.fn();
  });

  it('should set the timer and immediately fetch the ice servers', async () => {
    refreshSpy.mockResolvedValue(null);
    webrtc['configureStanzaIceServers']();
    expect(refreshSpy).toHaveBeenCalled();
    expect(webrtc['refreshIceServersTimer']).toBeDefined();
  });
  
  it('should clear the existing timer', async () => {
    webrtc['refreshIceServersTimer'] = 123;
    const clearSpy = jest.spyOn(window, 'clearInterval');
    refreshSpy.mockResolvedValue(null);
    webrtc['configureStanzaIceServers']();
    expect(refreshSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledWith(123);
    expect(webrtc['refreshIceServersTimer']).toBeDefined();
    clearSpy.mockRestore();
  });

  it('should log error', async () => {
    refreshSpy.mockRejectedValueOnce(new Error('whoops'));
    webrtc['configureStanzaIceServers']();
    expect(refreshSpy).toHaveBeenCalled();
    expect(webrtc['refreshIceServersTimer']).toBeDefined();
  });
});

describe('handleStanzaInstanceChange', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let stanza: NamedAgent;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
    stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
  });

  it('should set and configure new stanza instance', async () => {
    webrtc['stanzaInstance'] = undefined;
    const spy = jest.spyOn((webrtc as any), 'configureStanzaJingle').mockResolvedValue(null);

    const changeSpy = jest.fn();
    client.on('sessionManagerChange', changeSpy);

    await webrtc.handleStanzaInstanceChange(stanza);
    expect(spy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalledWith(stanza);
  });
});