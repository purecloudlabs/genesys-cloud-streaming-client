
import { ILogger, LogFormatterFn, LogLevel } from 'genesys-cloud-client-logger';
import { AxiosError } from 'axios';
import { NamedAgent } from './named-agent';
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
}
export interface ExtendedRTCIceServer extends RTCIceServer {
  type: string;
}

export type RequestApiOptions = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  host: string;
  data?: any;
  version?: string;
  contentType?: string;
  authToken?: string;
  logger?: any;
  noAuthHeader?: boolean;
  requestTimeout?: number;
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
  fromUserId?: string;
  roomJid?: string;
  accepted?: boolean;
  sessionType: SessionTypes | SessionTypesAsStrings;
}

export interface JsonRpcMessage {
  jsonrpc: string;
  method: string;
  params?: any;
}

export interface StreamingClientExtension {
  handleIq?: Function;
  handleMessage?: Function;
  handleStanzaInstanceChange: (stanzaInstance: NamedAgent) => void;
  expose: any;
}

export interface StreamingClientConnectOptions {
  keepTryingOnFailure: boolean;
}
