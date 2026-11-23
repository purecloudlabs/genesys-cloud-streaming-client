/* eslint @typescript-eslint/no-explicit-any: "off" */
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

/**
 * Black-box IT mock server (zero dependencies, built on node:http).
 *
 * Stands up a real HTTP server on a real port. The streaming client talks to it
 * exactly as it talks to the Genesys Cloud platform API: point `apiHost` at
 * `baseUrl` and `HttpClient` builds `${baseUrl}/api/v2/<path>`.
 *
 * Prefer `installHttpMockServer()` from `./harness`, which also wires the axios
 * adapter and the per-test reset.
 */

export interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  body: any;
  headers: Record<string, string | string[] | undefined>;
}

export interface StubResponse {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}

/** A fixed response, or a function that picks one from the request and the route's hit count. */
export type StubHandler = StubResponse | ((req: RecordedRequest, hitCount: number) => StubResponse);

interface Stub {
  method: string;
  matcher: RegExp;
  handler: StubHandler;
  hits: number;
}

export class MockApiServer {
  private server?: Server;
  private stubs: Stub[] = [];
  private requests: RecordedRequest[] = [];
  port = 0;

  start (): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handle(req, res));
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server!.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  stop (): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) { return resolve(); }
      this.server.close(() => resolve());
    });
  }

  /** Clear stubs and recorded requests between tests. */
  reset (): void {
    this.stubs = [];
    this.requests = [];
  }

  /** The value to use as the client's `apiHost`. */
  get baseUrl (): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Register a response for a method and path regex. The last matching stub wins. */
  stub (method: string, matcher: RegExp, handler: StubHandler): this {
    this.stubs.push({ method: method.toLowerCase(), matcher, handler, hits: 0 });
    return this;
  }

  /** All recorded requests, optionally filtered by method and/or path regex. */
  received (method?: string, matcher?: RegExp): RecordedRequest[] {
    return this.requests.filter(r =>
      (!method || r.method === method.toLowerCase()) && (!matcher || matcher.test(r.path))
    );
  }

  private handle (req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: any = raw;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { /* leave as string */ }

      const [path, query = ''] = (req.url || '').split('?');
      const recorded: RecordedRequest = {
        method: (req.method || '').toLowerCase(),
        path,
        query,
        body,
        headers: req.headers
      };
      this.requests.push(recorded);

      const stub = [...this.stubs].reverse().find(s => s.method === recorded.method && s.matcher.test(path));
      let response: StubResponse = { status: 404, body: { message: `no stub for ${recorded.method} ${path}` } };
      if (stub) {
        stub.hits++;
        response = typeof stub.handler === 'function' ? stub.handler(recorded, stub.hits) : stub.handler;
      }

      res.writeHead(response.status, { 'content-type': 'application/json', ...(response.headers || {}) });
      res.end(JSON.stringify(response.body ?? {}));
    });
  }
}
