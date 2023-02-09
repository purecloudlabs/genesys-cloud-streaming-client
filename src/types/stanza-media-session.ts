/* istanbul ignore file */
import EventEmitter from 'events';
import { MediaSession } from 'stanza/jingle';
import { JingleReasonCondition, JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import { ActionCallback } from 'stanza/jingle/Session';
import { JingleIce, JingleReason } from 'stanza/protocol';
import StatsGatherer from 'webrtc-stats-gatherer';
import { IMediaSession, IStanzaMediaSessionParams } from './media-session';
import { SessionTypes } from './interfaces';
import { Jingle } from 'stanza/protocol/xep0166';
import Logger from 'genesys-cloud-client-logger';

const loggingOverrides = {
  'Discovered new ICE candidate': { skipMessage: true }
};

// because we are trying to unify the interfaces between stanza and genesys media session
// we kind of have to hack the stanza one so it works with typescript
export class StanzaMediaSession extends MediaSession implements IMediaSession {
  private statsGatherer?: StatsGatherer;
  private iceCandidatesDiscovered = 0;
  private iceCandidatesReceivedFromPeer = 0;
  private interruptionStart?: Date;
  private logger: Logger;

  // Since we are basically taking a stanza media session and decorating it with a strict event
  // emitter, we have to hack a few things... These declarations get added in the constructor
  // when we create the event emitter and extend it into this class.
  off: any;
  removeAllListeners: any;
  on: any;
  once: any;
  setMaxListeners: any;
  getMaxListeners: any;
  listeners: any;
  rawListeners: any;
  listenerCount: any;
  prependListener: any;
  prependOnceListener: any;
  eventNames: any;
  addListener: any;
  removeListener: any;
  emit: any;

  conversationId: string;
  peerConnection: RTCPeerConnection;
  id: string;
  fromUserId: string;
  originalRoomJid?: string;
  sessionType: SessionTypes;
  ignoreHostCandidatesFromRemote: boolean;
  allowIPv6: boolean;
  allowTCP: boolean;
  dataChannel?: RTCDataChannel;

  constructor (params: IStanzaMediaSessionParams) {
    super(params.options);

    this.logger = params.logger;
    this.conversationId = params.conversationId!;
    this.peerConnection = this.pc;
    this.fromUserId = params.fromUserId!;
    this.id = this.sid;
    this.originalRoomJid = params.originalRoomJid;
    this.sessionType = SessionTypes[params.sessionType];
    this.ignoreHostCandidatesFromRemote = !!params.ignoreHostCandidatesFromRemote;
    this.allowIPv6 = !!params.allowIPv6;
    this.allowTCP = !!params.allowTCP;

    // babel does not like the typescript recipe for multiple extends so we are hacking this one
    // referencing https://github.com/babel/babel/issues/798
    const eventEmitter = new EventEmitter();
    Object.keys((eventEmitter as any).__proto__).forEach((name) => {
      this[name] = eventEmitter[name];
    });

    if (!params.optOutOfWebrtcStatsTelemetry) {
      this.setupStatsGatherer();
    }
    this.pc.addEventListener('connectionstatechange', this.onConnectionStateChange.bind(this));
    this.pc.addEventListener('icecandidateerror', this.onIceCandidateError.bind(this));
  }

  private getLogDetails (): { conversationId: string, sessionId: string, sessionType: SessionTypes } {
    return {
      conversationId: this.conversationId,
      sessionId: this.id,
      sessionType: this.sessionType
    };
  }

  async onTransportInfo (changes: Jingle, cb: ActionCallback) {
    const transport = (changes.contents?.[0].transport! as JingleIce);
    const candidates = transport?.candidates;
    if (this.ignoreHostCandidatesFromRemote) {
      const nonHostCandidates = candidates?.filter(candidate => candidate.type !== 'host');

      if (nonHostCandidates?.length !== transport?.candidates?.length) {
        this._log('info', 'Ignoring remote host ice candidates');

        transport.candidates = nonHostCandidates;
      }
    }

    if (candidates) {
      for (const candidate of candidates) {
        this._log('info', 'Received candidate from peer', { candidateType: candidate.type });
        this.iceCandidatesReceivedFromPeer++;
      }
    }

    return super.onTransportInfo(changes, cb);
  }

  protected _log (level: string, message: string, ...data: any[]) {
    const redactionInfo = loggingOverrides[message];

    if (redactionInfo?.skipMessage) {
      return;
    }

    let details: any;
    if (data.length) {
      const firstItem = data[0];

      // if first item is an object, merge the details, else wrap them
      if (
        typeof firstItem === 'object' &&
        !Array.isArray(firstItem) &&
        firstItem !== null
      ) {
        Object.assign(data[0], this.getLogDetails());
        details = data;
      } else {
        details = { ...this.getLogDetails(), data: firstItem };
      }
    } else {
      details = [...data, this.getLogDetails()];
    }

    this.logger[level](message, details);
  }

  end (reason: JingleReasonCondition | JingleReason = 'success', silent = false) {
    this.state = 'ended';
    this.processingQueue.kill();

    if (typeof reason === 'string') {
      reason = { condition: reason };
    }

    if (!silent) {
      this.send('session-terminate', { reason });
    }

    // After sending session-terminate, wait for the peer connection to die -> if it doesn't, we will manually close it.
    setTimeout(() => {
      if (this.pc.connectionState === 'connected' || this.pc.connectionState === 'connecting') {
        this.pc.close();
      }
    }, 2000);

    this.parent.emit('terminated', this, reason);
    this.parent.forgetSession(this);
  }

  setupStatsGatherer () {
    this.statsGatherer = new StatsGatherer(this.pc);
    this.statsGatherer.on('stats', this.emit.bind(this, 'stats'));
  }

  onIceStateChange () {
    const iceState = this.pc.iceConnectionState;
    const sessionId = this.id;
    const conversationId = this.conversationId;
    const sessionType = this.sessionType;

    this._log('info', 'ICE state changed: ', { iceState, sessionId, conversationId });

    if (iceState === 'disconnected') {
      // this means we actually connected at one point
      if (this.pc.signalingState === 'stable') {
        this.interruptionStart = new Date();
        this._log('info', 'Connection state is interrupted', { sessionId, conversationId, sessionType });
      }
    } else if (iceState === 'connected') {
      this._log('info', 'sending session-info: active');
      this.send(JingleAction.SessionInfo, {
        info: {
          infoType: JINGLE_INFO_ACTIVE
        }
      });
      this._setupDataChannel();
    } else if (iceState === 'failed') {
      this._log('info', 'ICE connection failed', {
        candidatesDiscovered: this.iceCandidatesDiscovered,
        candidatesReceivedFromPeer: this.iceCandidatesReceivedFromPeer
      });
    }

    super.onIceStateChange();
  }

  onConnectionStateChange () {
    const connectionState = this.pc.connectionState;
    const sessionId = this.id;
    const conversationId = this.conversationId;
    const sessionType = this.sessionType;

    this._log('info', 'Connection state changed: ', { connectionState, sessionId, conversationId, sessionType });
    if (this.interruptionStart) {
      if (connectionState === 'connected') {
        const diff = new Date().getTime() - this.interruptionStart.getTime();
        this._log('info', 'Connection was interrupted but was successfully recovered/connected', { sessionId, conversationId, sessionType, timeToRecover: diff });
        this.interruptionStart = undefined;
      } else if (connectionState === 'failed') {
        this._log('info', 'Connection was interrupted and failed to recover', { sessionId, conversationId, sessionType });
      }
    }
  }

  onIceCandidateError (ev: Event) {
    const event: RTCPeerConnectionIceErrorEvent = ev as RTCPeerConnectionIceErrorEvent;

    this._log('error', 'IceCandidateError', {
      errorCode: event.errorCode,
      errorText: event.errorText,
      url: event.url
    });
    console.error('IceCandidateError', event);
  }

  onIceCandidate (e: RTCPeerConnectionIceEvent) {
    if (e.candidate) {
      if (!this.allowTCP && e.candidate.protocol === 'tcp') {
        return;
      }
      if (!this.allowIPv6) {
        const addressRegex = /.+udp [^ ]+ ([^ ]+).*typ host/;
        const matches = addressRegex.exec(e.candidate.candidate);

        const ipv4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
        if (matches && !matches[1].match(ipv4Regex)) {
          this._log('debug', 'Filtering out IPv6 candidate', e.candidate.candidate);
          return;
        }
      }

      // this has too much information and can only be logged locally (debug)
      this._log('debug', 'Processing ice candidate', e.candidate.candidate);

      // this one is info level so it can go to the server
      this._log('info', 'Discovered ice candidate to send to peer', { type: e.candidate.type });
      this.iceCandidatesDiscovered++;
    }

    return super.onIceCandidate(e);
  }

  onIceEndOfCandidates () {
    super.onIceEndOfCandidates();
    this.emit('endOfCandidates');
  }

  addTrack (track: MediaStreamTrack, stream?: MediaStream): Promise<void> {
    if (track.kind === 'audio') {
      this.includesAudio = true;
    }
    if (track.kind === 'video') {
      this.includesVideo = true;
    }
    return this.processLocal('addtrack', async () => {
      // find an available sender with the correct type
      const availableTransceiver = this.pc.getTransceivers().find((transceiver) => {
        return !transceiver.sender.track && transceiver.receiver.track?.kind === track.kind;
      });

      if (availableTransceiver) {
        return availableTransceiver.sender.replaceTrack(track);
      }

      this.pc.addTrack(track, stream as MediaStream);
      return;
    });
  }

  _setupDataChannel () {
    // this shouldn't happen, but we shouldn't set the datachannel up more than once
    if (this.dataChannel) {
      return;
    }

    // do nothing if a datachannel wasn't offered
    if (this.pc.localDescription?.sdp.includes('webrtc-datachannel')) {
      this._log('info', 'creating data channel');
      this.dataChannel = this.pc.createDataChannel('videoConferenceControl');
      this.dataChannel.addEventListener('open', () => {
        this._log('info', 'data channel opened');
      });

      this.dataChannel.addEventListener('message', this._handleDataChannelMessage.bind(this));

      this.dataChannel.addEventListener('close', () => {
        this._log('info', 'closing data channel');
      });

      this.dataChannel.addEventListener('error', (error) => {
        this._log('error', 'Error occurred with the data channel', error);
      });
    }
  }

  _handleDataChannelMessage (event: MessageEvent) {
    this._log('debug', 'data channel message received', event);
    try {
      const message = JSON.parse(event.data);
      this.emit('dataChannelMessage', message);
    } catch (e) {
      this._log('error', 'Failed to parse data channel message', { error: e });
    }
  }
}
