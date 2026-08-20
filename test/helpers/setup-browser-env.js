import { randomUUID } from 'crypto';
import 'whatwg-fetch';

global.window = global;
global.self = global;
globalThis.crypto = { randomUUID: jest.fn(() => randomUUID())}

