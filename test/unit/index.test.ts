// this test is just needed for coverage for now

import indexClient from '../../src/index';
import { Client } from '../../src/client';

describe('index', () => {
  it('should work', () => {
    expect(indexClient).toBe(Client);
  });
});
