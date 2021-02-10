export type RequestApiOptions = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  host: string;
  data?: any;
  version?: string;
  contentType?: string;
  authToken?: string;
  logger?: any
};
