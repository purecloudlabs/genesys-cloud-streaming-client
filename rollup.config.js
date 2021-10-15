import resolve from '@rollup/plugin-node-resolve';

export default {
  external: [
    'async',
    'browserama',
    'crypto',
    'events',
    'genesys-cloud-client-logger',
    'limiter',
    'lodash.throttle',
    'lru-cache',
    'node-fetch',
    'punycode',
    'sdp',
    'readable-stream',
    'superagent',
    'stanza/jxt',
    'stanza/JID',
    'stanza/jingle',
    'stanza/Constants',
    'stanza/Namespaces',
    'stream',
    'tslib',
    'webrtc-stats-gatherer',
    'wildemitter',
    'ws'
  ],
  input: 'dist/es/index.js',
  output: {
    file: 'dist/es/index.module.js',
    format: 'es'
  },
  plugins: [resolve({ browser: true })]
};
