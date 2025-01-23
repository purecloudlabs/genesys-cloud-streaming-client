import { EventEmitter } from "events";
import { Agent, createClient } from "stanza";
import { IQ } from 'stanza/protocol';
import { v4 as uuidv4 } from 'uuid';

import { HttpClient } from "../../src/http-client";
import { GenesysCloudMediaSession } from '../../src/types/genesys-cloud-media-session';
import { IPendingSession } from "../../src/types/interfaces";
import { NamedAgent } from '../../src/types/named-agent';
import { StanzaMediaSession } from "../../src/types/stanza-media-session";
import { WebrtcExtension } from "../../src/webrtc";
import { SessionOpts } from "stanza/jingle/Session";

jest.mock('../../src/types/stanza-media-session');
StanzaMediaSession.prototype.on = jest.fn();

jest.mock('../../src/types/genesys-cloud-media-session', () => {
  return {
    GenesysCloudMediaSession: jest.fn().mockImplementation((webrtcExtension, params) => ({
      meetingId: params.meetingId,
      setRemoteDescription: jest.fn(),
      on: jest.fn()
    }))
  };
});

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

function getFakeStanzaClient (): NamedAgent {
  const instance = new EventEmitter();
  return Object.assign(
    instance,
    {
      config: {},
      id: uuidv4(),
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

describe('handling of Jingle session-initiate and SDP offer with different ordering', () => {
  let client: Client;
  let webrtc: WebrtcExtension;
  const iq: IQ = {
    type: 'set',
    from: 'fromJid24@gjoll.test',
    genesysWebrtc: {
      jsonrpc: '2.0',
      method: 'offer',
      params: {
        conversationId: 'convo24',
        sessionId: 'session24',
        sdp: 'my-offer'
      }
    }
  };
  const pendingSession: IPendingSession = {
    autoAnswer: true,
    conversationId: 'convo24',
    fromJid: 'fromJid24@gjoll.test',
    id: 'session24',
    sessionId: 'session24',
    sessionType: 'softphone',
    toJid: 'tojid24',
    fromUserId: 'fromUserId25',
    originalRoomJid: 'originalRoomJid25',
    meetingId: 'meetingRoom25',
    sdpOverXmpp: true
  };

  beforeEach(() => {
    client = new Client({});
    webrtc = new WebrtcExtension(client as any, {} as any);

    webrtc['sdpOverXmpp'] = true;
    webrtc['stanzaInstance'] = getFakeStanzaClient();
    webrtc.pendingSessions['session24'] = pendingSession;
  });

  it('should only create a GenesysCloudMediaSession and set the meetingId if SDP is handled first', async () => {
    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.meetingId).toBe(pendingSession.meetingId);
    });

    await webrtc['handleGenesysOffer'](iq);
    const session = webrtc.prepareSession({ sid: 'session24' } as SessionOpts);

    expect(session).toBeFalsy();
    expect.assertions(2);
  });

  it('should only create a GenesysCloudMediaSession and set the meetingId if Jingle is handled first', async () => {
    webrtc.on('incomingRtcSession', (session: GenesysCloudMediaSession) => {
      expect(session.meetingId).toBe(pendingSession.meetingId);
    });

    const session = webrtc.prepareSession({ sid: 'session24' } as SessionOpts);
    await webrtc['handleGenesysOffer'](iq);

    expect(session).toBeFalsy();
    expect.assertions(2);
  });
});
