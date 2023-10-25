import EventEmitter from 'events';
import Logger from 'genesys-cloud-client-logger';
import { JingleReasonCondition } from 'stanza/Constants';
import { SessionOpts } from 'stanza/jingle/Session';
import StrictEventEmitter from 'stanza/lib/StrictEventEmitter';
import { JingleInfo, JingleReason } from 'stanza/protocol';
import { StatsEvent } from 'webrtc-stats-gatherer';
import { JsonRpcMessage, SessionTypes, SessionTypesAsStrings } from './interfaces';

export type SessionState = 'pending' | 'active' | 'ended';
export type ConnectionState = 'starting' | 'new' | 'connecting' | 'connected' | 'interrupted' | 'disconnected' | 'failed' | 'closed';
export interface SessionEvents {
  iceConnectionType: ({localCandidateType: string, relayed: boolean, remoteCandidateType: string});
  peerTrackAdded: (track: MediaStreamTrack, stream?: MediaStream) => void;
  peerTrackRemoved: (track: MediaStreamTrack, stream?: MediaStream) => void;
  mute: JingleInfo;
  unmute: JingleInfo;
  sessionState: SessionState;
  connectionState: ConnectionState;
  terminated: JingleReason;
  stats: StatsEvent;
  endOfCandidates: void;
  dataChannelMessage: JsonRpcMessage<any>;
}

export interface IMediaSessionParams {
  logger: Logger;
  id: string;
  fromJid: string;
  peerID: string;
  sessionType: SessionTypes | SessionTypesAsStrings;
  allowIPv6?: boolean;
  allowTCP?: boolean;
  ignoreHostCandidatesFromRemote?: boolean;
  optOutOfWebrtcStatsTelemetry?: boolean;
  conversationId?: string;
  fromUserId?: string;
  originalRoomJid?: string;
}

export interface IStanzaMediaSessionParams extends IMediaSessionParams {
  options: SessionOpts;
}

export interface IGenesysCloudMediaSessionParams extends IMediaSessionParams {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  reinvite: boolean;
}

export interface IMediaSession extends StrictEventEmitter<EventEmitter, SessionEvents> {
  conversationId: string;
  id: string;
  sessionType: SessionTypes;
  fromUserId?: string;
  peerID: string;
  peerConnection: RTCPeerConnection;
  pc: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  connectionState: ConnectionState | string;
  state: SessionState | string;
  reinvite: boolean;

  setupStatsGatherer (): void;
  accept (opts?: RTCAnswerOptions): Promise<void>;
  end (reason: JingleReasonCondition, silent?: boolean): Promise<void>;
  addTrack (track: MediaStreamTrack, stream?: MediaStream): Promise<void>;
  removeTrack (sender: RTCRtpSender): Promise<void>;
  mute (userId: string, name?: string): Promise<void>;
  unmute (userId: string, name?: string): Promise<void>;
  hold (): Promise<void>;
  resume (): Promise<void>;
}
