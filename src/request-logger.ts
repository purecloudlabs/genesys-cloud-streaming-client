export default function attachSuperagentLogger (logger, data, req) {
  let start = new Date().getTime();
  let timestamp = new Date().toISOString();
  let method = req.method;
  logger = logger || console;

  logger.debug(`request: ${method.toUpperCase()} ${req.url}`, { timestamp, data }, true);

  req.on('response', function (res) {
    let now = new Date().getTime();
    let status = res.status;
    let elapsed = (now - start) + 'ms';
    let correlationId = res.headers['inin-correlation-id'];
    let body = JSON.stringify(res.body);

    logger.debug(`response: ${method.toUpperCase()} ${req.url}`, {
      now,
      status,
      elapsed,
      correlationId,
      body
    }, true);
  });
}
