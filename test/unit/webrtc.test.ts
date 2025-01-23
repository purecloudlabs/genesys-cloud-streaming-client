/* tslint:disable:no-string-literal */

import WildEmitter from 'wildemitter';
import { Agent, createClient } from 'stanza';
import { JingleAction } from 'stanza/Constants';
import { v4 } from 'uuid';
import { EventEmitter } from 'events';
import browserama from 'browserama';

import { WebrtcExtension } from '../../src/webrtc';
import * as utils from '../../src/utils';
import * as statsFormatter from '../../src/stats-formatter';
import { HttpClient } from '../../src/http-client';
import { GenesysSessionTerminateParams, GenesysWebrtcSdpParams, ISessionInfo, InsightAction, SessionTypes } from '../../src/types/interfaces';
import { NamedAgent } from '../../src/types/named-agent';
import { StanzaMediaSession } from '../../src/types/stanza-media-session';
import { GenesysCloudMediaSession } from '../../src/types/genesys-cloud-media-session';
import { IQ } from 'stanza/protocol';
import { IMediaSession } from '../../src/types/media-session';

jest.mock('../../src/types/stanza-media-session');
StanzaMediaSession.prototype.on = jest.fn();

jest.mock('../../src/types/genesys-cloud-media-session');
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
      send: jest.fn().mockResolvedValue(null),
      sendIQ: jest.fn()
    }
  ) as unknown as NamedAgent;
}

class Client extends EventEmitter {
  connected = false;
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

let isOnline = true;

beforeAll(() => {
  Object.defineProperty(navigator, 'onLine', { get: () => isOnline });
})

afterEach(() => {
  isOnline = true;
});

class FakePeerConnection extends EventTarget {
  oniceconnectionstatechange = jest.fn();
}

function flush () {
  return new Promise(res => setImmediate(res));
}

describe('get jid()', () => {
  it('should return stanzaInstance jid', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc['stanzaInstance'] = { jid: 'fake' } as any;

    expect(webrtc.jid).toEqual('fake');
  });

  it('should return undefined', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc['stanzaInstance'] = undefined;

    expect(webrtc.jid).toBeUndefined();
  });
});

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

describe('handleGenesysWebrtcStanza', () => {
  let client: Client;
  let webrtc: WebrtcExtension;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
  });

  it('should call handleGenesysOffer', async () => {
    const iq: IQ = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'sid',
          conversationId: 'cid',
          sdp: 'jskdf'
        }
      }
    };

    const spy = webrtc['handleGenesysOffer'] = jest.fn();

    await webrtc.handleGenesysWebrtcStanza(iq);
    expect(spy).toHaveBeenCalled();
  });

  it('should call handleGenesysIceCandidate', async () => {
    const iq: IQ = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'iceCandidate',
        params: {
          sessionId: 'sid',
          sdp: 'jskdf'
        }
      }
    };

    const spy = webrtc['handleGenesysIceCandidate'] = jest.fn();

    await webrtc.handleGenesysWebrtcStanza(iq);
    expect(spy).toHaveBeenCalled();
  });

  it('should call handleGenesysTerminate', async () => {
    const iq: IQ = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'terminate',
        params: {
          sessionId: 'sid',
          reason: 'alternative-session'
        }
      }
    };

    const spy = webrtc['handleGenesysTerminate'] = jest.fn();

    await webrtc.handleGenesysWebrtcStanza(iq);
    expect(spy).toHaveBeenCalled();
  });
});

describe('prepareSession', () => {
  it('should return undefined if sdpOverXmpp', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'abc';
    const pendingSession = {
      sdpOverXmpp: true
    };
    webrtc.pendingSessions[sessionId] = pendingSession as any;

    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('all');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({ sid: sessionId } as any);
    expect(StanzaMediaSession).not.toHaveBeenCalled();
    expect(session).toBeUndefined();
  });

  it('should create media session if sdpOverXmpp is falsey', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sessionId = 'abc';
    const pendingSession = {
      sdpOverXmpp: false
    };
    webrtc.pendingSessions[sessionId] = pendingSession as any;

    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('all');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({ sid: sessionId } as any);
    expect(StanzaMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });

  it('should create media session with ignoreHostCandidates', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({} as any);
    expect(StanzaMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: true }));
  });

  it('should delete pending session', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    StanzaMediaSession.prototype.on = jest.fn();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.pendingSessions = { mysid: { sessionId: 'mysid' } as any };

    expect(Object.values(webrtc.pendingSessions).length).toBe(1);
    const session = webrtc.prepareSession({ sid: 'mysid' } as any);
    expect(Object.values(webrtc.pendingSessions).length).toBe(0);
  });

  it('should use sessionType from pendingSession', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    StanzaMediaSession.prototype.on = jest.fn();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc.pendingSessions = { mysid: { sessionId: 'mysid', sessionType: 'softphone' } as any };

    expect(Object.values(webrtc.pendingSessions).length).toBe(1);
    const session = webrtc.prepareSession({ sid: 'mysid' } as any);
    expect((StanzaMediaSession as jest.Mock)).toHaveBeenCalledWith(expect.objectContaining({ sessionType: 'softphone' }));
    expect(Object.values(webrtc.pendingSessions).length).toBe(0);
  });

  it('should create mediaSession without ignoreHostCandidates if not ff', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('relay');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => false });

    const session = webrtc.prepareSession({} as any);
    expect(StanzaMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
  });

  it('should create mediaSession without ignoreHostCandidates if not relay and is firefox', () => {
    (StanzaMediaSession as jest.Mock).mockReset();
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.proxyStatsForSession = jest.fn();
    jest.spyOn(webrtc, 'getIceTransportPolicy').mockReturnValue('all');
    jest.spyOn(webrtc, 'getSessionTypeByJid').mockReturnValue(SessionTypes.softphone);
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });

    const session = webrtc.prepareSession({} as any);
    expect(StanzaMediaSession).toBeCalledWith(expect.objectContaining({ ignoreHostCandidatesFromRemote: false }));
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

    webrtc.on('incomingRtcSession', (session: StanzaMediaSession) => {
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

  it('should end session in jingle:created if not StanzaMediaSession', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const fakeSession = {
      end: jest.fn()
    };

    client.emit('jingle:created', fakeSession as any);

    expect(fakeSession.end).toHaveBeenCalled();
  });

  it('should not end session in jingle:created if StanzaMediaSession', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const session = new StanzaMediaSession({
      end: jest.fn()
    } as any);

    client.emit('jingle:created', session as any);

    expect(session.end).not.toHaveBeenCalled();
  });
});

describe('configureNewStanzaInstance', () => {
  it('should emit sessionEvents', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    jest.spyOn(webrtc as any, 'configureStanzaIceServers').mockResolvedValue(null);

    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    (fakeStanza as any).jingle = new EventEmitter();
    (fakeStanza as any).jingle.config = {
      peerConnectionConfig: {}
    };
    await webrtc.configureNewStanzaInstance(fakeStanza);

    const fakeSession = Object.create(StanzaMediaSession.prototype);
    fakeSession.emit = jest.fn();

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

  it('should not emit sessionEvents if not a StanzaMediaSession', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    jest.spyOn(webrtc as any, 'configureStanzaIceServers').mockResolvedValue(null);

    const fakeStanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
    (fakeStanza as any).jingle = new EventEmitter();
    (fakeStanza as any).jingle.config = {
      peerConnectionConfig: {}
    };
    await webrtc.configureNewStanzaInstance(fakeStanza);

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
      expect(fakeSession.emit).not.toHaveBeenCalled();
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

    await webrtc.configureNewStanzaInstance(fakeStanza);

    fakeStanza.jingle.emit('log', 'warn', 'test', { ping: true });
    expect(spy).toHaveBeenCalledWith('test', { ping: true });
  });
});

describe('handlePropose', () => {
  it('should do nothing if from self', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc['stanzaInstance'] = { jid: 'myJid' } as any;

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

    webrtc['stanzaInstance'] = { jid: 'myJid' } as any;

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

  it('should track sdpOverXmpp', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc['stanzaInstance'] = getFakeStanzaClient();

    webrtc['sdpOverXmpp'] = false;
    const propose1 = { autoAnswer: false, conversationId: v4(), sessionId: v4(), sdpOverXmpp: true };
    await webrtc['handlePropose']({ from: 'someJid', to: 'myJid', propose: propose1 });
    expect(webrtc['sdpOverXmpp']).toBeTruthy();

    webrtc['sdpOverXmpp'] = true;
    const propose2 = { autoAnswer: false, conversationId: v4(), sessionId: v4() };
    await webrtc['handlePropose']({ from: 'someJid', to: 'myJid', propose: propose2 });
    expect(webrtc['sdpOverXmpp']).toBeFalsy();
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

    fakeStanza.jid = fromJid;
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

    fakeStanza.jid = fromJid;
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
    fakeStanza.jid = `${bareJid}/442k2k2k-dkk`;

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
    fakeStanza.jid = `${bareJid}/442k2k2k-dkk`;

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

    const session: StanzaMediaSession = {
      peerID: toJid,
      id: sessionId
    } as any;

    const bareJid = 'user@test.com';
    const from = fakeStanza.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.notifyScreenShareStart(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from,
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

    const session: StanzaMediaSession = {
      peerID: toJid,
      id: sessionId
    } as any;

    const bareJid = 'user@test.com';
    const from = fakeStanza.jid = `${bareJid}/442k2k2k-dkk`;
    const sendSpy = jest.spyOn(fakeStanza, 'send');

    await webrtc.notifyScreenShareStop(session);

    expect(sendSpy).toHaveBeenCalledWith('iq', {
      to: toJid,
      from,
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
    expect(spy).toHaveBeenCalledWith('all', fakeStanza);

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

    expect(spy).toHaveBeenCalledWith('relay', fakeStanza);
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
    ], fakeStanza);
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

    const details = {
      _eventType: 'test',
      _eventTimestamp: new Date().getTime(),
      conversationId: 'myconvoid',
      sessionId: 'mysid',
      sessionType: 'softphone',
    };

    const formattedStats: InsightAction<typeof details> = {
      actionName: 'WebrtcStats',
      details
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

    const details = {
      _eventType: 'test',
      _eventTimestamp: new Date().getTime(),
      conversationId: 'myconvoid',
      sessionId: 'mysid',
      sessionType: 'softphone',
    };

    const formattedStats: InsightAction<typeof details> = {
      actionName: 'WebrtcStats',
      details
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

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockRejectedValue({ response: { status: ''}});
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
      err.response = { status: 413 };
      throw err;
    });
    const logSpy = jest.spyOn(webrtc.logger, 'info');

    webrtc['statsArr'].push({} as any);

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it('should not try to send stats if browser is offline', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);
    const sendSpy = jest.spyOn(client.http, 'requestApi');

    isOnline = false;

    expect(webrtc['statsArr'].length).toBe(0);
    webrtc['statsArr'].push({} as any);
    expect(webrtc['statsArr'].length).toBe(1);

    await webrtc.sendStats();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(1);
  });

  it('should re-add failed stats if the failure is due to the browser being offline', async () => {
    const client = new Client({ authToken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockImplementation(() => {
      const err: any = new Error('error');
      err.response = undefined;
      isOnline = false;
      throw err;
    });

    expect(webrtc['statsArr'].length).toBe(0);
    webrtc['statsArr'].push({} as any);
    expect(webrtc['statsArr'].length).toBe(1);

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(1);
  });

  it('should re-add failed stats if status code is considered retryable', async () => {
    const client = new Client({ authtoken: '123' });
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const sendSpy = jest.spyOn(client.http, 'requestApi').mockImplementation(() => {
      const err: any = new Error('error');
      err.response = { status: 429 };
      throw err;
    });

    expect(webrtc['statsArr'].length).toBe(0);
    webrtc['statsArr'].push({} as any);
    expect(webrtc['statsArr'].length).toBe(1);

    await webrtc.sendStats();
    expect(sendSpy).toHaveBeenCalled();
    expect(webrtc['statsArr'].length).toBe(1);
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
    refreshSpy = webrtc._refreshIceServers = jest.fn();
  });

  it('should fetch the ice servers', async () => {
    refreshSpy.mockResolvedValue(null);
    webrtc['configureStanzaIceServers'](stanza);
    expect(refreshSpy).toHaveBeenCalled();
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

    const changeSpy = jest.fn();
    (client as any).on('sessionManagerChange', changeSpy);

    await webrtc.handleStanzaInstanceChange(stanza);
    expect(changeSpy).toHaveBeenCalledWith(stanza);
  });

  it('should clear the ice timer', async () => {
    webrtc['refreshIceServersTimer'] = 123 as any;

    const spy = jest.spyOn(window, 'clearInterval');

    await webrtc.handleStanzaInstanceChange(stanza);

    expect(spy).toHaveBeenCalledWith(123);
  })
});

describe('getAllSessions', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let stanza: NamedAgent;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
    stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();
  });

  it('should return a union of sessions', () => {
    const jSession1 = { id: '51' };
    const genSession1 = { id: '2' };

    stanza.jingle.sessions = [ jSession1 ] as any;
    webrtc['webrtcSessions'] = [ genSession1 ] as any;

    const sessions = webrtc.getAllSessions();
    expect(sessions.length).toBe(2);
    expect(sessions).toContain(jSession1);
    expect(sessions).toContain(genSession1);
  });

  it('should handle no stanza instance', () => {
    webrtc['stanzaInstance'] = undefined;
    const genSession1 = { id: '2' };

    webrtc['webrtcSessions'] = [ genSession1 ] as any;

    const sessions = webrtc.getAllSessions();
    expect(sessions.length).toBe(1);
    expect(sessions).toContain(genSession1);
  });
});

describe('getSessionById', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let getAllSessionsSpy: jest.Mock;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
    getAllSessionsSpy = webrtc.getAllSessions = jest.fn();
  });

  it('should return session', () => {
    const session = {
      id: 'session86'
    };

    getAllSessionsSpy.mockReturnValue([ session ]);

    expect(webrtc['getSessionById']('session86')).toBe(session);
  });

  it('should throw if no session is found', () => {
    getAllSessionsSpy.mockReturnValue([ ]);
    expect(() => webrtc['getSessionById']('session86')).toThrowError('Failed to find session by id');
  });
});

describe('handleGenesysTerminate', () => {
  let client: Client;
  let webrtc: WebrtcExtension;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
  });

  it('should call onSessionTerminate on the session', async () => {
    const session = {
      onSessionTerminate: jest.fn()
    };

    webrtc['getSessionById'] = jest.fn().mockReturnValue(session);

    const iq: IQ = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'terminate',
        params: {
          sessionId: 'session24',
          reason: 'general-error'
        } as GenesysSessionTerminateParams
      }
    };

    await webrtc['handleGenesysTerminate'](iq);
    expect(session.onSessionTerminate).toHaveBeenCalledWith('general-error');
  });
});

describe('handleGenesysIceCandidate', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let iq: IQ;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);

    iq = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'iceCandidate',
        params: {
          sessionId: 'session24',
          sdp: 'my-candidate'
        } as GenesysWebrtcSdpParams
      }
    };
  });

  it('should call onSessionTerminate on the session', async () => {
    const session = {
      addRemoteIceCandidate: jest.fn()
    };

    webrtc['getSessionById'] = jest.fn().mockReturnValue(session);

    await webrtc['handleGenesysIceCandidate'](iq);
    expect(session.addRemoteIceCandidate).toHaveBeenCalledWith('my-candidate');
  });

  it('should add ICE candidate to earlyIceCandidates when session does not exist', async () => {
    webrtc['getSessionById'] = jest.fn().mockReturnValue(undefined);

    await webrtc['handleGenesysIceCandidate'](iq);

    expect(webrtc['earlyIceCandidates'].get('session24')).toEqual(['my-candidate']);
  });

  it('should append ICE candidate to earlyIceCandidates when it already exists', async () => {
    webrtc['getSessionById'] = jest.fn().mockReturnValue(undefined);
    webrtc['earlyIceCandidates'].set('session24', ['existing-sdp']);

    await webrtc['handleGenesysIceCandidate'](iq);

    expect(webrtc['earlyIceCandidates'].get('session24')).toEqual(['existing-sdp', 'my-candidate']);
  });
});

describe('handleGenesysOffer', () => {
  let client: Client;
  let webrtc: WebrtcExtension;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
  });

  it('should create and emit a session (no pending session)', async () => {
    const iq: IQ = {
      type: 'set',
      from: '+155555555@org.gjoll.test',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'my-offer'
        }
      }
    };

    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.setRemoteDescription).toHaveBeenCalled();
      expect(webrtc['webrtcSessions'].length).toEqual(1);
    });
    const spy = webrtc['handleGenesysRenegotiate'] = jest.fn();

    await webrtc['handleGenesysOffer'](iq);
    expect(spy).not.toHaveBeenCalled();
    expect.assertions(3);
  });

  it('should renegotiate if there is an existing session', async () => {
    const iq: IQ = {
      type: 'set',
      from: '+155555555@org.gjoll.test',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'a=ice-ufrag:asdfasdf\r\na=ice-pwd:fdsafdsa\r\n'
        }
      }
    };

    const peerConnection = { ...(new FakePeerConnection()), remoteDescription: { sdp: 'a=ice-ufrag:asdfasdf\r\na=ice-pwd:fdsafdsa\r\n' }};

    const existingSession = { id: iq.genesysWebrtc?.params?.sessionId, peerConnection };

    const spy = webrtc['handleGenesysRenegotiate'] = jest.fn();

    webrtc['webrtcSessions'] = [existingSession as any];

    await webrtc['handleGenesysOffer'](iq);
    expect(spy).toHaveBeenCalledWith(existingSession, 'a=ice-ufrag:asdfasdf\r\na=ice-pwd:fdsafdsa\r\n');
    expect(webrtc['webrtcSessions'].length).toEqual(1);
  });

  it('should emit a new session for a reinvite (existing session, different ice)', async () => {
    const iq: IQ = {
      type: 'set',
      from: '+155555555@org.gjoll.test',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'a=ice-ufrag:asdfasdf\r\na=ice-pwd:fdsafdsa\r\n'
        }
      }
    };
    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.setRemoteDescription).toHaveBeenCalled();
      expect(webrtc['webrtcSessions'].length).toEqual(2);
    });

    const peerConnection = { ...(new FakePeerConnection()), remoteDescription: { sdp: 'a=ice-ufrag:qwerqwer\r\na=ice-pwd:rewqrewq\r\n' }};

    const existingSession = { id: iq.genesysWebrtc?.params?.sessionId, peerConnection };

    const spy = webrtc['handleGenesysRenegotiate'] = jest.fn();

    webrtc['webrtcSessions'] = [existingSession as any];

    await webrtc['handleGenesysOffer'](iq);
    expect(spy).not.toHaveBeenCalled();
    expect.assertions(3);
  });

  it('should NOT emit a new session for a reinvite if it is a duplicate offer.', async () => {
    const iq: IQ = {
      type: 'set',
      from: '+155555555@org.gjoll.test',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        id: '123testid',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'a=ice-ufrag:asdfasdf\r\na=ice-pwd:fdsafdsa\r\n',
          reinvite: true
        }
      }
    };
    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.setRemoteDescription).toHaveBeenCalled();
      expect(webrtc['webrtcSessions'].length).toEqual(2);
    });

    const peerConnection = { ...(new FakePeerConnection()), remoteDescription: { sdp: 'a=ice-ufrag:qwerqwer\r\na=ice-pwd:rewqrewq\r\n' }};
    const existingSession = { id: iq.genesysWebrtc?.params?.sessionId, peerConnection };

    const spy = webrtc['handleGenesysRenegotiate'] = jest.fn();
    const loggerSpy = jest.spyOn(webrtc['logger'], 'info');


    // Start with one session.
    webrtc['webrtcSessions'] = [existingSession as any];

    // Second session (reinvite).
    await webrtc['handleGenesysOffer'](iq);
    expect(spy).not.toHaveBeenCalled();
    expect(webrtc['webrtcSessions'].length).toEqual(2);
    expect(loggerSpy).not.toHaveBeenCalledWith('Ignoring duplicate reinvite offer', expect.any(String));

    // Second identical reinvite that should be ignored.
    await webrtc['handleGenesysOffer'](iq);
    expect(loggerSpy).toHaveBeenCalledWith('Ignoring duplicate reinvite offer', iq.genesysWebrtc?.id);
    expect(webrtc['webrtcSessions'].length).toEqual(2);

    expect.assertions(7);
  });

  it('should set ignoreHostCandidatesForForceTurnFF', async () => {
    Object.defineProperty(browserama, 'isFirefox', { get: () => true });
    jest.spyOn(webrtc as any, 'getIceTransportPolicy').mockReturnValue('relay');

    const iq: IQ = {
      type: 'set',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'my-offer'
        }
      }
    };

    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.setRemoteDescription).toHaveBeenCalled();
      expect(webrtc['webrtcSessions'].length).toEqual(1);
    });

    await webrtc['handleGenesysOffer'](iq);
    expect.assertions(2);
  });

  it('should register and handle sendIq from the session', async () => {
    const emitter = new EventEmitter();
    (emitter as any).setRemoteDescription = jest.fn();
    (GenesysCloudMediaSession as jest.Mock).mockReturnValue(emitter);

    const stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const iq: IQ = {
      type: 'set',
      from: 'fromJid25@gjoll.com',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'my-offer'
        }
      }
    };

    await webrtc['handleGenesysOffer'](iq);
    const iqObj = {};
    emitter.emit('sendIq', iqObj);
    expect(stanza.sendIQ).toHaveBeenCalledWith(iqObj);
  });

  it('terminated should update sessions', async () => {
    const emitter = new EventEmitter();
    (emitter as any).setRemoteDescription = jest.fn();
    (GenesysCloudMediaSession as jest.Mock).mockReturnValue(emitter);

    const stanza = webrtc['stanzaInstance'] = getFakeStanzaClient();

    const iq: IQ = {
      type: 'set',
      from: 'fromJid25@gjoll.com',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'my-offer'
        }
      }
    };

    await webrtc['handleGenesysOffer'](iq);
    expect(webrtc.getAllSessions().length).toBe(1);
    emitter.emit('terminated');
    expect(webrtc.getAllSessions().length).toBe(0);
  });

  it('should register and handle sendIq from the session and not blow up if not stanzaInstance', async () => {
    const emitter = new EventEmitter();
    (emitter as any).setRemoteDescription = jest.fn();
    (GenesysCloudMediaSession as jest.Mock).mockReturnValue(emitter);

    const iq: IQ = {
      type: 'set',
      from: 'fromJid25@gjoll.com',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          sessionId: 'session24',
          conversationId: 'cid',
          sdp: 'my-offer'
        }
      }
    };

    await webrtc['handleGenesysOffer'](iq);
    const iqObj = {};
    emitter.emit('sendIq', iqObj);
  });

  it('should create and emit a session (from pending session)', async () => {
    webrtc['stanzaInstance'] = getFakeStanzaClient();

    const iq: IQ = {
      type: 'set',
      from: 'fromJid25@gjoll.com',
      genesysWebrtc: {
        jsonrpc: '2.0',
        method: 'offer',
        params: {
          conversationId: 'convo25',
          sessionId: 'session25',
          sdp: 'my-offer'
        }
      }
    };

    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.setRemoteDescription).toHaveBeenCalled();
      expect(webrtc['webrtcSessions'].length).toEqual(1);
      expect(GenesysCloudMediaSession).toHaveBeenCalledWith(expect.anything(),
        expect.objectContaining({
          fromUserId: 'fromUserId26',
          originalRoomJid: 'originalRoomJid26'
        })
      );
    });

    webrtc.pendingSessions['session25'] = {
      autoAnswer: true,
      conversationId: 'convo25',
      fromJid: 'fromJid25@gjoll.com',
      id: 'session25',
      sessionId: 'session25',
      sessionType: 'softphone',
      toJid: 'tojid25',
      fromUserId: 'fromUserId26',
      originalRoomJid: 'originalRoomJid26'
    };

    await webrtc['handleGenesysOffer'](iq);
  });
});

describe('applyEarlyIceCandidates', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  let mockSession: GenesysCloudMediaSession;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
    mockSession = {
      id: 'session-id-1',
      addRemoteIceCandidate: jest.fn(),
    } as unknown as GenesysCloudMediaSession;
  });

  it('should apply early ICE candidates if they exist and delete them from earlyIceCandidates', () => {
    // Set up early ICE candidates for the session
    webrtc['earlyIceCandidates'].set('session-id-1', ['candidate-1', 'candidate-2']);

    webrtc['applyEarlyIceCandidates'](mockSession);

    // Check that addRemoteIceCandidate is called for each candidate
    expect(mockSession.addRemoteIceCandidate).toHaveBeenCalledTimes(2);
    expect(mockSession.addRemoteIceCandidate).toHaveBeenNthCalledWith(1, 'candidate-1');
    expect(mockSession.addRemoteIceCandidate).toHaveBeenNthCalledWith(2, 'candidate-2');

    // Check that early candidates are deleted after being applied
    expect(webrtc['earlyIceCandidates'].has('session-id-1')).toBe(false);
  });

  it('should not attempt to apply ICE candidates if none exist for the session', () => {
    // No candidates are set for this session
    webrtc['applyEarlyIceCandidates'](mockSession);

    // Check that addRemoteIceCandidate is not called
    expect(mockSession.addRemoteIceCandidate).not.toHaveBeenCalled();

    // Ensure that no deletion is attempted on the map
    expect(webrtc['earlyIceCandidates'].has('session-id-1')).toBe(false);
  });

  it('should not fail if earlyIceCandidates is empty', () => {
    // Empty the earlyIceCandidates map
    webrtc['earlyIceCandidates'].clear();

    webrtc['applyEarlyIceCandidates'](mockSession);

    // Ensure addRemoteIceCandidate is not called since there are no early candidates
    expect(mockSession.addRemoteIceCandidate).not.toHaveBeenCalled();
  });
});

describe('handleGenesysRenegotiate', () => {
  let client: Client;
  let webrtc: WebrtcExtension;

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);
  });

  it('should set remoteDescription and accept session', async () => {
    const setRemoteDescriptionSpy = jest.fn().mockResolvedValue(null);
    const acceptSpy = jest.fn().mockResolvedValue(null);

    const existingSession = {
      peerConnection: {
        setRemoteDescription: setRemoteDescriptionSpy
      },
      accept: acceptSpy
    };

    await webrtc['handleGenesysRenegotiate'](existingSession as any, 'i like cashews');

    expect(setRemoteDescriptionSpy).toHaveBeenCalledWith({ sdp: 'i like cashews', type: 'offer' });
    expect(acceptSpy).toHaveBeenCalled();
  });
});

describe('sendIq', () => {
  it('should proxy to stanza.sendIQ', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = jest.fn().mockResolvedValue({});
    webrtc['stanzaInstance'] = { sendIQ: spy } as any;

    const testObj = {};
    await webrtc.sendIq(testObj as any);

    expect(spy).toHaveBeenCalledWith(testObj);
  });

  it('should throw an error if there is no stanza client', async () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const testObj = {};
    await expect(() => webrtc.sendIq(testObj as any)).rejects.toThrow();
  });
});

describe('addStatToQueue', () => {
  it('should do nothing if optOutOfWebrtcStatsTelemetry', () => {
    const client = new Client({ });
    const webrtc = new WebrtcExtension(client as any, {} as any);
    webrtc.config.optOutOfWebrtcStatsTelemetry = true;

    const spy1 = webrtc.sendStatsImmediately = jest.fn();
    const spy2 = webrtc['throttledSendStats'] = jest.fn();

    const myObj = {} as any;
    webrtc.addStatToQueue(myObj);

    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).not.toHaveBeenCalled();
  });
});

describe('proxyNRStat', () => {
  it('should call addStatToQueue', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = webrtc.addStatToQueue = jest.fn();

    const myObj = {} as any;
    webrtc.proxyNRStat(myObj);
    expect(spy).toHaveBeenCalled();
  });
});

describe('onOnlineStatusChange()', () => {
  it('should call addStatToQueue with online', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = webrtc.addStatToQueue = jest.fn();

    const expectedDetails = expect.objectContaining({
      _eventType: 'onlineStatus',
      online: true
    });

    window.dispatchEvent(new Event('online'));
    expect(spy).toHaveBeenCalledWith({ actionName: 'WebrtcStats', details: expectedDetails });
  });

  it('should call addStatToQueue with offline', () => {
    const client = new Client({});
    const webrtc = new WebrtcExtension(client as any, {} as any);

    const spy = webrtc.addStatToQueue = jest.fn();


    const expectedDetails = expect.objectContaining({
      _eventType: 'onlineStatus',
      online: false
    });

    window.dispatchEvent(new Event('offline'));
    expect(spy).toHaveBeenCalledWith({ actionName: 'WebrtcStats', details: expectedDetails });
  });
});
