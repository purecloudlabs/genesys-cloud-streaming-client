// this test is just needed for coverage for now

import indexClient, { parseJwt, HttpClient } from '../../src/index';

import { Client } from '../../src/client';
import { parseJwt as parseJwtOrig } from '../../src/utils';
import { HttpClient as HttpClientOrig } from '../../src/http-client';

describe('index', () => {
  it('should export Client as default', () => {
    expect(indexClient).toBe(Client);
  });

  it('should export parseJwt function', () => {
    expect(parseJwt).toBe(parseJwtOrig);
  });

  it('should export HttpClient class', () => {
    expect(HttpClient).toBe(HttpClientOrig);
  });
});
