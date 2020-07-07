exports = module.exports = function (logger, data) {
  logger = logger || console;
  data = data || {};
  return attachSuperagentLogger.bind(null, logger, data);
};

function attachSuperagentLogger (logger, data, req) {
  let start = new Date().getTime();
  let timestamp = new Date().toISOString();
  let method = req.method;

  logger.debug(`request: ${method.toUpperCase()} ${req.url}`, { timestamp, data });

  req.on('response', function (res) {
    let now = new Date().toISOString();
    let status = res.status;
    let elapsed = (now - start) + 'ms';
    let correlationId = res.headers['inin-correlation-id'];
    let body = JSON.stringify(res.body);

    logger.debug(`response: ${method.toUpperCase()} ${req.url}`,
      { now,
        status,
        elapsed,
        correlationId,
        body
      });
  });
}
