const myLogger = {};

['log', 'debug', 'info', 'warn', 'error'].forEach(level => {
  myLogger[level] = function () { console[level]('__my-custom-logger__', ...arguments); }
});

const client = new window.GenesysCloudStreamingClient({
  ...window.scConfig,
  logger: myLogger,
  appId: 'apiId-123',
  appName: 'Parent-App',
  appVersion: 'PA.1.2.3',
  optOutOfWebrtcStatsTelemetry: false
});

window.client = client;

client.logger.info('logging from the streaming-client logger');