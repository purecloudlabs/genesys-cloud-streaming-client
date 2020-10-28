import { MediaSession } from 'stanza/jingle';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import StatsGatherer, { StatsEvent } from 'webrtc-stats-gatherer';
import StrictEventEmitter from 'strict-event-emitter-types';
import { EventEmitter } from 'events';
import { applyMixins } from '../utils';
import { JingleReason, JingleInfo } from 'stanza/protocol';

export type SessionType = 'softphone' | 'screenShare' | 'screenRecording' | 'collaborateVideo' | 'unknown';

export class GenesysCloudMediaSession extends MediaSession {
  private statsGatherer?: StatsGatherer;

  constructor (options: any, public sessionType: SessionType, private allowIPv6: boolean) {
    super(options);

    if (!options.optOutOfWebrtcStatsTelemetry) {
      this.setupStatsGatherer();
    }
  }

  setupStatsGatherer () {
    this.statsGatherer = new StatsGatherer(this.pc);
    this.statsGatherer.on('stats', this.emit.bind(this, 'stats'));
  }

  onIceStateChange () {
    const state = this.pc.iceConnectionState;

    if (state === 'connected') {
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
    if (e.candidate) {
      if (!this.allowIPv6) {
        const addressRegex = /.+udp [^ ]+ ([^ ]+).*typ host/;
        const matches = addressRegex.exec(e.candidate.candidate);

        const ipv4Regex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
        if (matches && !matches[1].match(ipv4Regex)) {
          this._log('debug', 'Filtering out IPv6 candidate', e.candidate.candidate);
          return;
        }
      }

      this._log('debug', 'Processing ice candidate', e.candidate.candidate);
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
}

export interface SessionEvents {
  iceConnectionType: ({localCandidateType: string, relayed: boolean, remoteCandidateType: string});
  peerTrackAdded: (track: MediaStreamTrack, stream?: MediaStream) => void;
  peerTrackRemoved: (track: MediaStreamTrack, stream?: MediaStream) => void;
  mute: JingleInfo;
  unmute: JingleInfo;
  sessionState: 'starting' | 'pending' | 'active';
  connectionState: 'starting' | 'connecting' | 'connected' | 'interrupted' | 'disconnected' | 'failed';
  terminated: JingleReason;
  stats: StatsEvent;
  endOfCandidates: void;
}

applyMixins(GenesysCloudMediaSession, [ EventEmitter ]);
export interface GenesysCloudMediaSession extends StrictEventEmitter<EventEmitter, SessionEvents> { }
