import { MediaSession } from 'stanza/jingle';
import { JingleAction, JINGLE_INFO_ACTIVE } from 'stanza/Constants';
import WildEmitter from 'wildemitter';

export enum MediaSessionEvents {
  accepted = 'accepted',
  iceConnectionType = 'iceConnectionType',
  peerTrackAdded = 'peerTrackAdded',
  peerTrackRemoved = 'peerTrackRemoved',
  unmute = 'unmute',
  sessionState = 'sessionState',
  connectionState = 'connectionState',
  terminated = 'terminated'
}

export interface GenesysCloudMediaSession extends WildEmitter {
  on: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  once: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  off: (event: MediaSessionEvents, listener: (...data: any) => void) => void;
  emit: (event: MediaSessionEvents, ...data: any) => void;
}

export type SessionType = 'softphone' | 'screenShare' | 'screenRecording' | 'collaborateVideo' | 'unknown';

export class GenesysCloudMediaSession extends MediaSession {
  constructor (options: any, public sessionType: SessionType, private allowIPv6: boolean) {
    super(options);
    WildEmitter.mixin(this);
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

  addTrack (track: MediaStreamTrack, stream?: MediaStream): Promise<void> {
    if (track.kind === 'audio') {
      this.includesAudio = true;
    }
    if (track.kind === 'video') {
      this.includesVideo = true;
    }
    return this.processLocal('addtrack', async () => {
      // find a sender with the same kind of track
      let sender = this.pc.getSenders().find(sender => sender.track && sender.track.kind === track.kind);

      if (!sender) {
        // find a transceiver whose receiver is the same kind but sender doesn't have a track
        const transceiver = this.pc.getTransceivers().find(transceiver => !transceiver.sender.track && transceiver.receiver.track?.kind === track.kind);
        sender = transceiver?.sender;
      }

      if (sender) {
        return sender.replaceTrack(track);
      }

      await (this.pc as any).addTrack(track, stream);
      return;
    });
  }
}
