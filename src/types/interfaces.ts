
import { ILogger, LogFormatterFn, LogLevel } from 'genesys-cloud-client-logger';
import { AxiosError, ResponseType } from 'axios';
import { NamedAgent } from './named-agent';
import { JingleReasonCondition } from 'stanza/Constants';
export { ILogger, LogLevel };
export interface IClientOptions {
  host: string;
  apiHost?: string;
  authToken?: string;
  jwt?: string;
  jid?: string;
  jidResource?: string;
  reconnectOnNoLongerSubscribed?: boolean;
  optOutOfWebrtcStatsTelemetry?: boolean;
  allowIPv6?: boolean;
  logger?: ILogger;
  logLevel?: LogLevel;
  logFormatters?: LogFormatterFn[];
  signalIceConnected?: boolean;
  /* secondary/parent app info */
  appName?: string;
  appVersion?: string;
  appId?: string;
  customHeaders?: ICustomHeader; // Genesys internal use only - non-Genesys apps that pass in custom headers will be ignored.
}

export interface ICustomHeader {
  [header: string]: string;
}

export interface IClientConfig {
  host: string;
  apiHost: string;
  authToken?: string;
  jwt?: string;
  jid?: string;
  jidResource?: string;
  channelId: string;
  appName?: string;
  appVersion?: string;
  appId?: string;
  logLevel?: LogLevel;
  customHeaders?: ICustomHeader; // Genesys internal use only - non-Genesys apps that pass in custom headers will be ignored.
}
export interface ExtendedRTCIceServer extends RTCIceServer {
  type: string;
}

export type RequestApiOptions = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  host: string;
  data?: any;
  version?: string;
  responseType?: ResponseType;
  contentType?: string;
  authToken?: string;
  logger?: any;
  noAuthHeader?: boolean;
  requestTimeout?: number;
  customHeaders?: ICustomHeader; // Genesys internal use only - non-Genesys apps that pass in custom headers will be ignored.
};

export interface IAxiosResponseError extends AxiosError {
  text: string; // body of response as a string
}
export interface ISuperagentNetworkError extends Error {
  status: number | undefined; // will be `undefined` for network errors & timeouts
  method: string;
  url: string;
  crossDomain: boolean;
}

export interface ISuperagentResponseError {
  original?: any;
  status: number;
  response: {
    body: any; // body of the failure response
    error: ISuperagentNetworkError; // original error thrown by superagent
    header: { [key: string]: string };
    headers: { [key: string]: string };
    status: number;
    statusCode: number;
    statusText: string;
    text: string; // body of response as a string
    req: { // request
      method: string;
      _data?: string; // body of request as a string
    }
  };
}

export interface INetworkError extends IError {
  status: number;
  method: string;
  url: string;
  crossDomain: boolean;
}

export interface IResponseError extends IError {
  status: number;
  correlationId: string;
  responseBody: string;
  method: string;
  requestBody: string;
  url: string;
}

export interface IError {
  message: string;
  name: string;
  stack?: string;
}

export type SessionTypesAsStrings = 'softphone' | 'screenShare' | 'screenRecording' | 'collaborateVideo' | 'unknown';

export enum SessionTypes {
  softphone = 'softphone',
  collaborateVideo = 'collaborateVideo',
  acdScreenShare = 'screenShare',
  screenRecording = 'screenRecording',
  unknown = 'unknown'
}

export interface ISessionInfo extends IPendingSession { }
export interface IPendingSession {
  sessionId: string;
  id: string;
  autoAnswer: boolean;
  toJid: string;
  fromJid: string;
  conversationId: string;
  originalRoomJid?: string;
  sdpOverXmpp?: boolean;
  fromUserId?: string;
  roomJid?: string;
  accepted?: boolean;
  meetingId?: string;
  sessionType: SessionTypes | SessionTypesAsStrings;
}

export interface StreamingClientExtension {
  handleIq?: Function;
  handleMessage?: Function;
  handleStanzaInstanceChange: (stanzaInstance: NamedAgent) => void;
  expose: any;
}

export interface StreamingClientConnectOptions {
  /**
   * @deprecated since version 15.1.1. Please use maxConnectionAttempts instead
   */
  keepTryingOnFailure?: boolean;

  // how many attempts streaming client will make before giving up
  maxConnectionAttempts?: number;

  // max delay for exponential backoff of attempts
  maxDelayBetweenConnectionAttempts?: number;
}

export type GenesysWebrtcBaseParams = { sessionId: string };
export type GenesysWebrtcSdpParams = GenesysWebrtcBaseParams & { sdp: string; };
export type GenesysWebrtcOfferParams = GenesysWebrtcSdpParams & {
  conversationId: string;
  reinvite?: boolean;
};

export type GenesysInfoActiveParams = GenesysWebrtcBaseParams & { status: 'active' };
export type GenesysSessionTerminateParams = GenesysWebrtcBaseParams & { reason?: JingleReasonCondition };
export type GenesysWebrtcMuteParams = GenesysWebrtcBaseParams & { type: 'audio' | 'video' };

export type TypedJsonRpcMessage<Method extends string, Params> = {
  jsonrpc: string;
  method: Method;
  id?: string;
  params?: Params;
};

export type JsonRpcMessage = TypedJsonRpcMessage<string, any>;

export type GenesysWebrtcOffer = TypedJsonRpcMessage<'offer', GenesysWebrtcOfferParams>;
export type GenesysWebrtcAnswer = TypedJsonRpcMessage<'answer', GenesysWebrtcSdpParams>;
export type GenesysWebrtcInfo = TypedJsonRpcMessage<'info', GenesysInfoActiveParams>;
export type GenesysWebrtcIceCandidate = TypedJsonRpcMessage<'iceCandidate', GenesysWebrtcSdpParams>;
export type GenesysWebrtcTerminate = TypedJsonRpcMessage<'terminate', GenesysSessionTerminateParams>;
export type GenesysWebrtcMute = TypedJsonRpcMessage<'mute', GenesysWebrtcMuteParams>;
export type GenesysWebrtcUnmute = TypedJsonRpcMessage<'unmute', GenesysWebrtcMuteParams>;

export type GenesysWebrtcJsonRpcMessage = GenesysWebrtcOffer | GenesysWebrtcAnswer | GenesysWebrtcInfo | GenesysWebrtcIceCandidate | GenesysWebrtcTerminate | GenesysWebrtcMute | GenesysWebrtcUnmute;

export type HeadsetControlsRequestType = 'mediaHelper' | 'standard' | 'prioritized';
export type HeadsetControlsRejectionReason = 'activeCall' | 'mediaHelper' | 'priority';

export type HeadsetControlsRejectionParams = {
  requestId: string, // this should be the same uuid as the request
  reason: HeadsetControlsRejectionReason
};
export type HeadsetControlsChangedParams = { hasControls: boolean };

export type HeadsetControlsRequest = TypedJsonRpcMessage<'headsetControlsRequest', { requestType: HeadsetControlsRequestType }>;
export type HeadsetControlsRejection = TypedJsonRpcMessage<'headsetControlsRejection', HeadsetControlsRejectionParams>;
export type HeadsetControlsChanged = TypedJsonRpcMessage<'headsetControlsChanged', HeadsetControlsChangedParams>;

export type GenesysMediaMessage = HeadsetControlsRequest | HeadsetControlsRejection | HeadsetControlsChanged;

export type FlatObject = {
  [key: string]: string | number | boolean | null | Date;
};

export type GenericAction = { _eventType: string; };

export type InsightReport = {
  appName: string;
  appVersion: string;
  originAppName?: string;
  originAppVersion?: string;
  actions: InsightAction<any>[];
};

export type InsightAction<T extends { _eventType: string }> = {
  actionName: 'WebrtcStats';
  details: InsightActionDetails<T>;
};

export type InsightActionDetails<K extends { _eventType: string }> = {
  _eventType: K['_eventType'];
  /**
   * This should be ms since epoch, e.g. new Date().getTime()
   */
  _eventTimestamp: number;
  _appId?: string;
  _appName?: string;
  _appVersion?: string;
} & K;

export type OnlineStatusStat = InsightAction<{
  _eventType: 'onlineStatus';
  online: boolean;
}>;

export type FirstProposeStat = InsightAction<{
  _eventType: 'firstPropose';
  sdpViaXmppRequested: boolean;
  sessionType: SessionTypesAsStrings;
  originAppId?: string;
  conversationId: string;
  sessionId: string;
}>;

export type FirstAlertingConversationStat = InsightAction<{
  _eventType: 'firstAlertingConversationUpdate';
  conversationId: string;
  participantId: string;
}>;

export type MediaStat = InsightAction<{
  _eventType: 'mediaRequested' | 'mediaStarted' | 'mediaError';
  requestId?: string;
  message?: string;
  audioRequested: boolean;
  videoRequested: boolean;
  displayRequested: boolean;
  conversationId?: string;
  sessionType?: SessionTypesAsStrings;
  sessionId?: string;
  elapsedMsFromInitialRequest?: number;
}>;

// This will be a union of all the stats we want to proxy
export type NRProxyStat = FirstAlertingConversationStat | MediaStat;

export type SCConnectionData = {
  currentDelayMs: number;
  delayMsAfterNextReduction?: number;
  // At this time, we will reduce the current delay.
  // This is a long date
  nextDelayReductionTime?: number;
  // At this time, we will disregard any saved delays. It should be updated every failure.
  // This is a long date
  timeOfTotalReset?: number;
};
