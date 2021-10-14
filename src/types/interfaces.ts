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
};
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

export interface ILogger {
  log (messageOrError: string | Error, details?: any, skipServer?: boolean): void;
  debug (messageOrError: string | Error, details?: any, skipServer?: boolean): void;
  info (messageOrError: string | Error, details?: any, skipServer?: boolean): void;
  warn (messageOrError: string | Error, details?: any, skipServer?: boolean): void;
  error (messageOrError: string | Error, details?: any, skipServer?: boolean): void;
}

export type SessionTypes = 'softphone' | 'screenShare' | 'screenRecording' | 'collaborateVideo' | 'unknown';

export interface ISessionInfo {
  sessionId: string;
  autoAnswer: boolean;
  toJid: string;
  fromJid: string;
  conversationId: string;
  originalRoomJid?: string;
  fromUserId?: string;
  roomJid?: string;
  sessionType: SessionTypes;
}
