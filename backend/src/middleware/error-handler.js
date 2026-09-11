export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}`,
      request_id: req.requestId,
    },
  });
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error(`[${req.requestId || 'no-request-id'}] Unhandled error:`, err);
  const status = err.status || (err.message?.includes('CORS') ? 403 : 500);
  const code = status >= 500 ? 'INTERNAL_ERROR' : (err.code || 'REQUEST_ERROR');
  const message = status >= 500 ? 'Internal server error' : (err.message || 'Request failed');
  res.status(status).json({ error: { code, message, request_id: req.requestId } });
}
