import Client from './client';
import { definitions, Propose } from './stanza-definitions/webrtc-signaling';
import { EventEmitter } from 'events';
import { ReceivedMessage } from 'stanza/protocol';
import { toBare } from 'stanza/JID';
import { MediaSession } from 'stanza/jingle';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';

const events = {
  REQUEST_WEBRTC_DUMP: 'requestWebrtcDump', // dump triggered by someone in room

  /* jingle messaging */
  REQUEST_INCOMING_RTCSESSION: 'requestIncomingRtcSession', // incoming call
  CANCEL_INCOMING_RTCSESSION: 'cancelIncomingRtcSession', // retracted (caller hungup before you answered)
  HANDLED_INCOMING_RTCSESSION: 'handledIncomingRtcSession', // you answered on another client
  OUTGOING_RTCSESSION_PROCEED: 'outgoingRtcSessionProceed', // target answered, wants to continue
  OUTGOING_RTCSESSION_REJECTED: 'outgoingRtcSessionRejected', // target rejected the call

  // /* jingle */
  // RTC_ICESERVERS: 'rtcIceServers', // ice servers have been discovered
  INCOMING_RTCSESSION: 'incomingRtcSession', // jingle session created for incoming call
  OUTGOING_RTCSESSION: 'outgoingRtcSession', // jingle session created for outgoing call
  RTCSESSION_ERROR: 'rtcSessionError', // jingle error occurred
  // TRACE_RTCSESSION: 'traceRtcSession', // trace messages for logging, etc
  // UPGRADE_MEDIA_ERROR: 'upgradeMediaError', // error occurred joining conference

  // /* other  */
  // UPDATE_MEDIA_PRESENCE: 'updateMediaPresence',
  // LASTN_CHANGE: 'lastNChange'
};

type ProposeStanza = ReceivedMessage & { propose: Propose };

class GenesysCloudMediaSession extends MediaSession {
  constructor (options: any, private allowIPv6: boolean) {
    super(options);
    console.log('***debug: creating session');
  }

  onIceStateChange () {
    const state = this.pc.iceConnectionState;
    console.log('***debug: iceStateChange: ', state);

    if (state === 'connected') {
      debugger;
      this._log('info', 'sending session-info: active');
      this.send(JingleAction.SessionInfo, {
        info: {
          infoType: JINGLE_INFO_ACTIVE
        }
      });
    }

    super.onIceStateChange();
  }

  onIceCandidate (e: RTCPeerConnectionIceEvent) {
    if (!this.allowIPv6) {
      const addressRegex = /.+udp [^ ]+ ([^ ]+).*typ host/;
      const matches = addressRegex.exec(e.candidate.candidate);

      const ipv4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
      if (matches && !matches[1].match(ipv4Regex)) {
        this._log('debug', 'Filtering out IPv6 candidate', e.candidate.candidate);
        return;
      }
    }

    if (e.candidate) {
      this._log('debug', 'Processing ice candidate', e.candidate.candidate);
    }

    return super.onIceCandidate(e);
  }
}

export class WebrtcExtension extends EventEmitter {
  logger: any;
  stanzaHandlers: {[name: string]: (stanza: any, raw: any) => void};
  pendingSessions: {[sessionId: string]: ProposeStanza} = {};
  config: {
    iceTransportPolicy?: 'relay' | 'all',
    iceServers: any[],
    allowIPv6: boolean
  };

  get jid (): string {
    return this.client._stanzaio.jid;
  }

  constructor (public client: Client, clientOptions: any = {}) {
    super();
    this.config = {
      iceTransportPolicy: clientOptions.iceTransportPolicy,
      iceServers: clientOptions.iceServers,
      allowIPv6: clientOptions.allowIPv6 === true
    };
    this.logger = client.logger;
    client._stanzaio.stanzas.define(definitions);
    client._stanzaio.jingle.prepareSession = this.prepareSession.bind(this);
    this.addEventListeners();
    this.proxyEvents();
  }

  prepareSession (options: any) {
    options.iceTransportPolicy = this.config.iceTransportPolicy || 'all';
    options.iceServers = this.config.iceServers || options.iceServers;

    return new GenesysCloudMediaSession(options, this.config.allowIPv6);
  }

  addEventListeners () {
    this.client.on('connected', async () => {
      await this.refreshIceServers();
    });

    this.client._stanzaio.jingle.on('log', (level, message, data) => {
      this.logger[level](message, { data });
    });

    this.client._stanzaio.on('message', (msg: any) => {
      if (msg.propose) {
        this.handlePropose(msg);
      }
    });
  }

  proxyEvents () {
    // this.jingleJs.on('send', data => {
    //   if (data.jingle && data.jingle.sid && this.ignoredSessions.get(data.jingle.sid)) {
    //     this.logger.debug('Ignoring outbound stanza for ignored session', data.jingle.sid);
    //     return;
    //   }
    //   this.emit('send', data);
    // });

    this.client._stanzaio.on('jingle:outgoing', session => {
      return this.emit(events.OUTGOING_RTCSESSION, session);
    });

    this.client._stanzaio.on('jingle:incoming', session => {
      return this.emit(events.INCOMING_RTCSESSION, session);
    });

    // this.client._stanzaio.on('jingle:log:*', (level, msg, details) => {
    //   return this.emit(events.TRACE_RTCSESSION, level.split(':')[1], msg, details);
    // });

    // this.client._stanzaio.on('jingle:error', req => {
    //   return this.emit(events.RTCSESSION_ERROR, req.error, req);
    // });
  }

  /**
   * Stanza Handlers
   */
  private handlePropose (msg: ProposeStanza) {
    if (msg.from === this.jid) {
      return;
    }

    this.logger.info('propose received', { from: msg.from });
    this.pendingSessions[msg.propose.sessionId] = msg;
    // TODO: is ofrom used?
    // const roomJid = (msg.ofrom && msg.ofrom.full) || msg.from.full || msg.from;
    const fromJid = msg.from;
    const roomJid = fromJid;
    return this.emit(events.REQUEST_INCOMING_RTCSESSION, Object.assign({ roomJid, fromJid }, msg.propose));
  }

  /**
   * Exposed Api
   */
  acceptRtcSession (sessionId: string) {
    const session = this.pendingSessions[sessionId];
    if (!session) {
      this.emit(
        events.RTCSESSION_ERROR,
        'Cannot accept session because it is not pending or does not exist'
      );
      return;
    }

    const proceed = {
      to: session.from,
      proceed: {
        sessionId
      }
    };
    this.emit('send', proceed, true); // send as Message
    delete this.pendingSessions[sessionId];
  }

  rtcSessionAccepted (sessionId: string) {
    const proceed = {
      to: toBare(this.jid),
      accept: {
        sessionId
      }
    };
    this.emit('send', proceed, true); // send as Message
  }

  // these are the functions to handle each stanza that should be handled
  // setupStanzaHandlers () {
  //   this.stanzaHandlers = {
  //     jingle: function (stanza) {
  //       if (['result', 'error'].includes(stanza.type)) {
  //         const pendingIq = this.pendingIqs[stanza.id];
  //         if (pendingIq) {
  //           // Workaround for https://github.com/otalk/jingle.js/issues/34
  //           stanza.jingle = pendingIq.jingle;
  //           delete this.pendingIqs[stanza.id];
  //         } else {
  //           return; // this is an error or result for a stanza we did not send
  //         }
  //       }

  //       if (stanza.jingle && stanza.jingle.sid && this.ignoredSessions.get(stanza.jingle.sid)) {
  //         this.logger.debug('Ignoring inbound stanza for ignored webrtc session', stanza.jingle.sid);
  //         return;
  //       }

  //       // the core of handling jingle stanzas is to feed them to jinglejs
  //       this.jingleJs.process(stanza);
  //     }.bind(this),

  //     jingleMessageInit: function (stanza, raw) {
  //       if (stanza.from === this.jid.bare) {
  //         return;
  //       }
  //       if (stanza.ofrom) {
  //         let fromJid = stanza.ofrom;
  //         if (fromJid.toString() === this.jid.bare) {
  //           return;
  //         }
  //         stanza.from = fromJid.toString();
  //       }
  //       this.pendingSessions[stanza.propose.id] = stanza;
  //       const roomJid = (stanza.ofrom && stanza.ofrom.full) || stanza.from.full || stanza.from;
  //       const fromJid = stanza.from.full || stanza.from;
  //       return this.emit(events.REQUEST_INCOMING_RTCSESSION, {
  //         sessionId: stanza.propose.id,
  //         conversationId: raw.propose.xml.attrs['inin-cid'],
  //         originalRoomJid: raw.propose.xml.attrs['inin-ofrom'] || fromJid,
  //         autoAnswer: raw.propose.xml.attrs['inin-autoanswer'] === 'true',
  //         persistentConnectionId: raw.propose.xml.attrs['inin-persistent-cid'],
  //         fromUserId: raw.propose.xml.attrs['inin-user-id'],
  //         roomJid,
  //         fromJid
  //       });
  //     }.bind(this),

  //     jingleMessageRetract: function (stanza) {
  //       this.emit(events.CANCEL_INCOMING_RTCSESSION, stanza.retract.id);
  //       return delete this.pendingSessions[stanza.retract.id];
  //     }.bind(this),

  //     jingleMessageAccept: function (stanza) {
  //       if (stanza.from.toString() === this.jid.toString()) {
  //         return;
  //       }
  //       this.emit(events.HANDLED_INCOMING_RTCSESSION, stanza.accept.id);
  //       delete this.pendingSessions[stanza.accept.id];
  //     }.bind(this),

  //     jingleMessageProceed: function (stanza) {
  //       return this.emit(
  //         events.OUTGOING_RTCSESSION_PROCEED,
  //         stanza.proceed.id,
  //         stanza.from.full
  //       );
  //     }.bind(this),

  //     jingleMessageReject: function (stanza) {
  //       if (stanza.from.toString() === this.jid.toString()) {
  //         return;
  //       }
  //       if (stanza.from.toString() === this.jid.bare) {
  //         this.emit(
  //           events.HANDLED_INCOMING_RTCSESSION,
  //           stanza.reject.id
  //         );
  //       } else {
  //         this.emit(
  //           events.OUTGOING_RTCSESSION_REJECTED,
  //           stanza.reject.id
  //         );
  //       }
  //       delete this.pendingSessions[stanza.reject.id];
  //     }.bind(this)
  //   };
  // }

  async refreshIceServers () {
    const server = this.client._stanzaio.config.server;
    const turnServersPromise = this.client._stanzaio.getServices(server, 'turn', '1');
    const stunServersPromise = this.client._stanzaio.getServices(server, 'stun', '1');

    const [turnServers, stunServers] = await Promise.all([turnServersPromise, stunServersPromise]);
    this.logger.debug('STUN/TURN server discovery result', { turnServers, stunServers });
    const iceServers = [...turnServers.services, ...stunServers.services].map(service => {
      const port = service.port ? `:${service.port}` : '';
      const ice: RTCIceServer & { type: string } = { type: service.type, urls: `${service.type}:${service.host}${port}` };
      if (['turn', 'turns'].includes(service.type)) {
        if (service.transport && (service.transport !== 'udp')) {
          ice.urls += `?transport=${service.transport}`;
        }
        if (service.username) {
          ice.username = service.username;
        }
        if (service.password) {
          ice.credential = service.password;
        }
      }
      return ice;
    });

    this.client._stanzaio.jingle.iceServers = iceServers;
    return iceServers;
  }

  get expose () {
    return {
      on: (event: string, handler: (...args: any) => void) => {
        this.on(event, handler);
      },
      once: (event: string, handler: (...args: any) => void) => {
        this.once(event, handler);
      },
      off: (event: string, handler: (...args: any) => void) => {
        this.off(event, handler);
      },
      refreshIceServers: this.refreshIceServers.bind(this),
      acceptRtcSession: this.acceptRtcSession.bind(this),
      rtcSessionAccepted: this.rtcSessionAccepted.bind(this)
    };
  }

  get stanzaCheckers () {
    return {
      // https://xmpp.org/extensions/xep-0353.html
      jingleMessageInit: stanza => !!(stanza.propose && stanza.propose.id)
      // jingleMessageRetract: stanza => !!(stanza.retract && stanza.retract.id),
      // jingleMessageAccept: stanza => !!(stanza.accept && stanza.accept.id),
      // jingleMessageProceed: stanza => !!(stanza.proceed && stanza.proceed.id),
      // jingleMessageReject: stanza => !!(stanza.reject && stanza.reject.id)
    };
  }
}
