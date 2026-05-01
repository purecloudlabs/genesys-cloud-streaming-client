## Streaming Client
[![Test Matrix](https://github.com/purecloudlabs/genesys-cloud-streaming-client/actions/workflows/matrix.yml/badge.svg)](https://github.com/purecloudlabs/genesys-cloud-streaming-client/actions/workflows/matrix.yml)

### Overview
Client library for Genesys Cloud streaming services (websocket/XMPP interface).

### Installation
```bash
npm install genesys-cloud-streaming-client
```

### Quick Start
```ts
import StreamingClient from 'genesys-cloud-streaming-client';

const client = new StreamingClient({
  host: 'wss://streaming.mypurecloud.com',
  authToken: 'your-access-token',
});

await client.connect();
```

> If you're using this in a browser with a bundler like Vite or Webpack 5, you'll
> need polyfills for `global`, `events`, and possibly `process`. See the
> [full documentation](doc/documentation.md#browser-usage--polyfills) for details.

### Documentation
See [doc/documentation.md](doc/documentation.md) for the full API reference,
browser polyfill setup, and known issues.

### Development

Run `npm install` to install dependencies.

### Testing
Run the tests using `npm test` in the command line.

### Build for Local Use
Run `npm run build`

### Linting and Style
ESLint with the semistandard config has been added and you can run linting through the command line via `npm run lint`

To fix minor styling errors, run `npm run lint:fix`

**If you can configure your editor to run linting while typing or on save, this is preferable.**
