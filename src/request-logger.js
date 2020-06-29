exports = module.exports = function (logger) {
  return attachSuperagentLogger.bind(null, logger);
};

function attachSuperagentLogger (logger, req) {
  let start = new Date().getTime();
  let timestamp = new Date().toISOString();
  let method = req.method;

  logger.info('%s >>> %s %s \n Body: %s',
    timestamp,
    method.toUpperCase(),
    req.url,
    JSON.stringify(req.body));

  req.on('response', function (res) {
    let now = new Date().getTime();
    let elapsed = now - start;

    logger.info('%s <<< %s %s %s %s \n Correlation-id: %s \n Body: %s',
      timestamp,
      method.toUpperCase(),
      res.status,
      req.url,
      elapsed + 'ms',
      res.headers['inin-correlation-id'],
      JSON.stringify(res.body));
  });
}
