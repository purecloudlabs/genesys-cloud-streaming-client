exports = module.exports = function (logger) {
  logger = logger || console;

  return attachSuperagentLogger.bind(null, logger);
};

function attachSuperagentLogger (logger, req) {
  let start = new Date().getTime();
  let timestamp = new Date().toISOString();
  let method = req.method;

  logger.info('%s >>> %s %s %s\nBody: %s',
    timestamp,
    method.toUpperCase(),
    req.url,
    req.body);

  req.on('response', function (res) {
    let now = new Date().getTime();
    let elapsed = now - start;

    logger.info('%s <<< %s %s %s %s\nBody: %s',
      timestamp,
      method.toUpperCase(),
      res.status,
      req.url,
      elapsed + 'ms',
      res.body);
  });
}
