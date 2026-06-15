import { randomUUID } from 'crypto';

global.window = global;
global.self = global;
globalThis.crypto = { randomUUID: jest.fn(() => randomUUID())}

