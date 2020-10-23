import { MediaSession } from 'stanza/jingle';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import WildEmitter from 'wildemitter';
import StatsGatherer from 'webrtc-stats-gatherer';

export enum MediaSessionEvents {
  accepted = 'accepted',
  iceConnectionType = 'iceConnectionType',
  peerTrackAdded = 'peerTrackAdded',
  peerTrackRemoved = 'peerTrackRemoved',
  unmute = 'unmute',
  sessionState = 'sessionState',
  connectionState = 'connectionState',
  terminated = 'terminated',
  stats = 'stats',
  endOfCandidates = 'endOfCandidates'
}

export interface GenesysCloudMediaSession extends WildEmitter {
  on: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  once: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  off: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  emit: (event: MediaSessionEvents, ...data: any) => void;
}

export type SessionType = 'softphone' | 'screenShare' | 'screenRecording' | 'collaborateVideo' | 'unknown';

export class GenesysCloudMediaSession extends MediaSession {
  private statsGatherer?: StatsGatherer;

  constructor (options: any, public sessionType: SessionType, private allowIPv6: boolean) {
    super(options);
    WildEmitter.mixin(this);

    if (!options.optOutOfWebrtcStatsTelemetry) {
      this.setupStatsGatherer();
    }
  }

  setupStatsGatherer () {
    this.statsGatherer = new StatsGatherer(this.pc);
    this.statsGatherer.on('stats', this.emit.bind(this, MediaSessionEvents.stats));
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
    this.emit(MediaSessionEvents.endOfCandidates);
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
